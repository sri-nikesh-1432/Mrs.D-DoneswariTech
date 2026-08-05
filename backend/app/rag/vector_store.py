"""
FAISS Vector Store — Stores chunk embeddings and provides similarity search.
"""

import os
import pickle
from typing import List, Dict, Optional, Tuple
import numpy as np
import faiss

from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)


class VectorStore:
    """FAISS-based vector store for RAG."""

    def __init__(self):
        self.index: Optional[faiss.Index] = None
        self.chunks: List[Dict] = []
        self.dimension: int = 384  # all-MiniLM-L6-v2 dimension
        self.is_ready: bool = False

    def build_index(self, chunks: List[Dict], embeddings: np.ndarray) -> None:
        """
        Build FAISS index from chunks and their embeddings.
        
        Args:
            chunks: List of chunk dicts with metadata
            embeddings: numpy array of shape (n_chunks, embedding_dim)
        """
        logger.info(f"=== STEP 6: VECTOR STORE BUILD ===")
        logger.info(f"Number of chunks: {len(chunks)}")
        logger.info(f"Embeddings shape: {embeddings.shape}")
        
        if len(chunks) == 0:
            logger.error("✗ No chunks to index")
            logger.error("STEP 6 FAILED: Cannot build index with empty chunks")
            return

        if len(chunks) != embeddings.shape[0]:
            logger.error(f"✗ Chunk count {len(chunks)} does not match embedding count {embeddings.shape[0]}")
            logger.error("STEP 6 FAILED: Chunk/embedding count mismatch")
            raise ValueError(f"Chunk count {len(chunks)} does not match embedding count {embeddings.shape[0]}")
        
        logger.info("✓ Chunk count matches embedding count")

        dimension = embeddings.shape[1]
        self.dimension = dimension
        logger.info(f"Embedding dimension: {dimension}")

        # Verify all chunks have required fields
        missing_fields = []
        for i, chunk in enumerate(chunks):
            if "text" not in chunk:
                missing_fields.append((i, "text"))
            if "chunk_id" not in chunk:
                missing_fields.append((i, "chunk_id"))
            if "source" not in chunk:
                missing_fields.append((i, "source"))
        
        if missing_fields:
            logger.error(f"✗ Found {len(missing_fields)} chunks with missing fields: {missing_fields[:5]}")
            logger.error("STEP 6 FAILED: Chunks missing required fields")
            raise ValueError(f"Found {len(missing_fields)} chunks with missing fields")
        
        logger.info("✓ All chunks have required fields (text, chunk_id, source)")

        # Normalize embeddings for cosine similarity
        faiss.normalize_L2(embeddings)
        logger.info("✓ Embeddings normalized for cosine similarity")

        # Create index
        self.index = faiss.IndexFlatIP(dimension)  # Inner product = cosine similarity on normalized vectors
        logger.info(f"Created FAISS IndexFlatIP with dimension {dimension}")
        
        self.index.add(embeddings)
        logger.info(f"Added {embeddings.shape[0]} embeddings to FAISS index")
        
        # Verify embeddings were added
        if self.index.ntotal != embeddings.shape[0]:
            logger.error(f"✗ FAISS index count {self.index.ntotal} does not match embedding count {embeddings.shape[0]}")
            logger.error("STEP 6 FAILED: FAISS index count mismatch")
            raise ValueError(f"FAISS index count {self.index.ntotal} does not match embedding count {embeddings.shape[0]}")
        
        logger.info("✓ FAISS index count matches embedding count")
        
        self.chunks = chunks
        self.is_ready = True
        logger.info("✓ Vector store marked as ready")

        # Verify no duplicate chunk IDs
        chunk_ids = [c["chunk_id"] for c in chunks]
        if len(chunk_ids) != len(set(chunk_ids)):
            duplicates = [id for id in chunk_ids if chunk_ids.count(id) > 1]
            logger.error(f"✗ Found duplicate chunk IDs: {set(duplicates)}")
            logger.error("STEP 6 FAILED: Duplicate chunk IDs detected")
            raise ValueError(f"Found duplicate chunk IDs: {set(duplicates)}")
        
        logger.info("✓ No duplicate chunk IDs")
        
        # Verify no empty chunk texts
        empty_texts = [i for i, c in enumerate(chunks) if not c.get("text") or not c["text"].strip()]
        if empty_texts:
            logger.error(f"✗ Found {len(empty_texts)} chunks with empty text at indices: {empty_texts}")
            logger.error("STEP 6 FAILED: Empty chunk texts detected")
            raise ValueError(f"Found {len(empty_texts)} chunks with empty text")
        
        logger.info("✓ No empty chunk texts")

        logger.info(
            "FAISS index built: %d chunks, dim=%d",
            len(chunks), dimension,
        )
        logger.info(f"=== STEP 6 COMPLETE: VECTOR STORE BUILD SUCCESSFUL ===")

    def search(self, query_embedding: np.ndarray, top_k: int = None) -> List[Dict]:
        """
        Search for most similar chunks to the query embedding.
        
        Args:
            query_embedding: Query embedding vector (1D or 2D array)
            top_k: Number of results to return (default from settings)
            
        Returns:
            List of dicts with chunk data and similarity scores
        """
        if not self.is_ready or self.index is None:
            logger.warning("Vector store not ready for search")
            return []

        if top_k is None:
            top_k = settings.TOP_K_RESULTS

        # Ensure 2D array
        if query_embedding.ndim == 1:
            query_embedding = query_embedding.reshape(1, -1)

        # Normalize query
        faiss.normalize_L2(query_embedding)

        # Search
        scores, indices = self.index.search(query_embedding, min(top_k, len(self.chunks)))

        results = []
        for i, idx in enumerate(indices[0]):
            if idx < len(self.chunks):
                chunk = self.chunks[idx]
                results.append({
                    "text": chunk["text"],
                    "chunk_id": chunk["chunk_id"],
                    "source": chunk.get("source", "unknown"),
                    "score": float(scores[0][i]),
                })

        return results

    def save(self, path: str) -> None:
        """Save the vector store to disk."""
        if not self.is_ready:
            logger.warning("Cannot save empty vector store")
            return

        os.makedirs(os.path.dirname(path), exist_ok=True)

        # Save FAISS index
        faiss.write_index(self.index, f"{path}.index")
        # Save chunks
        with open(f"{path}.chunks.pkl", "wb") as f:
            pickle.dump(self.chunks, f)

        logger.info("Vector store saved to %s", path)

    def load(self, path: str) -> bool:
        """Load the vector store from disk. Returns True if successful."""
        try:
            if os.path.exists(f"{path}.index") and os.path.exists(f"{path}.chunks.pkl"):
                self.index = faiss.read_index(f"{path}.index")
                with open(f"{path}.chunks.pkl", "rb") as f:
                    self.chunks = pickle.load(f)
                self.dimension = self.index.d
                self.is_ready = True
                logger.info("Vector store loaded from %s (%d chunks)", path, len(self.chunks))
                return True
        except Exception as e:
            logger.error("Failed to load vector store: %s", e)
        return False

    def clear(self) -> None:
        """Clear the vector store."""
        self.index = None
        self.chunks = []
        self.is_ready = False
        logger.info("Vector store cleared")
    
    def append_chunks(self, new_chunks: List[Dict], new_embeddings: np.ndarray) -> None:
        """
        Append new chunks to existing vector store.
        
        Args:
            new_chunks: List of new chunk dicts with metadata
            new_embeddings: numpy array of shape (n_new_chunks, embedding_dim)
        """
        logger.info(f"=== APPENDING CHUNKS TO VECTOR STORE ===")
        logger.info(f"Existing chunks: {len(self.chunks)}")
        logger.info(f"New chunks to add: {len(new_chunks)}")
        
        if not self.is_ready or self.index is None:
            logger.warning("Vector store not ready, building new index instead")
            self.build_index(new_chunks, new_embeddings)
            return
        
        if len(new_chunks) != new_embeddings.shape[0]:
            logger.error(f"Chunk count {len(new_chunks)} does not match embedding count {new_embeddings.shape[0]}")
            raise ValueError(f"Chunk count {len(new_chunks)} does not match embedding count {new_embeddings.shape[0]}")
        
        # Re-key chunk IDs so they stay unique across the whole store.
        # chunk_text numbers from 0, so appended chunks would otherwise
        # duplicate existing chunk_ids and break the uniqueness invariant.
        offset = len(self.chunks)
        for i, chunk in enumerate(new_chunks):
            chunk["chunk_id"] = offset + i
        
        # Normalize new embeddings
        faiss.normalize_L2(new_embeddings)
        
        # Add to existing index
        self.index.add(new_embeddings)
        logger.info(f"Added {new_embeddings.shape[0]} new embeddings to FAISS index")
        
        # Append chunks
        self.chunks.extend(new_chunks)
        logger.info(f"Total chunks in vector store: {len(self.chunks)}")
        
        logger.info(f"=== APPEND COMPLETE: {len(new_chunks)} chunks added ===")


# Global singleton vector store
vector_store = VectorStore()
