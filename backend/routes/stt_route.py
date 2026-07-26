"""
/speech-to-text route
Accepts audio file upload and returns transcribed text.
"""

from fastapi import APIRouter, UploadFile, File, HTTPException
from services.stt_service import transcribe_audio
from utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


@router.post("/speech-to-text")
async def speech_to_text(audio: UploadFile = File(...)):
    """
    Transcribe uploaded audio to text using Whisper Large V3 Turbo.
    Accepts: webm, mp3, wav, m4a, ogg, flac
    """
    # Validate file type
    allowed_types = {"audio/webm", "audio/mpeg", "audio/wav", "audio/mp4",
                     "audio/ogg", "audio/flac", "audio/x-m4a", "video/webm"}
    if audio.content_type and audio.content_type not in allowed_types:
        logger.warning("Rejected unsupported audio type: %s", audio.content_type)
        raise HTTPException(status_code=415, detail=f"Unsupported audio format: {audio.content_type}")

    audio_bytes = await audio.read()
    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio file is too small or empty")

    try:
        text = await transcribe_audio(audio_bytes, filename=audio.filename or "audio.webm")
        return {"transcript": text, "filename": audio.filename}
    except Exception as e:
        logger.error("STT route error: %s", e)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
