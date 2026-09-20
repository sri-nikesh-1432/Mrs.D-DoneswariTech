"""
Real ingestion tests (spec §3 §4 §5 §7 §9 §18 §24).

These tests prove the pipeline is driven by the ACTUAL uploaded file:

  * two different PDFs produce DIFFERENT chunk counts — there is no fixed
    "11 chunks" (spec §3 §24)
  * the real page count and page numbers survive extraction + chunking
    (spec §4 §6 §7)
  * a PDF with no extractable text FAILS loudly instead of pretending
    extraction succeeded (spec §5 §21)
  * every chunk carries the metadata needed for retrieval provenance
    (spec §7)
  * agent vector stores are strictly isolated and search hits carry the
    document/page/section a fact came from (spec §9 §14)
"""

import numpy as np
import pytest

from app.rag.chunker import chunk_text
from app.rag.document_processor import extract_text_detailed
from app.rag.embeddings import generate_embeddings, generate_embedding
from app.rag.vector_store import VectorStore


def _make_pdf(path, pages):
    """Write a real text-based PDF: one entry in `pages` per PDF page."""
    import fitz  # PyMuPDF

    doc = fitz.open()
    for lines in pages:
        page = doc.new_page()
        y = 72
        for line in lines:
            page.insert_text((72, y), line)
            y += 22
    doc.save(str(path))
    doc.close()
    return path


SMALL_PAGES = [[
    "MPC Stream",
    "Intermediate MPC consists of Mathematics, Physics and Chemistry.",
    "Students can pursue engineering or JEE after MPC.",
]]


LARGE_PAGES = [
    [
        "Admissions Handbook",
        "Admission Process",
        "Student Enquiry to Academic Counselling then Course Selection.",
        "Document Verification and Seat Confirmation follow counselling.",
    ],
    [
        "Fee Structure",
        "Annual tuition ranges from 1,00,000 to 1,60,000 depending on stream.",
        "Additional charges include books, uniforms, lab fees and transport.",
        "Scholarships are available based on merit and entrance test performance.",
    ],
    [
        "Hostel Facilities",
        "Separate hostels for boys and girls with a safe environment.",
        "Study hours, wardens, nutritious food and regular monitoring.",
        "Hostel fee is payable per academic year along with the tuition.",
    ],
    [
        "Transport",
        "Bus facilities are available on selected routes.",
        "Professional drivers and GPS tracking are provided on every route.",
        "Transport fee depends on the distance from the campus.",
    ],
    [
        "Academic Features",
        "Integrated Intermediate Curriculum with Competitive Examination Coaching.",
        "Experienced Faculty, Daily Practice Sessions and Weekly Tests.",
        "Monthly Grand Tests, Subject-wise Analysis and Performance Tracking.",
        "Personal Mentoring, Study Material and Digital Learning Support.",
    ],
    [
        "Contact",
        "Admissions office is open from 9 AM to 6 PM on weekdays.",
        "Counsellors are available for campus visits and online meetings.",
        "Parents may request a callback through the admissions portal.",
    ],
]


def test_different_pdfs_produce_different_chunk_counts(tmp_path):
    """Spec §3 §18 §24: the chunk count comes from the content, not a constant."""
    small_pdf = _make_pdf(tmp_path / "small.pdf", SMALL_PAGES)
    large_pdf = _make_pdf(tmp_path / "large.pdf", LARGE_PAGES)

    small_ext = extract_text_detailed(str(small_pdf), "small.pdf")
    large_ext = extract_text_detailed(str(large_pdf), "large.pdf")

    # REAL measured page counts straight from the PDFs.
    assert small_ext.page_count == 1
    assert large_ext.page_count == 6
    assert large_ext.extracted_word_count > small_ext.extracted_word_count

    small_chunks = chunk_text(small_ext.text, source_document="small.pdf")
    large_chunks = chunk_text(large_ext.text, source_document="large.pdf")

    assert len(small_chunks) > 0
    assert len(large_chunks) > 0
    # The whole point: the two documents do NOT end with the same count.
    assert len(small_chunks) != len(large_chunks)
    assert len(large_chunks) > len(small_chunks)


def test_chunk_metadata_is_complete(tmp_path):
    """Spec §7: every chunk carries the metadata retrieval needs."""
    pdf = _make_pdf(tmp_path / "struct.pdf", LARGE_PAGES)
    ext = extract_text_detailed(str(pdf), "struct.pdf")
    chunks = chunk_text(ext.text, source_document="struct.pdf")

    assert chunks, "structure-aware chunking produced no chunks"
    for c in chunks:
        assert c["text"].strip()
        assert isinstance(c["chunk_id"], int)
        assert c["source"] == "struct.pdf"
        assert c["token_count"] >= 1
        assert c["character_count"] == len(c["text"])
        assert c["page_number"] is not None
        assert 1 <= c["page_number"] <= 6

    # Headings become real section titles that later chunks carry.
    assert any(c["section"] for c in chunks)


def test_pdf_without_extractable_text_fails(tmp_path):
    """Spec §5 §21: a scanned/empty PDF must FAIL, never fake a success."""
    import fitz

    blank = tmp_path / "blank.pdf"
    doc = fitz.open()
    doc.new_page()  # a page with no text layer
    doc.save(str(blank))
    doc.close()

    with pytest.raises(ValueError):
        extract_text_detailed(str(blank), "blank.pdf")


def test_empty_text_yields_zero_chunks():
    """Spec §21: chunking empty content returns no chunks (→ FAILED)."""
    assert chunk_text("") == []
    assert chunk_text("   \n  \n") == []


def test_agent_vector_stores_are_isolated_and_carry_provenance():
    """Spec §9 §14: agent A can never retrieve agent B's knowledge."""
    chunks_a = [{
        "text": "Intermediate MPC consists of Mathematics, Physics and Chemistry.",
        "chunk_id": 0, "source": "alpha.pdf", "page_number": 3,
        "section": "MPC Stream", "token_count": 10, "character_count": 65,
        "document_id": 11, "document_version_id": 11,
    }]
    chunks_b = [{
        "text": "The Zeta Culinary School teaches pastry baking and confectionery.",
        "chunk_id": 0, "source": "beta.pdf", "page_number": 1,
        "section": "Baking", "token_count": 9, "character_count": 67,
        "document_id": 22, "document_version_id": 22,
    }]

    store_a = VectorStore(agent_id=101)
    store_a.build_index(chunks_a, generate_embeddings(chunks_a))
    store_b = VectorStore(agent_id=102)
    store_b.build_index(chunks_b, generate_embeddings(chunks_b))

    hits_a = store_a.search(generate_embedding("what subjects are in MPC"), top_k=1)
    hits_b = store_b.search(generate_embedding("what does the culinary school teach"), top_k=1)

    assert hits_a and hits_b
    assert "Mathematics" in hits_a[0]["text"]
    assert "pastry" not in hits_a[0]["text"]
    assert "pastry" in hits_b[0]["text"]
    assert "Mathematics" not in hits_b[0]["text"]

    # Provenance travels with each hit so the debug view can explain it (§14).
    assert hits_a[0]["agent_id"] == 101
    assert hits_a[0]["page_number"] == 3
    assert hits_a[0]["section"] == "MPC Stream"
    assert hits_a[0]["document"] == "alpha.pdf"


@pytest.mark.asyncio
async def test_retrieval_never_crosses_agents(tmp_path, monkeypatch):
    """Spec §9 §18: agent A must never retrieve agent B's knowledge.

    This runs the REAL retriever against two agents' isolated FAISS stores —
    isolation is enforced in the backend, not by frontend filtering.
    """
    from app.config.settings import settings
    from app.rag.vector_store import vector_store_manager
    from app.rag.retriever import retrieve_context, invalidate_bm25

    # Keep generated indices out of the repository during the test.
    monkeypatch.setattr(settings, "BASE_DIR", tmp_path)

    chunks_a = [{
        "text": "Intermediate MPC consists of Mathematics, Physics and Chemistry at Alpha Junior College.",
        "chunk_id": 0, "source": "alpha.pdf", "page_number": 2,
        "section": "MPC Stream", "token_count": 12, "character_count": 90,
    }]
    chunks_b = [{
        "text": "Zeta Culinary School teaches pastry baking, confectionery and dessert plating.",
        "chunk_id": 0, "source": "beta.pdf", "page_number": 1,
        "section": "Baking", "token_count": 11, "character_count": 82,
    }]

    agent_a, agent_b = 9001, 9002
    vector_store_manager.save_store(agent_a, chunks_a, generate_embeddings(chunks_a))
    vector_store_manager.save_store(agent_b, chunks_b, generate_embeddings(chunks_b))
    invalidate_bm25(agent_a)
    invalidate_bm25(agent_b)

    try:
        hits_a = await retrieve_context("what subjects are in MPC", top_k=3, agent_id=agent_a)
        hits_b = await retrieve_context("what does the culinary school teach", top_k=3, agent_id=agent_b)

        assert hits_a, "agent A retrieved nothing from its own knowledge"
        assert hits_b, "agent B retrieved nothing from its own knowledge"
        assert "Mathematics" in hits_a[0]["text"]
        assert all("pastry" not in h["text"] for h in hits_a)
        assert "pastry" in hits_b[0]["text"]
        assert all("Mathematics" not in h["text"] for h in hits_b)

        # Provenance is available on retrieval hits (spec §7 §14).
        assert hits_a[0].get("page_number") == 2
        assert hits_a[0].get("source") == "alpha.pdf"
    finally:
        vector_store_manager._stores.pop(agent_a, None)
        vector_store_manager._stores.pop(agent_b, None)
        invalidate_bm25(agent_a)
        invalidate_bm25(agent_b)


def test_embedding_count_always_matches_chunk_count(tmp_path):
    """Spec §8: embedding_count == actual_chunk_count, measured."""
    pdf = _make_pdf(tmp_path / "counts.pdf", LARGE_PAGES)
    ext = extract_text_detailed(str(pdf), "counts.pdf")
    chunks = chunk_text(ext.text, source_document="counts.pdf")

    embeddings = generate_embeddings(chunks)
    assert embeddings.shape[0] == len(chunks)
    assert not np.isnan(embeddings).any()
