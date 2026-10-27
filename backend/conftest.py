"""
Pytest configuration.

`test_rag_pipeline.py` is a standalone diagnostic script (run with
`python test_rag_pipeline.py`), not a pytest test module — its plain
`async def` body would otherwise fail pytest collection.
"""

# Pre-import faiss before pytest assertion rewriting intercepts module loading on Windows/Python 3.13
try:
    import faiss  # noqa: F401
except Exception:
    pass

collect_ignore = ["test_rag_pipeline.py"]

