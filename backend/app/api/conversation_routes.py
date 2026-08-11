"""
Conversation Handler API - Used by both Voice Testing Console and SIP Calls.
This is the SINGLE pipeline that both the simulator and real phone calls use.
"""

import time
import json
import uuid
import base64
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone

from app.rag.retriever import retrieve_context, format_context_for_prompt, is_knowledge_ready
from app.rag.groq_service import generate_response
from app.rag.chunker import chunk_text
from app.rag.embeddings import generate_embeddings
from app.rag.vector_store import vector_store
from app.rag.json_retriever import get_json_retriever
from app.tts.edge_tts_service import EdgeTTSService
from app.logs.logger import get_logger
from app.roman_telugu import looks_roman_telugu, transliterate_roman_telugu

logger = get_logger(__name__)

router = APIRouter(prefix="/api/conversation", tags=["Conversation"])

# In-memory conversation memory for testing
# In production, this would be per-call memory managed by CallHandler
conversation_memory = {}

tts_service = EdgeTTSService()


LANGUAGE_INSTRUCTION = (
    "## Call Instructions\n"
    "You are Mrs. D on a live admissions call. Reply in {language} (the caller's language — "
    "Roman Telugu like 'idhi enti' or 'naku MPC kavali' counts as Telugu; reply in Telugu script).\n"
    "\n"
    "BEHAVIOUR (follow strictly):\n"
    "- NEVER restate, translate, or paraphrase the caller's words. No 'మీరు ... అని అర్థమైంది', "
    "  no 'you asked about...', no 'according to your question'. Act on their intent directly.\n"
    "- Acknowledge warmly in ONE short phrase, then answer or guide. E.g. 'అవును, తప్పకుండా. ...'\n"
    "- Keep it SHORT like a phone call: 1-3 sentences for simple questions. Don't dump everything.\n"
    "- End with a relevant warm follow-up question when natural.\n"
    "- NATURAL TELUGU-ENGLISH CODE-MIXING IS EXPECTED: an educated Telugu counsellor mixes "
    "  English words naturally. Write Telugu words in Telugu script, keep conversational "
    "  English words (fee, hostel, bus, campus, college, admission, process, course, details, "
    "  available, structure, scholarship, facility) in English: 'అవును, మా college లో hostel "
    "  facility కూడా ఉంది.' Never force formal pure Telugu, never write Telugu words in Latin.\n"
    "\n"
    "SPELLING (critical): regional text in CORRECT native script, PERFECT spelling, never "
    "Romanized ('మీకు ఎలా సహాయం చేయగలను?', not 'meeku ela sahayam cheyagalanu?'). Telugu: exact "
    "vowel signs; compound verbs ONE word (చేయగలను, not 'చేయ గలను'); never swap డ/ద, ట/త, చ/స/శ.\n"
    "\n"
    "NUMBERS: fees as words, never digits — 'ఒక లక్ష రూపాయలు' for ₹100000, 'పదిహేను వేల "
    "రూపాయలు' for ₹15000, 'ఎనభై ఐదు వేల రూపాయలు' for ₹85000. Spell names correctly: నారాయణ, "
    "హైదరాబాద్, జూబిలీ హిల్స్.\n"
    "\n"
    "Vary sentence lengths; mix short acknowledgements and longer answers so it sounds spoken. "
    "End questions with '?' and statements with '.' for natural intonation. "
    "Speak like a warm professional counsellor: confident, concise, human."
)


class SaveCallRequest(BaseModel):
    """Request body for saving a completed call."""
    transcript: List[dict]


def _build_history(memory: list, conversation_id: str) -> list:
    """
    Convert the flat transcript into alternating user/model history for the LLM.

    Memory layout is always: [greeting (AI), user1, ai1, user2, ai2, ...]
    so even indices are AI messages and odd indices are user messages.
    """
    history_list = []
    for i, msg in enumerate(memory[-6:]):
        role = "model" if i % 2 == 0 else "user"
        history_list.append({"role": role, "content": msg})
    return history_list


def _detect_language(user_input: str, hint: Optional[str] = None) -> str:
    """
    Robust language detection that understands Roman Telugu.
    - If the caller wrote real Telugu script, return 'Telugu'.
    - If the caller typed Roman Telugu ('idhi enti', 'meeru ekkada unnaru'),
      return 'Telugu' too so the AI speaks Telugu, never English.
    - Otherwise fall back to the provided hint (from STT / frontend) or English.
    """
    import re
    if re.search(r"[\u0C00-\u0C7F]", user_input):
        return "Telugu"
    if looks_roman_telugu(user_input):
        return "Telugu"
    if hint and hint.lower() in ("te", "telugu"):
        return "Telugu"
    if hint and hint.lower() in ("hi", "hindi"):
        return "Hindi"
    if hint and hint.lower() in ("ta", "tamil"):
        return "Tamil"
    if hint and hint.lower() in ("kn", "kannada"):
        return "Kannada"
    if hint and hint.lower() in ("ml", "malayalam"):
        return "Malayalam"
    return "English"


@router.post("/stream")
async def stream_conversation(
    # Streaming voice endpoint: returns text/event-stream where each sentence
    # event carries the sentence's audio as soon as it is ready, so the
    # frontend can begin playback of sentence 1 while later sentences are
    # still being synthesized. Identical RAG + LLM logic to /test and /process
    # (no business-logic changes) — only the audio delivery is streamed.
    mode: str = "test",
    knowledge_file: str = "institute.json",
    institute_id: int = 1,
    user_input: str = "",
    conversation_id: Optional[str] = None,
    is_greeting: bool = False,
    language: Optional[str] = "English",
):
    """
    Stream a conversation turn as server-sent events.

    Event flow:
      event: turn      data: {"conversation_id", "detected_language"}
      event: sentence  data: {"index", "text", "audio_data"}   (one per sentence, in order)
      event: done      data: {"ai_response", "debug_info", "sentence_count"}
      event: error     data: {"detail"}
    """
    conv_id = conversation_id or (
        f"stream_{uuid.uuid4().hex[:12]}"
    )

    async def event_stream():
        try:
            turn_start = time.time()
            retrieval_ms = 0
            llm_ms = 0
            tts_ms = 0
            # ── Same detection/transliteration as the non-streaming routes ──
            detected_lang = _detect_language(user_input, hint=language)
            llm_input = transliterate_roman_telugu(user_input)
            yield sse_event(
                "turn",
                {"conversation_id": conv_id, "detected_language": detected_lang},
            )

            # Greeting: no LLM needed — reuse the JSON greeting (test mode)
            # or a context-generated greeting (process mode), matching the
            # non-streaming routes exactly.
            if is_greeting:
                if mode == "test":
                    retriever = get_json_retriever(knowledge_file)
                    ai_response = retriever.get_greeting(language=language)
                else:
                    _r0 = time.time()
                    retrieved_chunks = await retrieve_context(
                        "institute name college school", top_k=5, min_score=0.1
                    )
                    retrieval_ms = (time.time() - _r0) * 1000
                    context_text = format_context_for_prompt(retrieved_chunks)
                    institute_name = "the institute"
                    if context_text:
                        import re as _re
                        for pattern in [
                            r'(?:institute|college|school|university)[\s]+(?:name|is|called|:)\s*([A-Z][A-Za-z\s]+)',
                            r'([A-Z][A-Za-z\s]+(?:College|Institute|School|University))',
                            r'Name:\s*([A-Z][A-Za-z\s]+)',
                        ]:
                            m = _re.search(pattern, context_text, _re.IGNORECASE)
                            if m:
                                institute_name = m.group(1).strip()
                                break
                    greeting_prompt = (
                        f"You are Mrs. D, a warm Indian admissions counsellor speaking on a live call.\n"
                        f"You are representing {institute_name}.\n\n"
                        f"Context about the institute:\n{context_text or 'General admission inquiry'}\n\n"
                        f"Write a friendly, brief (2-3 sentence) greeting in {language} "
                        f"in the correct native script with proper spelling. Introduce yourself and "
                        f"mention {institute_name}. Invite the caller to ask about admissions, courses, "
                        f"fees, hostel or scholarships. Generate ONLY the greeting."
                    )
                    _l0 = time.time()
                    try:
                        ai_response = await generate_response(
                            conversation_history=[],
                            context=context_text,
                            user_message=greeting_prompt,
                        )
                        llm_ms = (time.time() - _l0) * 1000
                    except ValueError:
                        ai_response = (
                            f"Hi! I'm Mrs.D, AI Admission Counsellor of {institute_name}. "
                            f"How may I help you today?"
                        )
            else:
                _r0 = time.time()
                if mode == "test":
                    retriever = get_json_retriever(knowledge_file)
                    context = retriever.retrieve_context(llm_input, top_k=5)
                else:
                    retrieved_chunks = await retrieve_context(llm_input, top_k=5)
                    context = format_context_for_prompt(retrieved_chunks)
                retrieval_ms = (time.time() - _r0) * 1000

                memory = conversation_memory.setdefault(conv_id, [])
                history_list = _build_history(memory, conv_id)
                lang_hint = LANGUAGE_INSTRUCTION.format(language=detected_lang)
                _l0 = time.time()
                try:
                    ai_response = await generate_response(
                        conversation_history=history_list,
                        context=context,
                        user_message=f"{llm_input}\n\n{lang_hint}",
                    )
                    llm_ms = (time.time() - _l0) * 1000
                except ValueError:
                    if detected_lang == "Telugu":
                        ai_response = (
                            "అవును, మా నారాయణ కాలేజీ వివరాలు మీకు చెప్తాను. "
                            "మీకు కోర్సులు, ఫీజు లేదా అడ్మిషన్ ప్రాసెస్ గురించి ఏది కావాలి?"
                        )
                    else:
                        ai_response = (
                            "I can help with that. We offer MPC, BiPC, MEC and CEC streams. "
                            "What would you like to know more about — courses, fees or admission?"
                        )

                memory.append(user_input)
                memory.append(ai_response)
                if len(memory) > 20:
                    conversation_memory[conv_id] = memory[-20:]

            # ── Stream each sentence's audio as soon as it is ready ──────────
            synth_lang = detected_lang if not is_greeting else language
            count = 0
            _t0 = time.time()
            async for chunk in tts_service.stream_sentences(
                ai_response, language=synth_lang
            ):
                if chunk.get("audio_data") is None:
                    continue  # skip sentences with no audio (still keep order)
                yield sse_event(
                    "sentence",
                    {
                        "index": chunk["index"],
                        "text": chunk["text"],
                        "audio_data": chunk["audio_data"],
                    },
                )
                count += 1
            tts_ms = (time.time() - _t0) * 1000

            yield sse_event(
                "done",
                {
                    "ai_response": ai_response,
                    "conversation_id": conv_id,
                    "sentence_count": count,
                    "debug_info": {
                        "retrieval_time_ms": retrieval_ms,
                        "llm_time_ms": llm_ms,
                        "tts_time_ms": tts_ms,
                        "total_time_ms": (time.time() - turn_start) * 1000,
                        "sentence_count": count,
                        "knowledge_source": (
                            "json" if mode == "test" else "faiss"
                        ),
                    },
                },
            )
        except Exception as e:
            logger.error("Streaming conversation failed: %s", e)
            yield sse_event("error", {"detail": str(e)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def sse_event(event: str, data: dict) -> str:
    """Format one SSE event frame."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


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
    # Testing Console uses backend/knowledge/institute.json ONLY.
    # It is hardcoded, for developers, and NEVER touches the uploaded-PDF FAISS knowledge.
    knowledge_file: str = "institute.json",
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
        knowledge_file: JSON file name (default: institute.json — the ONLY testing knowledge)
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

            # Add to JSON retriever memory (session-only — the JSON file is never modified)
            json_retriever.add_knowledge("Manual Insert", insert_content)

            return {
                "ai_response": (
                    "✓ Knowledge Updated\n"
                    "+1 chunk added\n"
                    "Mode: Testing Console (session only)\n\n"
                    "The hardcoded JSON knowledge is never modified. "
                    "To persist knowledge, use /insert in the Real Application console (uploads to FAISS)."
                ),
                "audio_data": None,
                "debug_info": {
                    "total_time_ms": 0,
                    "is_insert_command": True,
                    "chunks_added": 1,
                    "knowledge_source": "json"
                }
            }

        # For greeting, use language-matched greeting from JSON
        if is_greeting:
            greeting = json_retriever.get_greeting(language=language)

            # Add greeting to memory
            memory.append(greeting)

            # Generate audio if requested
            audio_data = None
            sentence_audios = []
            if include_audio:
                tts_start = time.time()
                # Greeting language (detected from the hint) matches the JSON
                # greeting, so it is used directly for voice selection.
                sentence_audios = await tts_service.synthesize_sentences(
                    greeting, language=language
                )
                # Backwards-compatible full blob = concatenation of sentence blobs.
                all_audio = b"".join(
                    base64.b64decode(s["audio_data"]) for s in sentence_audios if s.get("audio_data")
                )
                audio_data = base64.b64encode(all_audio).decode('utf-8') if all_audio else None
                tts_time = (time.time() - tts_start) * 1000
            else:
                tts_time = 0

            total_time = (time.time() - start_time) * 1000

            return {
                "ai_response": greeting,
                "audio_data": audio_data,
                "sentence_audios": sentence_audios,
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
        # ── Roman-Telugu aware language detection ───────────────────────────
        # "idhi enti", "meeru ekkada unnaru" → Telugu (never English).
        detected_lang = _detect_language(user_input, hint=language)
        logger.info(f"TEST Detected language: {detected_lang} (hint was {language})")
        # Convert high-frequency Roman Telugu to Telugu script for unambiguous
        # LLM understanding. Internal only — never exposed to the caller.
        llm_input = transliterate_roman_telugu(user_input)

        retrieval_start = time.time()
        context = json_retriever.retrieve_context(llm_input, top_k=5)
        retrieval_time = (time.time() - retrieval_start) * 1000

        # Build conversation history
        history_list = _build_history(memory, conversation_id)

        # Generate response
        llm_start = time.time()
        lang_hint = LANGUAGE_INSTRUCTION.format(language=detected_lang)
        try:
            ai_response = await generate_response(
                conversation_history=history_list,
                context=context,
                # Feed the transliterated (Telugu-script) input so the LLM
                # understands Roman Telugu as Telugu — never as English.
                user_message=f"{llm_input}\n\n{lang_hint}"
            )
            llm_time = (time.time() - llm_start) * 1000
        except ValueError as e:
            # Fallback if Groq API key is not configured
            logger.warning(f"Groq API not configured, using fallback: {e}")
            if detected_lang == "Telugu":
                ai_response = (
                    "అవును, మా నారాయణ కాలేజీ వివరాలు మీకు చెప్తాను. "
                    "మీకు కోర్సులు, ఫీజు లేదా అడ్మిషన్ ప్రాసెస్ గురించి ఏది కావాలి?"
                )
            elif context:
                ai_response = (
                    "I can help with that. We offer MPC, BiPC, MEC and CEC streams. "
                    "What would you like to know more about — courses, fees or admission?"
                )
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
        sentence_audios = []
        if include_audio:
            tts_start = time.time()
            # Use the INTERNALLY detected language (which may differ from the
            # caller's hint — e.g. hint="English" but a Telugu reply) so the
            # voice can actually read the response text.
            sentence_audios = await tts_service.synthesize_sentences(
                ai_response, language=detected_lang
            )
            # Backwards-compatible full blob = concatenation of sentence blobs.
            all_audio = b"".join(
                base64.b64decode(s["audio_data"]) for s in sentence_audios if s.get("audio_data")
            )
            audio_data = base64.b64encode(all_audio).decode('utf-8') if all_audio else None
            tts_time = (time.time() - tts_start) * 1000
        else:
            tts_time = 0

        total_time = (time.time() - start_time) * 1000

        return {
            "ai_response": ai_response,
            "audio_data": audio_data,
            "sentence_audios": sentence_audios,
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

            # Persist to disk so the insert survives a restart.
            # Same path scheme as knowledge_routes (uploads/knowledge/knowledge_{institute_id}).
            try:
                from app.config.settings import settings
                vector_store.save(str(settings.KNOWLEDGE_DIR / f"knowledge_{institute_id}"))
            except Exception as save_err:
                logger.warning("Failed to persist /insert to disk: %s", save_err)

            # Ensure a READY Knowledge record exists so startup restore reloads
            # this store. Without it, /insert-before-upload knowledge would
            # vanish after a restart (_restore_vector_store only loads the
            # store of the latest READY Knowledge row).
            try:
                from app.database.connection import AsyncSessionLocal
                from app.database.models import Knowledge, KnowledgeStatus
                from sqlalchemy import select
                async with AsyncSessionLocal() as session:
                    result = await session.execute(
                        select(Knowledge)
                        .where(Knowledge.institute_id == institute_id)
                        .order_by(Knowledge.id.desc())
                        .limit(1)
                    )
                    kb = result.scalar_one_or_none()
                    if kb is None:
                        from pathlib import Path
                        session.add(Knowledge(
                            institute_id=institute_id,
                            document_name="manual_insert",
                            document_type="text",
                            file_path=str(settings.KNOWLEDGE_DIR / "manual_insert.txt"),
                            file_size=len(insert_content.encode("utf-8")),
                            status=KnowledgeStatus.READY,
                            chunks_count=len(vector_store.chunks),
                        ))
                        await session.commit()
                        logger.info("Created Knowledge record for /insert (institute %s)", institute_id)
            except Exception as db_err:
                logger.warning("Failed to create Knowledge record for /insert: %s", db_err)

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
            greeting_prompt = f"""You are Mrs. D, a warm Indian admissions counsellor speaking on a live call.
You are representing {institute_name}.

Use the following context about the institute to personalize the greeting:
{context_text if context_text else "General admission inquiry"}

The greeting should:
- Sound like a real person answering the phone: friendly, warm, brief (2-3 sentences)
- Introduce yourself and explicitly mention "{institute_name}"
- Invite the caller to ask about admissions, courses, fees, hostel, or scholarships
- NOT sound scripted, robotic, or like a translation
- Be written entirely in {language}, in the correct native script with proper spelling

Generate ONLY the greeting text, no additional commentary."""

            llm_start = time.time()
            try:
                ai_response = await generate_response(
                    conversation_history=[],
                    context=context_text,
                    user_message=greeting_prompt
                )
            except ValueError as e:
                # Fallback greeting if Groq API key is not configured
                logger.warning(f"Groq API not configured, using fallback greeting: {e}")
                ai_response = f"Hi! I'm Mrs.D, AI Admission Counsellor of {institute_name}. How may I help you today?"
            llm_time = (time.time() - llm_start) * 1000

            # Add greeting to conversation memory so follow-up turns have context
            memory.append(ai_response)
        else:
            # ── Roman-Telugu aware language detection ───────────────────────
            # "idhi enti", "meeru ekkada unnaru" → Telugu (never English).
            detected_lang = _detect_language(user_input, hint=language)
            logger.info(f"Detected language: {detected_lang} (hint was {language})")
            # Convert high-frequency Roman Telugu words to Telugu script for
            # unambiguous LLM understanding. Internal only — never shown.
            llm_input = transliterate_roman_telugu(user_input)

            # Step 1: Retrieve Knowledge (RAG)
            retrieval_start = time.time()
            # Default min_score is calibrated for all-MiniLM-L6-v2 (0.15)
            retrieved_chunks = await retrieve_context(llm_input, top_k=5)
            retrieval_time = (time.time() - retrieval_start) * 1000

            context_text = format_context_for_prompt(retrieved_chunks)

            # Step 2: Generate LLM Response
            llm_start = time.time()

            # Build conversation history for context
            # Convert history to list of dicts for groq_service
            history_list = _build_history(memory, conversation_id)

            lang_hint = LANGUAGE_INSTRUCTION.format(language=detected_lang)
            try:
                ai_response = await generate_response(
                    conversation_history=history_list,
                    context=context_text,
                    user_message=f"{llm_input}\n\n{lang_hint}"
                )
            except ValueError as e:
                # Fallback response if Groq API key is not configured
                logger.warning(f"Groq API not configured, using fallback: {e}")
                if context_text:
                    ai_response = f"Based on the information I have: {context_text[:500]}"
                else:
                    ai_response = "I apologize, but I need more information to help you. Could you please provide more details about what you're looking for?"
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
        sentence_audios = []
        tts_time = 0
        if include_audio:
            tts_start = time.time()
            # Use the internally detected language (which may differ from the
            # frontend hint) so the voice matches the response's actual script.
            synth_lang = detected_lang if not is_greeting else language
            sentence_audios = await tts_service.synthesize_sentences(
                ai_response, language=synth_lang
            )
            # Backwards-compatible full blob = concatenation of sentence blobs.
            all_audio = b"".join(
                base64.b64decode(s["audio_data"]) for s in sentence_audios if s.get("audio_data")
            )
            # Base64-encode MP3 bytes so the frontend can play them as a data URI
            audio_data = base64.b64encode(all_audio).decode('utf-8') if all_audio else None
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
            "sentence_audios": sentence_audios,
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
    status: str,
    body: SaveCallRequest,
):
    """
    Save a completed call record.

    Args:
        call_id: Unique call identifier
        institute_id: Institute ID
        duration: Call duration in seconds
        language: Detected language
        body: JSON body containing the transcript list
        status: Call status (completed, ended, etc.)

    Returns:
        Saved call record
    """
    transcript = body.transcript
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
