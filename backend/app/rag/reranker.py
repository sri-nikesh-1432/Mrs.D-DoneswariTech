"""
Reranker — improves retrieval precision after vector search (spec §10 §47).

Combines semantic similarity with lexical relevance signals:
  - term overlap between query and chunk (BM25-flavoured weight)
  - exact-phrase match bonus
  - query-term proximity (terms close together = higher relevance)
  - small penalty for very short chunks (likely headings/fragments)

The rerank step catches the classic vector-search failure where a chunk is
"semantically nearby" but does not actually contain the asked information —
a direct fix for the "agent says it doesn't know when the answer is in the
document" problem (spec §10).
"""

import math
import re
from typing import Dict, List

from app.logs.logger import get_logger

logger = get_logger(__name__)

# Weighting: semantic similarity still dominates; lexical signals refine.
_W_SEMANTIC = 0.65
_W_TERM_OVERLAP = 0.25
_W_PHRASE = 0.10
_SHORT_CHUNK_LEN = 60  # chunks shorter than this are probably headings
_SHORT_CHUNK_PENALTY = 0.05

_STOPWORDS = {
    "what", "is", "the", "a", "an", "of", "for", "in", "on", "to", "and",
    "are", "do", "does", "did", "can", "you", "tell", "me", "about", "i",
    "want", "know", "how", "much", "many", "there", "have", "has", "with",
    "it", "its", "we", "us", "our", "your", "please", "would", "could",
    "should", "will", "shall", "may", "my", "me", "am", "be", "been",
}


def _tokenize(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9\u0c00-\u0c7f\u0900-\u097f]+", text.lower()) if t not in _STOPWORDS]


def rerank_chunks(query: str, chunks: List[Dict], top_k: int = 5) -> List[Dict]:
    """
    Rerank retrieved chunks. Returns the top_k chunks sorted by the fused
    relevance score; each chunk gets `rerank_score` and `relevance_signals`
    for the debug view.
    """
    if not chunks:
        return []

    q_terms = _tokenize(query)
    if not q_terms:
        # Nothing lexical to add — fall back to pure semantic order.
        ranked = sorted(chunks, key=lambda c: c.get("score", 0), reverse=True)
        return ranked[:top_k]

    q_set = set(q_terms)
    q_phrase = " ".join(q_terms)

    scored: List[tuple] = []
    for chunk in chunks:
        text = (chunk.get("text") or "").lower()
        c_terms = _tokenize(text)
        c_set = set(c_terms)
        if not c_set:
            continue

        # 1. Term overlap (IDF-lite: rarer query terms weigh more within the
        #    candidate set — cheap stand-in for BM25's IDF).
        overlap_terms = q_set & c_set
        if not overlap_terms:
            scored.append((0.0, chunk))
            continue

        df = sum(1 for _ in chunks)  # small candidate set
        idf_weights = []
        for t in overlap_terms:
            doc_freq = sum(1 for c in chunks if t in (c.get("text") or "").lower())
            idf_weights.append(math.log(1 + df / max(doc_freq, 1)))
        term_overlap = sum(idf_weights) / (len(idf_weights) * math.log(1 + df)) if df else 0.0

        # 2. Exact phrase match bonus.
        phrase_bonus = 0.0
        if len(q_terms) >= 2 and q_phrase in text:
            phrase_bonus = 1.0
        elif len(q_terms) >= 2:
            # Partial phrase: longest consecutive run.
            for i in range(len(q_terms) - 1):
                bigram = f"{q_terms[i]} {q_terms[i + 1]}"
                if bigram in text:
                    phrase_bonus = max(phrase_bonus, 0.5)

        # 3. Query-term proximity.
        positions = []
        for t in overlap_terms:
            idx = text.find(t)
            if idx >= 0:
                positions.append(idx)
        proximity = 0.0
        if len(positions) >= 2:
            spread = max(positions) - min(positions)
            proximity = max(0.0, 1.0 - spread / 400.0)
        elif len(positions) == 1:
            proximity = 0.5

        # 4. Short-chunk penalty.
        penalty = _SHORT_CHUNK_PENALTY if len(text) < _SHORT_CHUNK_LEN else 0.0

        fused = (
            _W_SEMANTIC * float(chunk.get("score", 0))
            + _W_TERM_OVERLAP * term_overlap
            + _W_PHRASE * phrase_bonus
            + 0.05 * proximity
            - penalty
        )

        c = dict(chunk)
        c["rerank_score"] = round(fused, 4)
        c["relevance_signals"] = {
            "term_overlap": round(term_overlap, 3),
            "phrase_bonus": phrase_bonus,
            "proximity": round(proximity, 3),
        }
        scored.append((fused, c))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    ranked = [c for _, c in scored if c is not None]

    if not ranked:
        ranked = sorted(chunks, key=lambda c: c.get("score", 0), reverse=True)

    logger.debug("Reranked %d chunks for query %.50s", len(chunks), query)
    return ranked[:top_k]
