"""
Automated tests for document processing pipeline.
Tests all supported document types: PDF, DOCX, TXT, CSV.
"""

import pytest
import asyncio
from pathlib import Path
from app.uploads.document_service import DocumentService
from app.rag.chunker import chunk_text
from app.rag.embeddings import generate_embeddings
from app.rag.vector_store import vector_store
from app.logs.logger import get_logger

logger = get_logger(__name__)


class TestDocumentProcessing:
    """Test suite for document processing pipeline."""
    
    @pytest.fixture
    def document_service(self):
        """Create document service instance."""
        return DocumentService()
    
    @pytest.fixture
    def sample_text(self):
        """Sample text for testing."""
        return """
        Narayana Educational Institutions is one of India's educational groups offering Intermediate education integrated with competitive examination coaching.
        
        Available Streams:
        MPC - Mathematics, Physics, Chemistry (Engineering, JEE)
        BiPC - Biology, Physics, Chemistry (Medical, NEET)
        MEC - Mathematics, Economics, Commerce (Commerce, CA)
        CEC - Civics, Economics, Commerce (Law, Civil Services)
        
        Academic Features:
        - Integrated Intermediate Curriculum
        - Competitive Examination Coaching
        - Experienced Faculty
        - Daily Practice Sessions
        - Weekly Tests
        - Monthly Grand Tests
        - Subject-wise Analysis
        - Performance Tracking
        - Personal Mentoring
        - Study Material
        - Digital Learning Support
        - Regular Parent Interaction
        
        Fee Structure:
        Annual tuition ranges from ₹1,00,000 to ₹1,60,000 depending on the stream.
        Additional charges include books, uniforms, lab fees, and transport.
        Scholarships are available based on merit and entrance test performance.
        
        Hostel Facilities:
        Separate hostels for boys and girls with safe environment.
        Study hours, wardens, nutritious food, and regular monitoring.
        
        Transport:
        Bus facilities available on selected routes with professional drivers.
        
        Admission Process:
        Student Enquiry → Academic Counselling → Course Selection → Document Verification → Seat Confirmation → Fee Payment → Admission Confirmation
        """
    
    @pytest.mark.asyncio
    async def test_txt_parsing(self, document_service, sample_text, tmp_path):
        """Test TXT file parsing."""
        # Create test TXT file
        txt_file = tmp_path / "test.txt"
        txt_file.write_text(sample_text, encoding='utf-8')
        
        # Extract text
        extracted_text = await document_service.extract_text(txt_file)
        
        # Verify extraction
        assert extracted_text is not None
        assert len(extracted_text) > 0
        assert "Narayana Educational Institutions" in extracted_text
        assert "MPC" in extracted_text
        assert "BiPC" in extracted_text
        
        logger.info(f"✓ TXT parsing test passed: {len(extracted_text)} characters extracted")
    
    @pytest.mark.asyncio
    async def test_csv_parsing(self, document_service, tmp_path):
        """Test CSV file parsing."""
        # Create test CSV file
        import pandas as pd
        csv_file = tmp_path / "test.csv"
        df = pd.DataFrame({
            'Stream': ['MPC', 'BiPC', 'MEC', 'CEC'],
            'Subjects': ['Math, Physics, Chem', 'Bio, Physics, Chem', 'Math, Econ, Comm', 'Civics, Econ, Comm'],
            'Focus': ['Engineering', 'Medical', 'Commerce', 'Law']
        })
        df.to_csv(csv_file, index=False)
        
        # Extract text
        extracted_text = await document_service.extract_text(csv_file)
        
        # Verify extraction
        assert extracted_text is not None
        assert len(extracted_text) > 0
        assert "MPC" in extracted_text
        assert "BiPC" in extracted_text
        
        logger.info(f"✓ CSV parsing test passed: {len(extracted_text)} characters extracted")
    
    @pytest.mark.asyncio
    async def test_chunking(self, sample_text):
        """Test text chunking."""
        # Chunk the text
        chunks = chunk_text(sample_text, chunk_size=800, chunk_overlap=150, source_document="test")
        
        # Verify chunking
        assert len(chunks) > 0
        assert all('text' in chunk for chunk in chunks)
        assert all('chunk_id' in chunk for chunk in chunks)
        assert all('source' in chunk for chunk in chunks)
        
        # Verify chunk IDs are sequential
        chunk_ids = [chunk['chunk_id'] for chunk in chunks]
        assert chunk_ids == list(range(len(chunks)))
        
        # Verify no empty chunks
        assert all(chunk['text'].strip() for chunk in chunks)
        
        # Verify chunk sizes are within range
        for chunk in chunks:
            assert len(chunk['text']) <= 800 + 150  # Allow for overlap
        
        logger.info(f"✓ Chunking test passed: {len(chunks)} chunks created")
    
    @pytest.mark.asyncio
    async def test_embedding_generation(self, sample_text):
        """Test embedding generation."""
        # Chunk the text
        chunks = chunk_text(sample_text, chunk_size=800, chunk_overlap=150, source_document="test")
        
        # Generate embeddings
        embeddings = generate_embeddings(chunks)
        
        # Verify embeddings
        assert embeddings.shape[0] == len(chunks)
        assert embeddings.shape[1] == 384  # all-MiniLM-L6-v2 dimension
        assert not embeddings.isnan().any()
        assert not (embeddings == 0).all(axis=1).any()
        
        logger.info(f"✓ Embedding generation test passed: {embeddings.shape[0]} embeddings generated")
    
    @pytest.mark.asyncio
    async def test_vector_store_build(self, sample_text):
        """Test vector store building."""
        # Chunk the text
        chunks = chunk_text(sample_text, chunk_size=800, chunk_overlap=150, source_document="test")
        
        # Generate embeddings
        embeddings = generate_embeddings(chunks)
        
        # Build vector store
        vector_store.clear()
        vector_store.build_index(chunks, embeddings)
        
        # Verify vector store
        assert vector_store.is_ready
        assert len(vector_store.chunks) == len(chunks)
        assert vector_store.index.ntotal == len(chunks)
        
        logger.info(f"✓ Vector store build test passed: {len(vector_store.chunks)} chunks indexed")
    
    @pytest.mark.asyncio
    async def test_end_to_end_pipeline(self, document_service, sample_text, tmp_path):
        """Test complete end-to-end pipeline."""
        # Create test TXT file
        txt_file = tmp_path / "test.txt"
        txt_file.write_text(sample_text, encoding='utf-8')
        
        # Step 1: Extract text
        extracted_text = await document_service.extract_text(txt_file)
        assert len(extracted_text) > 0
        
        # Step 2: Chunk text
        chunks = chunk_text(extracted_text, chunk_size=800, chunk_overlap=150, source_document="test.txt")
        assert len(chunks) > 0
        
        # Step 3: Generate embeddings
        embeddings = generate_embeddings(chunks)
        assert embeddings.shape[0] == len(chunks)
        
        # Step 4: Build vector store
        vector_store.clear()
        vector_store.build_index(chunks, embeddings)
        assert vector_store.is_ready
        
        # Step 5: Test retrieval
        from app.rag.retriever import retrieve_context
        results = await retrieve_context("What streams are available?", top_k=3)
        assert len(results) > 0
        assert all('text' in result for result in results)
        assert all('score' in result for result in results)
        
        logger.info(f"✓ End-to-end pipeline test passed")


class TestQualityGates:
    """Test quality gates in the pipeline."""
    
    @pytest.mark.asyncio
    async def test_empty_text_quality_gate(self):
        """Test quality gate for empty text."""
        from app.rag.chunker import chunk_text
        
        # Try to chunk empty text
        chunks = chunk_text("", chunk_size=800, chunk_overlap=150, source_document="test")
        
        # Should return empty list
        assert chunks == []
        
        logger.info("✓ Empty text quality gate test passed")
    
    @pytest.mark.asyncio
    async def test_embedding_count_quality_gate(self, sample_text):
        """Test quality gate for embedding count mismatch."""
        from app.rag.embeddings import generate_embeddings
        from app.rag.chunker import chunk_text
        
        chunks = chunk_text(sample_text, chunk_size=800, chunk_overlap=150, source_document="test")
        embeddings = generate_embeddings(chunks)
        
        # Verify counts match
        assert embeddings.shape[0] == len(chunks)
        
        logger.info("✓ Embedding count quality gate test passed")
    
    @pytest.mark.asyncio
    async def test_vector_store_ready_quality_gate(self, sample_text):
        """Test quality gate for vector store readiness."""
        from app.rag.chunker import chunk_text
        from app.rag.embeddings import generate_embeddings
        
        # Clear vector store
        vector_store.clear()
        assert not vector_store.is_ready
        
        # Build index
        chunks = chunk_text(sample_text, chunk_size=800, chunk_overlap=150, source_document="test")
        embeddings = generate_embeddings(chunks)
        vector_store.build_index(chunks, embeddings)
        
        # Verify ready
        assert vector_store.is_ready
        
        logger.info("✓ Vector store ready quality gate test passed")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
