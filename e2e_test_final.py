"""
End-to-end latency test: 10-turn consistency loop
Measures TTFA (time-to-first-audio) for streaming conversation endpoint.
Tests both cache hits (common questions) and cache misses (LLM required).
Target: ALL turns under 700ms TTFA.
"""
import requests
import time
import json
import sys

BASE = "http://127.0.0.1:8000"
CONV_ID = f"test_{int(time.time())}"

# Common questions (should CACHE-HIT for <500ms TTFA)
CACHED_QUESTIONS = [
    ("What are the fees?", "English"),
    ("Tell me about courses", "English"),
    ("How to take admission?", "English"),
    ("Do you have hostel?", "English"),
    ("fee entha?", "Telugu"),
    ("courses emi unnayi?", "Telugu"),
]

# Unique questions (will MISS cache, need LLM <700ms)
UNCACHED_QUESTIONS = [
    ("What is the last date for admission?", "English"),
    ("Tell me about the sports facilities", "English"),
    ("Do you have separate batches for JEE and NEET?", "English"),
    ("What about lab infrastructure?", "English"),
]


def measure_stream_ttfa(user_input, language="English", conv_id=None):
    """Measure time-to-first-audio from streaming endpoint."""
    params = {
        "mode": "test",
        "user_input": user_input,
        "conversation_id": conv_id or CONV_ID,
        "language": language,
        "knowledge_file": "institute.json",
    }
    
    turn_start = time.time()
    first_audio_ms = None
    llm_ms = None
    tts_ms = None
    total_ms = None
    source = "unknown"
    error = None
    sentence_count = 0
    
    try:
        resp = requests.post(f"{BASE}/api/conversation/stream", params=params, 
                           stream=True, timeout=30)
        
        buffer = ""
        for chunk in resp.iter_content(chunk_size=4096):
            buffer += chunk.decode("utf-8", errors="replace")
            while "\n\n" in buffer:
                frame, buffer = buffer.split("\n\n", 1)
                event = None
                data = None
                for line in frame.split("\n"):
                    if line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:"):
                        data_str = line[5:].strip()
                        try:
                            data = json.loads(data_str)
                        except:
                            pass
                
                if event == "sentence" and data and data.get("audio_data"):
                    if first_audio_ms is None:
                        first_audio_ms = (time.time() - turn_start) * 1000
                    sentence_count += 1
                
                elif event == "done" and data:
                    debug = data.get("debug_info", {})
                    llm_ms = debug.get("llm_time_ms", 0)
                    tts_ms = debug.get("tts_time_ms", 0)
                    total_ms = (time.time() - turn_start) * 1000
                    source = debug.get("knowledge_source", "unknown")
                
                elif event == "error":
                    error = data.get("detail", "unknown") if data else "unknown"
    
    except Exception as e:
        error = str(e)
        total_ms = (time.time() - turn_start) * 1000
    
    return {
        "ttfa_ms": round(first_audio_ms) if first_audio_ms else None,
        "llm_ms": round(llm_ms) if llm_ms else 0,
        "tts_ms": round(tts_ms) if tts_ms else 0,
        "total_ms": round(total_ms) if total_ms else None,
        "source": source,
        "error": error,
        "sentences": sentence_count,
    }


def main():
    print("=" * 70)
    print("  MRS. D AI TELECALLER — 10-TURN CONSISTENCY TEST")
    print("  Target: ALL turns under 700ms TTFA")
    print("=" * 70)
    
    all_results = []
    passes = 0
    fails = 0
    
    # Phase 1: Test cached responses (should be instant)
    print("\n--- PHASE 1: CACHED RESPONSES (no LLM needed) ---\n")
    for i, (question, lang) in enumerate(CACHED_QUESTIONS):
        time.sleep(1)  # rate limit prevention
        result = measure_stream_ttfa(question, lang)
        ttfa = result["ttfa_ms"]
        status = "PASS" if (ttfa and ttfa < 700) else "FAIL"
        if status == "PASS":
            passes += 1
        else:
            fails += 1
        all_results.append(result)
        
        icon = "+" if status == "PASS" else "X"
        print(f"  [{icon}] Turn {i+1}: '{question[:40]}' -> TTFA={ttfa}ms "
              f"(source={result['source']}, llm={result['llm_ms']}ms, "
              f"tts={result['tts_ms']}ms, sentences={result['sentences']}) {status}")
        if result["error"]:
            print(f"      ERROR: {result['error'][:100]}")
    
    # Phase 2: Test LLM responses (should be under 700ms)
    print("\n--- PHASE 2: LLM RESPONSES (cache miss) ---\n")
    for i, (question, lang) in enumerate(UNCACHED_QUESTIONS):
        time.sleep(2)  # longer delay for LLM rate limiting
        result = measure_stream_ttfa(question, lang)
        ttfa = result["ttfa_ms"]
        status = "PASS" if (ttfa and ttfa < 700) else "FAIL"
        if status == "PASS":
            passes += 1
        else:
            fails += 1
        all_results.append(result)
        
        icon = "+" if status == "PASS" else "X"
        print(f"  [{icon}] Turn {i+1+CACHED_QUESTIONS.__len__()}: '{question[:40]}' -> TTFA={ttfa}ms "
              f"(source={result['source']}, llm={result['llm_ms']}ms, "
              f"tts={result['tts_ms']}ms, sentences={result['sentences']}) {status}")
        if result["error"]:
            print(f"      ERROR: {result['error'][:100]}")
    
    # Summary
    total = passes + fails
    ttfa_values = [r["ttfa_ms"] for r in all_results if r["ttfa_ms"]]
    avg_ttfa = sum(ttfa_values) / len(ttfa_values) if ttfa_values else 0
    max_ttfa = max(ttfa_values) if ttfa_values else 0
    min_ttfa = min(ttfa_values) if ttfa_values else 0
    
    print("\n" + "=" * 70)
    print(f"  RESULTS: {passes}/{total} turns under 700ms TTFA")
    print(f"  TTFA: min={min_ttfa}ms, avg={avg_ttfa:.0f}ms, max={max_ttfa}ms")
    print(f"  Cache hits: {sum(1 for r in all_results if r['source']=='cache')}")
    print(f"  LLM responses: {sum(1 for r in all_results if r['source']!='cache')}")
    print(f"  Errors: {sum(1 for r in all_results if r['error'])}")
    if fails == 0:
        print("\n  ALL TURNS UNDER 700ms — TARGET ACHIEVED!")
    else:
        print(f"\n  {fails} turns above 700ms — NEEDS OPTIMIZATION")
    print("=" * 70)
    
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
