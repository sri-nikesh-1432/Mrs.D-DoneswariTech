"""
Authentication Service for Doneswari AI Telecaller Platform.
Provides secure password hashing, JWT token creation, and validation.
"""

import hashlib
import hmac
import os
import time
import json
import base64
from typing import Optional, Dict, Any
from app.config.settings import settings


def hash_password(password: str) -> str:
    """Hash password using PBKDF2-HMAC-SHA256 with a unique salt."""
    salt = os.urandom(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return f"{salt.hex()}:{hashed.hex()}"


def verify_password(plain_password: str, stored_hash: str) -> bool:
    """Verify plain password against stored hash."""
    try:
        salt_hex, hash_hex = stored_hash.split(":")
        salt = bytes.fromhex(salt_hex)
        expected_hash = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, 100000)
        return hmac.compare_digest(expected_hash.hex(), hash_hex)
    except Exception:
        return False


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(s: str) -> bytes:
    padding = 4 - (len(s) % 4)
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s.encode("utf-8"))


def create_access_token(data: Dict[str, Any], expires_in_seconds: int = 86400 * 7) -> str:
    """Create a tamper-proof signed token without external dependencies."""
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        **data,
        "exp": int(time.time()) + expires_in_seconds,
        "iat": int(time.time()),
    }
    
    header_b64 = _b64url_encode(json.dumps(header).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    
    signature = hmac.new(settings.SECRET_KEY.encode("utf-8"), signing_input, hashlib.sha256).digest()
    sig_b64 = _b64url_encode(signature)
    
    return f"{header_b64}.{payload_b64}.{sig_b64}"


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify and decode token."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        
        header_b64, payload_b64, sig_b64 = parts
        signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
        
        expected_sig = hmac.new(settings.SECRET_KEY.encode("utf-8"), signing_input, hashlib.sha256).digest()
        actual_sig = _b64url_decode(sig_b64)
        
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
        if payload.get("exp", 0) < int(time.time()):
            return None  # Expired
            
        return payload
    except Exception:
        return None
