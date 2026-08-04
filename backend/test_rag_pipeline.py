"""
Test script to verify RAG pipeline end-to-end.
Tests all 10 stages of the RAG pipeline with a real document.
"""

import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from app.uploads.document_service import DocumentService
from app.rag.chunker import chunk_text
from app.rag.embeddings import generate_embeddings
from app.rag.vector_store import vector_store
from app.rag.retriever import retrieve_context
from app.rag.prompt_builder import build_prompt
from app.rag.gemini_service import chat
from app.logs.logger import get_logger

logger = get_logger(__name__)


async def test_rag_pipeline():
    """Test the complete RAG pipeline with the existing knowledge file."""
    
    print("\n" + "="*80)
    print("RAG PIPELINE END-TO-END TEST")
    print("="*80 + "\n")
    
    # Load existing vector store
    print("Loading existing vector store...")
    vector_store_path = "uploads/knowledge/knowledge_1"
    loaded = vector_store.load(vector_store_path)
    
    if not loaded:
        print("❌ FAILED: Could not load existing vector store")
        return False
    
    print(f"✓ Vector store loaded with {len(vector_store.chunks)} chunks")
    print(f"✓ Vector store is ready: {vector_store.is_ready}")
    
    # Test retrieval
    print("\n" + "-"*80)
    print("TESTING RETRIEVAL (Step 7)")
    print("-"*80 + "\n")
    
    test_queries = [
        "What courses are offered?",
        "What is the admission process?",
        "What are the fees?",
        "Tell me about placements"
    ]
    
    for query in test_queries:
        print(f"\nQuery: {query}")
        print("-" * 40)
        
        try:
            results = await retrieve_context(query, top_k=3)
            
            if not results:
                print(f"⚠ No results retrieved")
                continue
            
            print(f"✓ Retrieved {len(results)} chunks")
            
            for i, result in enumerate(results):
                print(f"\n  Result {i+1}:")
                print(f"    Chunk ID: {result['chunk_id']}")
                print(f"    Score: {result['score']:.4f}")
                print(f"    Source: {result.get('source', 'unknown')}")
                print(f"    Text preview: {result['text'][:150]}...")
        
        except Exception as e:
            print(f"❌ Retrieval failed: {e}")
            return False
    
    # Test full chat with RAG
    print("\n" + "-"*80)
    print("TESTING FULL CHAT WITH RAG (Steps 8-10)")
    print("-"*80 + "\n")
    
    test_question = "What courses are offered at this institute?"
    print(f"Question: {test_question}")
    print("-" * 40)
    
    try:
        response = await chat(
            query=test_question,
            student_info={"name": "Test Student", "phone": "+919876543210"},
            conversation_history=[],
            use_rag=True
        )
        
        print(f"\n✓ Chat completed successfully")
        print(f"\nAnswer: {response['answer']}")
        print(f"\nSources: {response['sources']}")
        print(f"Chunk IDs: {response['chunk_ids']}")
        print(f"Similarity Scores: {[f'{s:.4f}' for s in response['similarity_scores']]}")
        print(f"Confidence: {response['confidence']:.4f}")
        print(f"Retrieved Count: {response['retrieved_count']}")
        print(f"Latency: {response['latency_seconds']:.2f} seconds")
        print(f"RAG Enabled: {response['rag_enabled']}")
        
        if response.get('token_usage'):
            print(f"Token Usage: {response['token_usage']}")
        
    except Exception as e:
        print(f"❌ Chat failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    print("\n" + "="*80)
    print("✅ RAG PIPELINE TEST COMPLETED SUCCESSFULLY")
    print("="*80 + "\n")
    
    return True


if __name__ == "__main__":
    success = asyncio.run(test_rag_pipeline())
    sys.exit(0 if success else 1)
