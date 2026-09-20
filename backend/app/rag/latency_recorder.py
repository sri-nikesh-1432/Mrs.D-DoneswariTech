"""
Per-turn latency recording (spec: STRICT REALTIME VOICE LATENCY REQUIREMENT).

The KPI is response_latency_ms = first_audio_played - user_speech_end with a
hard ≤700ms target. Every voice turn (web preview, real phone call, dry-run)
records its REAL measured timestamps here — never estimated.
"""

from typing import Optional, List, Dict
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import AsyncSessionLocal
from app.database.models import TurnLatency
from app.logs.logger import get_logger

logger = get_logger(__name__)

LATENCY_TARGET_MS = 700


async def record_turn_latency(
    call_id: str,
    agent_id: int,
    turn_index: int,
    metrics: Dict,
    source: str = "web",
    language: Optional[str] = None,
) -> None:
    """
    Persist one turn's REAL measured latency timestamps.

    `metrics` comes from the LatencyTracker.get_metrics() dict produced during
    the turn (ttfa_ms, stt_ms, rag_ms, llm_ttft_ms, tts_first_audio_ms, ...).
    response_latency_ms is derived from the measured speech_end → first_audio
    delta. Best-effort: never raises into the voice path.
    """
    try:
        speech_end = metrics.get("speech_end_ms")
        first_audio = metrics.get("first_audio_played_ms")
        response_latency = None
        if speech_end and first_audio and first_audio >= speech_end:
            response_latency = int(first_audio - speech_end)
        elif metrics.get("response_latency_ms") is not None:
            # Pre-computed measured speech_end → first-audible-audio gap from
            # the voice pipeline (server clock, client-confirmed playback).
            response_latency = int(metrics["response_latency_ms"])
        elif metrics.get("ttfa_ms") is not None:
            # ttfa_ms is the measured speech_end → tts_first_audio gap
            response_latency = int(metrics["ttfa_ms"])

        async with AsyncSessionLocal() as session:
            session.add(TurnLatency(
                call_id=call_id,
                agent_id=agent_id,
                turn_index=turn_index,
                user_speech_start_ms=metrics.get("speech_start_ms"),
                user_speech_end_ms=speech_end,
                turn_detected_ms=metrics.get("turn_detected_ms"),
                stt_start_ms=metrics.get("stt_start_ms"),
                stt_end_ms=metrics.get("stt_end_ms"),
                retrieval_start_ms=metrics.get("retrieval_start_ms"),
                retrieval_end_ms=metrics.get("retrieval_end_ms"),
                llm_start_ms=metrics.get("llm_start_ms"),
                llm_first_token_ms=metrics.get("llm_first_token_ms"),
                tts_start_ms=metrics.get("tts_start_ms"),
                tts_first_audio_ms=metrics.get("tts_first_audio_ms"),
                first_audio_played_ms=first_audio,
                response_latency_ms=response_latency,
                language=language,
                source=source,
            ))
            await session.commit()
        if response_latency is not None:
            logger.info(
                "LATENCY | turn=%d agent=%d response_latency=%dms %s",
                turn_index, agent_id, response_latency,
                "PASS" if response_latency <= LATENCY_TARGET_MS else "FAIL",
            )
    except Exception as e:
        logger.warning("record_turn_latency failed (non-fatal): %s", e)


def _percentile(sorted_vals: List[int], pct: float) -> Optional[int]:
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * pct / 100.0
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return int(sorted_vals[f])
    return int(sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f))


async def get_latency_dashboard(agent_id: int, limit: int = 1000) -> Dict:
    """
    Aggregate REAL latency stats for one agent: avg/median/P90/P95/max,
    pass-rate vs the 700ms target, and per-stage breakdown (measured only).
    """
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(TurnLatency)
            .where(TurnLatency.agent_id == agent_id)
            .order_by(TurnLatency.id.desc())
            .limit(limit)
        )
        rows = res.scalars().all()

    latencies = sorted(r.response_latency_ms for r in rows if r.response_latency_ms is not None)
    n = len(latencies)

    def _avg(vals: List[Optional[int]]) -> Optional[int]:
        vals = [v for v in vals if v is not None]
        return round(sum(vals) / len(vals)) if vals else None

    if n == 0:
        return {
            "has_data": False,
            "message": "No measured turns yet — latency stats appear after real voice conversations.",
            "target_ms": LATENCY_TARGET_MS,
        }

    passes = sum(1 for v in latencies if v <= LATENCY_TARGET_MS)
    return {
        "has_data": True,
        "target_ms": LATENCY_TARGET_MS,
        "sample_count": n,
        "avg_ms": round(sum(latencies) / n),
        "median_ms": _percentile(latencies, 50),
        "p90_ms": _percentile(latencies, 90),
        "p95_ms": _percentile(latencies, 95),
        "max_ms": latencies[-1],
        "min_ms": latencies[0],
        "pass_count": passes,
        "fail_count": n - passes,
        "pass_rate_percent": round(passes / n * 100, 1),
        # Per-stage breakdown — each measured from real timestamps.
        "stages": {
            "stt_ms": _avg([_stage(r, "stt") for r in rows]),
            "retrieval_ms": _avg([_stage(r, "retrieval") for r in rows]),
            "llm_first_token_ms": _avg([_stage(r, "llm") for r in rows]),
            "tts_first_audio_ms": _avg([_stage(r, "tts") for r in rows]),
        },
    }


def _stage(r: TurnLatency, kind: str) -> Optional[int]:
    if kind == "stt" and r.stt_start_ms and r.stt_end_ms:
        return int(r.stt_end_ms - r.stt_start_ms)
    if kind == "retrieval" and r.retrieval_start_ms and r.retrieval_end_ms:
        return int(r.retrieval_end_ms - r.retrieval_start_ms)
    if kind == "llm" and r.llm_start_ms and r.llm_first_token_ms:
        return int(r.llm_first_token_ms - r.llm_start_ms)
    if kind == "tts" and r.tts_start_ms and r.tts_first_audio_ms:
        return int(r.tts_first_audio_ms - r.tts_start_ms)
    return None
