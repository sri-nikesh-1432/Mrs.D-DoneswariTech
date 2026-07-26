"""
/text-to-speech route
Accepts text and returns synthesized MP3 audio.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from services.tts_service import synthesize_speech
from utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=3000)


@router.post("/text-to-speech")
async def text_to_speech(request: TTSRequest):
    """
    Convert text to speech using Edge-TTS (ShrutiNeural voice).
    Returns MP3 audio bytes directly.
    """
    try:
        audio_bytes = await synthesize_speech(request.text)
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline; filename=response.mp3"},
        )
    except Exception as e:
        logger.error("TTS route error: %s", e)
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")
