"""
Apply all optimizations to conversation_routes.py:
1. Add response cache import
2. Add cache check before LLM in streaming path
3. Fix all indentation
"""
with open('backend/app/api/conversation_routes.py', 'r', encoding='utf-8') as f:
    content = f.read()

# ── 1. Add imports ──
if 'from app.rag.response_cache import' not in content:
    content = content.replace(
        'from app.rag.groq_service import generate_response, stream_chat, stream_chat_fast',
        'from app.rag.groq_service import generate_response, stream_chat, stream_chat_fast\nfrom app.rag.response_cache import find_cached_response, get_cached_audio'
    )

# ── 2. Add cache check in streaming path (before the LLM streamer) ──
# Find the line where retrieval_ms ends and memory/history setup begins
old_streaming_block = """                memory = conversation_memory.setdefault(conv_id, [])
                history_list = _build_history(memory, conv_id)
                lang_hint = LANGUAGE_INSTRUCTION.format(language=detected_lang)

                # ── REAL-TIME: stream LLM tokens → emit each COMPLETE
                #    sentence's audio the moment it finishes. The LLM runs as
                #    a background task so its tokens keep arriving while TTS
                #    synthesizes the sentences already emitted.
                sentence_q: asyncio.Queue = asyncio.Queue()"""

new_streaming_block = """                memory = conversation_memory.setdefault(conv_id, [])
                history_list = _build_history(memory, conv_id)
                lang_hint = LANGUAGE_INSTRUCTION.format(language=detected_lang)
                synth_lang = detected_lang

                # ── RESPONSE CACHE: skip the LLM entirely for common questions
                cached = find_cached_response(llm_input, language=detected_lang)
                if cached:
                    ai_response = cached
                    ai_parts = [cached]
                    llm_ms = 0
                    count = 0
                    # Try pre-cached audio (instant!) or synthesize on the fly
                    pre_audio = get_cached_audio(cached, synth_lang)
                    if pre_audio:
                        first_sentence_ms = (time.time() - turn_start) * 1000
                        yield sse_event(
                            "sentence",
                            {"index": 0, "text": cached, "audio_data": pre_audio},
                        )
                        count = 1
                        tts_ms = 0
                        logger.info("CACHE+AUDIO HIT for: %s (%.0fms)", llm_input[:60], first_sentence_ms)
                    else:
                        _t0 = time.time()
                        async for chunk in tts_service.stream_sentences(
                            cached, language=synth_lang
                        ):
                            if chunk.get("audio_data") is None:
                                continue
                            if first_sentence_ms == 0:
                                first_sentence_ms = (time.time() - turn_start) * 1000
                            yield sse_event(
                                "sentence",
                                {
                                    "index": chunk["index"],
                                    "text": chunk["text"],
                                    "audio_data": chunk["audio_data"],
                                },
                            )
                            count += 1
                        tts_ms = (time.time() - _t0) * 1000
                        logger.info("CACHE HIT (synth) for: %s (lang=%s)", llm_input[:60], detected_lang)
                else:
                    # ── REAL-TIME: stream LLM tokens → emit each COMPLETE
                    #    sentence's audio the moment it finishes. The LLM runs as
                    #    a background task so its tokens keep arriving while TTS
                    #    synthesizes the sentences already emitted.
                    sentence_q: asyncio.Queue = asyncio.Queue()"""

if old_streaming_block in content:
    content = content.replace(old_streaming_block, new_streaming_block)
    print("1. Streaming cache check: OK")
else:
    print("1. Streaming cache check: WARN - old block not found")

# ── 3. Fix the else block indentation (everything from _l0 to memory.append) ──
# After inserting the cache, the code from _l0 to the end of streaming needs to be
# properly indented inside the else block.

# Find the else: after cache check and re-indent the LLM streaming code
old_else_content = """                else:
                    # ── REAL-TIME: stream LLM tokens → emit each COMPLETE
                    #    sentence's audio the moment it finishes. The LLM runs as
                    #    a background task so its tokens keep arriving while TTS
                    #    synthesizes the sentences already emitted.
                    sentence_q: asyncio.Queue = asyncio.Queue()
                _l0 = time.time()"""

new_else_content = """                else:
                    # ── REAL-TIME: stream LLM tokens → emit each COMPLETE
                    #    sentence's audio the moment it finishes. The LLM runs as
                    #    a background task so its tokens keep arriving while TTS
                    #    synthesizes the sentences already emitted.
                    sentence_q: asyncio.Queue = asyncio.Queue()
                    _l0 = time.time()"""

if old_else_content in content:
    content = content.replace(old_else_content, new_else_content)
    print("2. Else block indent _l0: OK")
else:
    print("2. Else block indent _l0: WARN - not found (may already be correct)")

# Now we need to re-indent ALL lines from _l0 through ai_response assembly
# that are at 16-space indent but should be at 20-space indent (inside else).
# We do this by finding the section and re-indenting line by line.

lines = content.split('\n')
new_lines = []
in_streaming_else = False
found_sentence_q = False

for i, line in enumerate(lines):
    stripped = line.rstrip()
    
    # Detect we're inside the else block after the cache check
    if 'sentence_q: asyncio.Queue = asyncio.Queue()' in stripped and not found_sentence_q:
        found_sentence_q = True
        in_streaming_else = True
        new_lines.append(line)
        continue
    
    if in_streaming_else:
        current_indent = len(stripped) - len(stripped.lstrip()) if stripped.strip() else -1
        
        # Stop at the end of the streaming section
        if current_indent <= 16 and stripped.strip().startswith('if stream_error:'):
            in_streaming_else = False
            new_lines.append(line)
            continue
        
        # Lines at 16-space indent that should be at 20 (inside else)
        if current_indent == 16 and stripped.strip():
            # Re-indent from 16 to 20 spaces
            new_lines.append('                    ' + stripped.lstrip())
            continue
    
    new_lines.append(line)

content = '\n'.join(new_lines)

# ── 4. Fix ai_response assignment to be outside the if first_sentence_ms block ──
# It's currently: 
#                   if first_sentence_ms == 0:
#                       first_sentence_ms = llm_ms
#
#                       ai_response = "".join(ai_parts).strip()
# But should be:
#                   if first_sentence_ms == 0:
#                       first_sentence_ms = llm_ms
#
#                   ai_response = "".join(ai_parts).strip()

old_ai_resp = """                    if first_sentence_ms == 0:
                        first_sentence_ms = llm_ms

                    ai_response = "".join(ai_parts).strip()
                if stream_error:"""

new_ai_resp = """                    if first_sentence_ms == 0:
                        first_sentence_ms = llm_ms

                    ai_response = "".join(ai_parts).strip()
                if stream_error:"""

if old_ai_resp in content:
    content = content.replace(old_ai_resp, new_ai_resp)
    print("3. ai_response indent: OK")
else:
    print("3. ai_response indent: WARN - may already be correct")

# ── 5. Add cache check to /test endpoint ──
old_test = """        # Regular conversation - retrieve context from JSON
        # ── Roman-Telugu aware language detection ───────────────────────────
        # "idhi enti", "meeru ekkada unnaru" → Telugu (never English).
        detected_lang = _detect_language(user_input, hint=language)
        logger.info(f"TEST Detected language: {detected_lang} (hint was {language})")
        # Convert high-frequency Roman Telugu to Telugu script for unambiguous
        # LLM understanding. Internal only — never exposed to the caller.
        llm_input = transliterate_roman_telugu(user_input)

        retrieval_start = time.time()
        context = json_retriever.retrieve_context(llm_input, top_k=5)
        retrieval_time = (time.time() - retrieval_start) * 1000"""

new_test = """        # Regular conversation - retrieve context from JSON
        detected_lang = _detect_language(user_input, hint=language)
        llm_input = transliterate_roman_telugu(user_input)
        
        # Response Cache: skip LLM for common questions
        cached_response = find_cached_response(llm_input, language=detected_lang)
        if cached_response:
            ai_response = cached_response
            llm_time = 0
            memory.append(user_input)
            memory.append(ai_response)
            if len(memory) > 20:
                memory = memory[-20:]
                conversation_memory[conversation_id] = memory
            audio_data = None
            sentence_audios = []
            tts_time = 0
            if include_audio:
                tts_start = time.time()
                sentence_audios = await tts_service.synthesize_sentences(
                    ai_response, language=detected_lang
                )
                all_audio = b"".join(
                    base64.b64decode(s["audio_data"]) for s in sentence_audios if s.get("audio_data")
                )
                audio_data = base64.b64encode(all_audio).decode("utf-8") if all_audio else None
                tts_time = (time.time() - tts_start) * 1000
            total_time = (time.time() - start_time) * 1000
            return {
                "ai_response": ai_response,
                "audio_data": audio_data,
                "sentence_audios": sentence_audios,
                "debug_info": {
                    "total_time_ms": round(total_time),
                    "retrieval_time_ms": 0,
                    "llm_time_ms": 0,
                    "tts_time_ms": round(tts_time),
                    "chunks_retrieved": 0,
                    "knowledge_source": "cache"
                }
            }

        retrieval_start = time.time()
        context = json_retriever.retrieve_context(llm_input, top_k=5)
        retrieval_time = (time.time() - retrieval_start) * 1000"""

if old_test in content:
    content = content.replace(old_test, new_test)
    print("4. /test endpoint cache: OK")
else:
    print("4. /test endpoint cache: WARN - not found")

with open('backend/app/api/conversation_routes.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("\nAll changes applied. Checking syntax...")

import py_compile
try:
    py_compile.compile('backend/app/api/conversation_routes.py', doraise=True)
    print("SYNTAX: OK")
except py_compile.PyCompileError as e:
    print(f"SYNTAX ERROR: {e}")
