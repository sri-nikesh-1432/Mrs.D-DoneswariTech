"""
End-to-end latency test for Doneswari AI Telecaller
Tests: health, text-chat, conversation/stream, frontend serving
Target: <700ms for critical path (LLM + TTS first sentence)
"""
import requests
import time
import json
import sys
import os
os.environ["PYTHONIOENCODING"] = "utf-8"

BASE_BACKEND = "http://localhost:8000"
BASE_FRONTEND = "http://localhost:5173"

results = []

def test(name, func):
    print(f"\n{'='*60}")
    print(f"TEST: {name}")
    print(f"{'='*60}")
    start = time.time()
    try:
        result = func()
        elapsed = (time.time() - start) * 1000
        print(f"  [PASS] ({elapsed:.0f}ms)")
        results.append({"name": name, "status": "PASS", "ms": round(elapsed), "details": result})
        return result
    except Exception as e:
        elapsed = (time.time() - start) * 1000
        print(f"  [FAIL] ({elapsed:.0f}ms): {e}")
        results.append({"name": name, "status": "FAIL", "ms": round(elapsed), "error": str(e)})
        return None

# ── 1. Health Check ──────────────────────────────────────────────
def test_health():
    r = requests.get(f"{BASE_BACKEND}/", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "running"
    print(f"  Backend version: {data.get('version', 'unknown')}")
    return data

def test_health_detailed():
    r = requests.get(f"{BASE_BACKEND}/health", timeout=10)
    assert r.status_code == 200
    data = r.json()
    print(f"  Groq configured: {data.get('groq_configured')}")
    print(f"  Models: {data.get('models')}")
    return data

# ── 2. Frontend Serving ──────────────────────────────────────────
def test_frontend_serves():
    r = requests.get(f"{BASE_FRONTEND}/", timeout=10)
    assert r.status_code == 200
    assert "html" in r.headers.get("content-type", "").lower()
    print(f"  Content-Type: {r.headers.get('content-type')}")
    print(f"  Content-Length: {len(r.content)} bytes")
    return {"status_code": r.status_code, "content_length": len(r.content)}

def test_frontend_proxy():
    """Test that the Vite proxy forwards /api to backend"""
    r = requests.get(f"{BASE_FRONTEND}/api/health", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "running"
    print(f"  Proxy works! Got: {data}")
    return data

# ── 3. Text Chat (Non-streaming) ────────────────────────────────
def test_text_chat():
    start = time.time()
    r = requests.post(f"{BASE_BACKEND}/api/conversation/test", params={
        "knowledge_file": "institute.json",
        "user_input": "What courses do you offer?",
        "conversation_id": "e2e_test_1",
        "include_audio": "false",
        "is_greeting": "false",
        "language": "English"
    }, timeout=30)
    elapsed = (time.time() - start) * 1000
    assert r.status_code == 200
    data = r.json()
    print(f"  Response: {data.get('ai_response', '')[:100]}...")
    print(f"  Total: {data.get('debug_info', {}).get('total_time_ms', 'N/A')}ms")
    print(f"  LLM: {data.get('debug_info', {}).get('llm_time_ms', 'N/A')}ms")
    print(f"  RAG: {data.get('debug_info', {}).get('retrieval_time_ms', 'N/A')}ms")
    print(f"  Wall clock: {elapsed:.0f}ms")
    return data

def test_text_chat_with_audio():
    start = time.time()
    r = requests.post(f"{BASE_BACKEND}/api/conversation/test", params={
        "knowledge_file": "institute.json",
        "user_input": "What are the hostel fees?",
        "conversation_id": "e2e_test_2",
        "include_audio": "true",
        "is_greeting": "false",
        "language": "English"
    }, timeout=60)
    elapsed = (time.time() - start) * 1000
    assert r.status_code == 200
    data = r.json()
    debug = data.get("debug_info", {})
    print(f"  Response: {data.get('ai_response', '')[:100]}...")
    print(f"  Total (server): {debug.get('total_time_ms', 'N/A')}ms")
    print(f"  LLM: {debug.get('llm_time_ms', 'N/A')}ms")
    print(f"  TTS: {debug.get('tts_time_ms', 'N/A')}ms")
    print(f"  RAG: {debug.get('retrieval_time_ms', 'N/A')}ms")
    print(f"  Has audio: {data.get('audio_data') is not None}")
    print(f"  Sentences: {len(data.get('sentence_audios', []))}")
    print(f"  Wall clock: {elapsed:.0f}ms")
    return data

# ── 4. Streaming Chat ────────────────────────────────────────────
def test_stream_chat():
    start = time.time()
    first_sentence_time = None
    sentences = []
    
    r = requests.post(f"{BASE_BACKEND}/api/conversation/stream", params={
        "mode": "test",
        "knowledge_file": "institute.json",
        "user_input": "Tell me about admissions process",
        "conversation_id": "e2e_test_stream_1",
        "is_greeting": "false",
        "language": "English"
    }, stream=True, timeout=60)
    
    assert r.status_code == 200
    
    for line in r.iter_lines(decode_unicode=True):
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            data_str = line[6:]
            try:
                data = json.loads(data_str)
            except:
                continue
            if event == "turn":
                print(f"  Turn started, language: {data.get('detected_language')}")
            elif event == "sentence":
                if first_sentence_time is None:
                    first_sentence_time = (time.time() - start) * 1000
                sentences.append(data.get("text", ""))
                print(f"  Sentence {data.get('index')}: {data.get('text', '')[:80]}...")
                print(f"    Audio size: {len(data.get('audio_data', ''))} chars")
            elif event == "done":
                debug = data.get("debug_info", {})
                print(f"  --- STREAM DONE ---")
                print(f"  First sentence: {first_sentence_time:.0f}ms" if first_sentence_time else "  No sentences!")
                print(f"  RAG: {debug.get('retrieval_time_ms', 'N/A')}ms")
                print(f"  LLM total: {debug.get('llm_time_ms', 'N/A')}ms")
                print(f"  TTS total: {debug.get('tts_time_ms', 'N/A')}ms")
                print(f"  Total: {debug.get('total_time_ms', 'N/A')}ms")
                print(f"  Sentences: {len(sentences)}")
            elif event == "error":
                print(f"  ERROR: {data.get('detail')}")
    
    total = (time.time() - start) * 1000
    print(f"  Wall clock: {total:.0f}ms")
    return {"first_sentence_ms": first_sentence_time, "total_ms": total, "sentence_count": len(sentences)}

# ── 5. Streaming Greeting ────────────────────────────────────────
def test_stream_greeting():
    start = time.time()
    first_sentence_time = None
    sentences = []
    
    r = requests.post(f"{BASE_BACKEND}/api/conversation/stream", params={
        "mode": "test",
        "knowledge_file": "institute.json",
        "user_input": "",
        "conversation_id": "e2e_test_greeting_1",
        "is_greeting": "true",
        "language": "English"
    }, stream=True, timeout=60)
    
    assert r.status_code == 200
    
    for line in r.iter_lines(decode_unicode=True):
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            data_str = line[6:]
            try:
                data = json.loads(data_str)
            except:
                continue
            if event == "sentence":
                if first_sentence_time is None:
                    first_sentence_time = (time.time() - start) * 1000
                sentences.append(data.get("text", ""))
                print(f"  Sentence {data.get('index')}: {data.get('text', '')[:80]}...")
            elif event == "done":
                debug = data.get("debug_info", {})
                print(f"  --- GREETING DONE ---")
                print(f"  First sentence: {first_sentence_time:.0f}ms" if first_sentence_time else "  No sentences!")
                print(f"  TTS: {debug.get('tts_time_ms', 'N/A')}ms")
                print(f"  Total: {debug.get('total_time_ms', 'N/A')}ms")
    
    total = (time.time() - start) * 1000
    print(f"  Wall clock: {total:.0f}ms")
    return {"first_sentence_ms": first_sentence_time, "total_ms": total, "sentence_count": len(sentences)}

# ── 6. Transcription (STT) ──────────────────────────────────────
def test_transcribe():
    # Create a small test WAV file (1 second of silence at 16kHz)
    import struct, io
    sample_rate = 16000
    duration = 1
    num_samples = sample_rate * duration
    wav_data = io.BytesIO()
    # WAV header
    data_size = num_samples * 2
    wav_data.write(b'RIFF')
    wav_data.write(struct.pack('<I', 36 + data_size))
    wav_data.write(b'WAVE')
    wav_data.write(b'fmt ')
    wav_data.write(struct.pack('<IHHIIHH', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
    wav_data.write(b'data')
    wav_data.write(struct.pack('<I', data_size))
    wav_data.write(b'\x00' * data_size)
    wav_bytes = wav_data.getvalue()
    
    r = requests.post(f"{BASE_BACKEND}/api/conversation/transcribe",
        files={"audio": ("test.wav", wav_bytes, "audio/wav")},
        timeout=20
    )
    # This will likely fail since it's silence, but we test the endpoint works
    print(f"  Status: {r.status_code}")
    print(f"  Response: {r.text[:200]}")
    return {"status_code": r.status_code}

# ── 7. TTS Endpoint ──────────────────────────────────────────────
def test_tts():
    start = time.time()
    r = requests.post(f"{BASE_BACKEND}/text-to-speech",
        json={"text": "Hello, welcome to Narayana College! How can I help you?", "language": "en"},
        timeout=30
    )
    elapsed = (time.time() - start) * 1000
    print(f"  Status: {r.status_code}")
    print(f"  Content-Type: {r.headers.get('content-type')}")
    print(f"  Audio size: {len(r.content)} bytes")
    print(f"  Wall clock: {elapsed:.0f}ms")
    return {"status_code": r.status_code, "audio_bytes": len(r.content), "ms": elapsed}

# ── 8. End conversation ──────────────────────────────────────────
def test_end_conversation():
    r = requests.post(f"{BASE_BACKEND}/api/conversation/end",
        params={"conversation_id": "e2e_test_stream_1"},
        timeout=10
    )
    assert r.status_code == 200
    data = r.json()
    print(f"  Messages cleared: {data.get('messages_cleared')}")
    return data

# ── Run all tests ────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "="*60)
    print("  DONESWARI AI TELECALLER — END-TO-END LATENCY TESTS")
    print("="*60)
    
    # Basic connectivity
    test("1. Backend Health (/)", test_health)
    test("2. Backend Health (/health)", test_health_detailed)
    test("3. Frontend Serves HTML", test_frontend_serves)
    test("4. Frontend Proxy to Backend", test_frontend_proxy)
    
    # Latency-critical path
    test("5. Text Chat (no audio)", test_text_chat)
    test("6. Text Chat + TTS", test_text_chat_with_audio)
    
    # Streaming (most important for TTFA)
    test("7. Streaming Greeting", test_stream_greeting)
    test("8. Streaming Conversation", test_stream_chat)
    
    # Individual services
    test("9. TTS Endpoint", test_tts)
    test("10. STT Endpoint (silence)", test_transcribe)
    
    # Cleanup
    test("11. End Conversation", test_end_conversation)
    
    # ── Summary ──────────────────────────────────────────────────
    print("\n" + "="*60)
    print("  SUMMARY")
    print("="*60)
    
    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")
    
    for r in results:
        icon = "OK" if r["status"] == "PASS" else "ERR"
        print(f"  [{icon}] {r['name']}: {r['ms']}ms")
    
    print(f"\n  Total: {passed} passed, {failed} failed out of {len(results)} tests")
    
    # Latency analysis
    print("\n  LATENCY BREAKDOWN:")
    for r in results:
        if "stream" in r["name"].lower() or "chat" in r["name"].lower():
            if r["status"] == "PASS":
                print(f"    {r['name']}: {r['ms']}ms")
    
    # Check if we hit <700ms target
    stream_tests = [r for r in results if "stream" in r["name"].lower() and r["status"] == "PASS"]
    if stream_tests:
        avg_stream_ms = sum(r["ms"] for r in stream_tests) / len(stream_tests)
        print(f"\n  Average streaming latency: {avg_stream_ms:.0f}ms")
        if avg_stream_ms < 700:
            print("  >>> TARGET MET: <700ms latency achieved!")
        else:
            print(f"  >>> TARGET NOT MET: {avg_stream_ms:.0f}ms > 700ms target")
    
    # Exit with error code if any failures
    sys.exit(0 if failed == 0 else 1)
