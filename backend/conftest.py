"""
Pytest configuration.

`test_rag_pipeline.py` is a standalone diagnostic script (run with
`python test_rag_pipeline.py`), not a pytest test module — its plain
`async def` body would otherwise fail pytest collection.
"""

collect_ignore = ["test_rag_pipeline.py"]
