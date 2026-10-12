import httpx
from typing import Optional
from app.config import settings

ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"


async def text_to_speech_stream(text: str, voice_id: Optional[str] = None) -> bytes:
    """
    Convert text to speech using ElevenLabs API.
    Returns audio bytes (mp3).
    """
    if not settings.elevenlabs_api_key:
        raise ValueError("ELEVENLABS_API_KEY not configured")

    vid = voice_id or settings.elevenlabs_voice_id
    url = f"{ELEVENLABS_BASE}/text-to-speech/{vid}"

    headers = {
        "xi-api-key": settings.elevenlabs_api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }

    payload = {
        "text": text,
        "model_id": "eleven_turbo_v2_5",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.8,
            "style": 0.2,
            "use_speaker_boost": True,
        },
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        return response.content


async def get_available_voices() -> list:
    if not settings.elevenlabs_api_key:
        return []
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{ELEVENLABS_BASE}/voices",
            headers={"xi-api-key": settings.elevenlabs_api_key},
        )
        if resp.status_code == 200:
            return resp.json().get("voices", [])
    return []
