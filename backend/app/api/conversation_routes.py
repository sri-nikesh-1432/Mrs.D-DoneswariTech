"""
Conversation Handler API - Used by both Voice Testing Console and SIP Calls.
This is the SINGLE pipeline that both the simulator and real phone calls use.
"""

import time
import uuid
from fastapi import APIRouter, HTTPException
from typing import Optional
from datetime import datetime, timezone

from app.rag.retriever import retrieve_context, format_context_for_prompt, is_knowledge_ready
from app.rag.groq_service import generate_response
from app.rag.chunker import chunk_text
from app.rag.embeddings import generate_embeddings
from app.rag.vector_store import vector_store
from app.rag.json_retriever import get_json_retriever
from app.tts.edge_tts_service import EdgeTTSService
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/conversation", tags=["Conversation"])

# In-memory conversation memory for testing
# In production, this would be per-call memory managed by CallHandler
conversation_memory = {}

tts_service = EdgeTTSService()


@router.post("/end")
async def end_conversation(
    conversation_id: str
):
    """
    End a conversation and clear its memory.
    This should be called when a call ends to clean up memory.
    """
    logger.info(f"=== ENDING CONVERSATION: {conversation_id} ===")
    
    if conversation_id in conversation_memory:
        memory_length = len(conversation_memory[conversation_id])
        del conversation_memory[conversation_id]
        logger.info(f"Cleared conversation memory for {conversation_id} ({memory_length} messages)")
        return {
            "message": "Conversation ended successfully",
            "conversation_id": conversation_id,
            "messages_cleared": memory_length
        }
    else:
        logger.warning(f"Conversation {conversation_id} not found in memory")
        return {
            "message": "Conversation not found in memory",
            "conversation_id": conversation_id,
            "messages_cleared": 0
        }


@router.post("/test")
async def process_test_conversation(
    knowledge_file: str = "narayana.json",
    user_input: str = "",
    conversation_id: Optional[str] = None,
    include_audio: bool = True,
    is_greeting: bool = False,
    language: Optional[str] = "English"
):
    """
    Process conversation using JSON-based retriever for testing console.
    This uses hardcoded knowledge files in backend/knowledge/ directory.
    Completely separate from the main FAISS-based knowledge base.
    
    Args:
        knowledge_file: JSON file name (e.g., narayana.json, services.json)
        user_input: User's text input
        conversation_id: Optional conversation ID for memory tracking
        include_audio: Whether to generate TTS audio
        is_greeting: Whether this is a call greeting
        language: Detected language for voice selection
    """
    start_time = time.time()
    
    # Get JSON retriever
    json_retriever = get_json_retriever(knowledge_file)
    
    # Generate or retrieve conversation ID
    if not conversation_id:
        conversation_id = f"test_{uuid.uuid4().hex[:12]}"
    
    # Get or create conversation memory
    if conversation_id not in conversation_memory:
        conversation_memory[conversation_id] = []
    
    memory = conversation_memory[conversation_id]
    
    logger.info(f"=== TEST CONVERSATION PROCESSING STARTED ===")
    logger.info(f"Knowledge File: {knowledge_file}")
    logger.info(f"Conversation ID: {conversation_id}")
    logger.info(f"User Input: {user_input}")
    logger.info(f"Is Greeting: {is_greeting}")
    
    try:
        # Handle /insert command for JSON retriever
        if user_input.strip().startswith("/insert"):
            insert_content = user_input.strip()[7:].strip()
            
            if not insert_content:
                return {
                    "ai_response": "Please provide content after /insert command.",
                    "audio_data": None,
                    "debug_info": {
                        "total_time_ms": 0,
                        "is_insert_command": True
                    }
                }
            
            # Add to JSON retriever memory
            json_retriever.add_knowledge("Manual Insert", insert_content)
            
            return {
                "ai_response": "✓ Knowledge Updated (Session Only)\n\nNote: /insert in test mode only updates session memory, not the JSON file.",
                "audio_data": None,
                "debug_info": {
                    "total_time_ms": 0,
                    "is_insert_command": True
                }
            }
        
        # For greeting, use hardcoded greeting from JSON
        if is_greeting:
            greeting = json_retriever.get_greeting()
            
            # Add greeting to memory
            memory.append(greeting)
            
            # Generate audio if requested
            audio_data = None
            if include_audio:
                tts_start = time.time()
                audio_data = await tts_service.synthesize(greeting, language=language)
                tts_time = (time.time() - tts_start) * 1000
            else:
                tts_time = 0
            
            total_time = (time.time() - start_time) * 1000
            
            return {
                "ai_response": greeting,
                "audio_data": audio_data,
                "debug_info": {
                    "total_time_ms": total_time,
                    "retrieval_time_ms": 0,
                    "llm_time_ms": 0,
                    "tts_time_ms": tts_time,
                    "chunks_retrieved": 0,
                    "knowledge_source": "json"
                }
            }
        
        # Regular conversation - retrieve context from JSON
        retrieval_start = time.time()
        context = json_retriever.retrieve_context(user_input, top_k=5)
        retrieval_time = (time.time() - retrieval_start) * 1000
        
        # Build conversation history
        history_list = []
        for i, msg in enumerate(memory[-6:]):
            role = "user" if i % 2 == 0 else "model"
            history_list.append({"role": role, "content": msg})
        
        # Generate response
        llm_start = time.time()
        try:
            ai_response = await generate_response(
                conversation_history=history_list,
                context=context,
                user_message=user_input
            )
            llm_time = (time.time() - llm_start) * 1000
        except ValueError as e:
            # Fallback if Groq API key is not configured
            logger.warning(f"Groq API not configured, using fallback: {e}")
            # Simple fallback response based on context
            if context:
                ai_response = f"Based on the information I have: {context[:500]}"
            else:
                ai_response = "I apologize, but I need more information to help you. Could you please provide more details about what you're looking for?"
            llm_time = 0
        
        # Update memory
        memory.append(user_input)
        memory.append(ai_response)
        
        if len(memory) > 20:
            memory = memory[-20:]
            conversation_memory[conversation_id] = memory
        
        # Generate audio if requested
        audio_data = None
        if include_audio:
            tts_start = time.time()
            audio_data = await tts_service.synthesize(ai_response, language=language)
            tts_time = (time.time() - tts_start) * 1000
        else:
            tts_time = 0
        
        total_time = (time.time() - start_time) * 1000
        
        return {
            "ai_response": ai_response,
            "audio_data": audio_data,
            "debug_info": {
                "total_time_ms": total_time,
                "retrieval_time_ms": retrieval_time,
                "llm_time_ms": llm_time,
                "tts_time_ms": tts_time,
                "chunks_retrieved": context.count("\n\n") + 1 if context else 0,
                "knowledge_source": "json"
            }
        }
        
    except Exception as e:
        logger.error(f"Error in test conversation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/process")
async def process_conversation(
    institute_id: int,
    user_input: str,
    conversation_id: Optional[str] = None,
    include_audio: bool = True,
    is_greeting: bool = False,
    language: Optional[str] = "English"
):
    """
    Process a user message through the RAG -> LLM -> TTS pipeline.
    
    This is the EXACT same function used by:
    - Voice Testing Console (text input)
    - Voice Testing Console (voice input via STT)
    - SIP Phone Calls (via CallHandler)
    
    Args:
        institute_id: Institute ID for knowledge base
        user_input: User's text input (from typing or STT)
        conversation_id: Optional conversation ID for memory tracking
        include_audio: Whether to generate TTS audio
        is_greeting: Whether this is a call greeting (AI speaks first)
        language: Detected language for voice selection
    
    Returns:
        Response with AI text, audio (if requested), and debug info
    """
    start_time = time.time()
    
    # Generate or retrieve conversation ID
    if not conversation_id:
        conversation_id = f"conv_{uuid.uuid4().hex[:12]}"
    
    # Get or create conversation memory
    if conversation_id not in conversation_memory:
        conversation_memory[conversation_id] = []
    
    memory = conversation_memory[conversation_id]
    
    logger.info(f"=== CONVERSATION PROCESSING STARTED ===")
    logger.info(f"Conversation ID: {conversation_id}")
    logger.info(f"User Input: {user_input}")
    logger.info(f"Is Greeting: {is_greeting}")
    logger.info(f"Language: {language}")
    logger.info(f"Memory Length: {len(memory)}")
    
    try:
        # Handle /insert command for quick knowledge updates
        if user_input.strip().startswith("/insert"):
            insert_start = time.time()
            
            # Extract content after /insert
            insert_content = user_input.strip()[7:].strip()
            
            if not insert_content:
                return {
                    "ai_response": "Please provide content after /insert command. Example: /insert Hostel closes at 8PM.",
                    "audio_data": None,
                    "debug_info": {
                        "total_time_ms": 0,
                        "retrieval_time_ms": 0,
                        "llm_time_ms": 0,
                        "tts_time_ms": 0,
                        "chunks_retrieved": 0,
                        "is_insert_command": True
                    }
                }
            
            logger.info(f"/insert command detected. Content: {insert_content}")
            
            # Chunk the inserted content
            chunks = chunk_text(insert_content, source_document="manual_insert")
            
            if not chunks:
                return {
                    "ai_response": "Could not process the inserted content. Please try again.",
                    "audio_data": None,
                    "debug_info": {
                        "total_time_ms": 0,
                        "retrieval_time_ms": 0,
                        "llm_time_ms": 0,
                        "tts_time_ms": 0,
                        "chunks_retrieved": 0,
                        "is_insert_command": True
                    }
                }
            
            # Generate embeddings
            embeddings = generate_embeddings(chunks)
            
            # Add to existing vector store
            if vector_store.chunks is None or len(vector_store.chunks) == 0:
                # If vector store is empty, build new index
                vector_store.build_index(chunks, embeddings)
            else:
                # Append to existing index
                vector_store.append_chunks(chunks, embeddings)
            
            insert_time = (time.time() - insert_start) * 1000
            
            logger.info(f"/insert processed: {len(chunks)} chunks added in {insert_time:.2f}ms")
            
            return {
                "ai_response": f"✓ Knowledge Updated\n+{len(chunks)} chunks added\nEmbedding Time: {insert_time:.0f}ms\n\nYou can now ask questions about this new information.",
                "audio_data": None,
                "debug_info": {
                    "total_time_ms": insert_time,
                    "retrieval_time_ms": 0,
                    "llm_time_ms": 0,
                    "tts_time_ms": 0,
                    "chunks_retrieved": 0,
                    "is_insert_command": True,
                    "chunks_added": len(chunks)
                }
            }
        
        # For greeting, generate a welcome message using knowledge base
        if is_greeting:
            retrieval_start = time.time()
            retrieved_chunks = await retrieve_context("institute name college school", top_k=5, min_score=0.1)
            retrieval_time = (time.time() - retrieval_start) * 1000
            
            context_text = format_context_for_prompt(retrieved_chunks)
            
            # Extract institute name from context if available
            institute_name = "the institute"
            if context_text:
                # Try to extract institute name from context
                import re
                name_patterns = [
                    r'(?:institute|college|school|university)[\s]+(?:name|is|called|:)\s*([A-Z][A-Za-z\s]+)',
                    r'([A-Z][A-Za-z\s]+(?:College|Institute|School|University))',
                    r'Name:\s*([A-Z][A-Za-z\s]+)',
                ]
                for pattern in name_patterns:
                    match = re.search(pattern, context_text, re.IGNORECASE)
                    if match:
                        institute_name = match.group(1).strip()
                        break
            
            # Generate greeting prompt
            greeting_prompt = f"""You are Mrs. D, an AI Admission Counsellor.
Generate a warm, professional greeting for a caller.
You are representing {institute_name}.

Use the following context about the institute to personalize the greeting:
{context_text if context_text else "General admission inquiry"}

The greeting should:
- Be friendly and welcoming
- Explicitly mention "{institute_name}" as the institute name
- Offer to help with admissions, courses, facilities, scholarships
- Be conversational and natural
- Be 2-3 sentences long

Generate ONLY the greeting text, no additional commentary."""
            
            llm_start = time.time()
            ai_response = await generate_response(
                conversation_history=[],
                context=context_text,
                user_message=greeting_prompt
            )
            llm_time = (time.time() - llm_start) * 1000
            
            # Don't add greeting to memory yet
        else:
            # Step 1: Retrieve Knowledge (RAG)
            retrieval_start = time.time()
            retrieved_chunks = await retrieve_context(user_input, top_k=5, min_score=0.3)
            retrieval_time = (time.time() - retrieval_start) * 1000
            
            context_text = format_context_for_prompt(retrieved_chunks)
            
            # Step 2: Generate LLM Response
            llm_start = time.time()
            
            # Build conversation history for context
            history = "\n".join([
                f"{'User' if i % 2 == 0 else 'AI'}: {msg}"
                for i, msg in enumerate(memory[-6:])  # Last 3 exchanges
            ])
            
            # Convert history to list of dicts for groq_service
            history_list = []
            for i, msg in enumerate(memory[-6:]):
                role = "user" if i % 2 == 0 else "model"
                history_list.append({"role": role, "content": msg})
            
            ai_response = await generate_response(
                conversation_history=history_list,
                context=context_text,
                user_message=user_input
            )
            llm_time = (time.time() - llm_start) * 1000
            
            # Update memory for regular conversation
            memory.append(user_input)
            memory.append(ai_response)
            
            # Keep memory at reasonable size (last 20 messages)
            if len(memory) > 20:
                memory = memory[-20:]
                conversation_memory[conversation_id] = memory
        
        # Step 3: Generate TTS Audio (if requested)
        audio_data = None
        tts_time = 0
        if include_audio:
            tts_start = time.time()
            audio_data = await tts_service.synthesize(ai_response, language=language)
            tts_time = (time.time() - tts_start) * 1000
        
        total_time = (time.time() - start_time) * 1000
        
        logger.info(f"=== CONVERSATION PROCESSING COMPLETE ===")
        logger.info(f"Retrieval Time: {retrieval_time:.0f}ms")
        logger.info(f"LLM Time: {llm_time:.0f}ms")
        logger.info(f"TTS Time: {tts_time:.0f}ms")
        logger.info(f"Total Time: {total_time:.0f}ms")
        
        return {
            "conversation_id": conversation_id,
            "user_input": user_input,
            "ai_response": ai_response,
            "audio_data": audio_data,
            "retrieved_chunks": retrieved_chunks,
            "debug_info": {
                "retrieval_time_ms": retrieval_time,
                "llm_time_ms": llm_time,
                "tts_time_ms": tts_time,
                "total_time_ms": total_time,
                "chunks_retrieved": len(retrieved_chunks),
                "memory_length": len(memory),
                "knowledge_ready": is_knowledge_ready()
            }
        }
        
    except Exception as e:
        logger.error(f"Conversation processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reset")
async def reset_conversation(conversation_id: str):
    """Reset conversation memory for a given conversation ID."""
    if conversation_id in conversation_memory:
        del conversation_memory[conversation_id]
    
    logger.info(f"Conversation {conversation_id} reset")
    
    return {
        "message": "Conversation reset successfully",
        "conversation_id": conversation_id
    }


@router.get("/status")
async def get_conversation_status(conversation_id: str):
    """Get current conversation status and memory."""
    memory = conversation_memory.get(conversation_id, [])
    
    return {
        "conversation_id": conversation_id,
        "memory_length": len(memory),
        "memory": memory,
        "knowledge_ready": is_knowledge_ready()
    }


@router.post("/calls/save")
async def save_call(
    call_id: str,
    institute_id: int,
    duration: int,
    language: str,
    transcript: list,
    status: str
):
    """
    Save a completed call record.
    
    Args:
        call_id: Unique call identifier
        institute_id: Institute ID
        duration: Call duration in seconds
        language: Detected language
        transcript: List of conversation turns
        status: Call status (completed, ended, etc.)
    
    Returns:
        Saved call record
    """
    from app.database.connection import AsyncSessionLocal
    from app.database.models import CallHistory, CallStatus
    from sqlalchemy import select
    
    try:
        async with AsyncSessionLocal() as session:
            # Get institute
            result = await session.execute(
                select(CallHistory).where(CallHistory.call_id == call_id)
            )
            existing_call = result.scalar_one_or_none()
            
            if existing_call:
                # Update existing call
                existing_call.duration_seconds = duration
                existing_call.detected_language = language
                existing_call.transcript = "\n".join([
                    f"{turn['speaker'].upper()}: {turn['text']}" 
                    for turn in transcript
                ])
                existing_call.call_status = CallStatus.COMPLETED if status == "completed" else CallStatus.ENDED
                existing_call.total_turns = len(transcript)
                
                await session.commit()
                logger.info(f"Call {call_id} updated")
            else:
                # Create new call record
                call_record = CallHistory(
                    call_id=call_id,
                    institute_id=institute_id,
                    caller_number="SIMULATOR",
                    call_status=CallStatus.COMPLETED if status == "completed" else CallStatus.ENDED,
                    started_at=datetime.now(timezone.utc),
                    ended_at=datetime.now(timezone.utc),
                    duration_seconds=duration,
                    detected_language=language,
                    transcript="\n".join([
                        f"{turn['speaker'].upper()}: {turn['text']}" 
                        for turn in transcript
                    ]),
                    total_turns=len(transcript)
                )
                
                session.add(call_record)
                await session.commit()
                logger.info(f"Call {call_id} saved")
        
        return {
            "message": "Call saved successfully",
            "call_id": call_id
        }
        
    except Exception as e:
        logger.error(f"Error saving call: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/calls/{institute_id}")
async def get_simulator_calls(institute_id: int):
    """
    Get all simulator calls for an institute.
    
    Args:
        institute_id: Institute ID
    
    Returns:
        List of call records
    """
    from app.database.connection import AsyncSessionLocal
    from app.database.models import CallHistory
    from sqlalchemy import select
    
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(CallHistory)
                .where(CallHistory.institute_id == institute_id)
                .where(CallHistory.caller_number == "SIMULATOR")
                .order_by(CallHistory.started_at.desc())
            )
            calls = result.scalars().all()
            
            # Convert to dict for JSON response
            calls_data = []
            for call in calls:
                calls_data.append({
                    "call_id": call.call_id,
                    "caller_number": call.caller_number,
                    "caller_name": call.caller_name,
                    "call_status": call.call_status.value,
                    "started_at": call.started_at.isoformat(),
                    "ended_at": call.ended_at.isoformat() if call.ended_at else None,
                    "duration_seconds": call.duration_seconds,
                    "detected_language": call.detected_language,
                    "transcript": call.transcript,
                    "total_turns": call.total_turns,
                    "sentiment": call.sentiment.value if call.sentiment else None,
                })
        
        return {
            "calls": calls_data
        }
        
    except Exception as e:
        logger.error(f"Error getting simulator calls: {e}")
        raise HTTPException(status_code=500, detail=str(e))
