"""Rewrite the streaming else block properly."""
with open('backend/app/api/conversation_routes.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find boundaries
start_line = None
end_line = None

for i, line in enumerate(lines):
    s = line.strip()
    if s == 'else:' and i > 310 and i < 330:
        start_line = i
    if 'memory.append(user_input)' in s and start_line is not None and i > start_line:
        end_line = i
        break

if start_line is None or end_line is None:
    print(f"ERROR: boundaries not found: start={start_line}, end={end_line}")
    exit(1)

print(f"Replacing lines {start_line+1}-{end_line+1}")

# Build the correct replacement text
replacement = """                else:
                    logger.info("CACHE MISS for: %s \\u2014 using LLM", llm_input[:60])
                    # \\u2500\\u2500 REAL-TIME: stream LLM tokens \\u2192 emit each COMPLETE
                    #    sentence's audio the moment it finishes. The LLM runs as
                    #    a background task so its tokens keep arriving while TTS
                    #    synthesizes the sentences already emitted.
                    sentence_q: asyncio.Queue = asyncio.Queue()
                    _l0 = time.time()
                    ai_parts: List[str] = []
                    stream_error: Optional[str] = None

                    async def _llm_streamer():
                        nonlocal ai_parts
                        buf = ""
                        try:
                            async for delta in stream_chat_fast(
                                llm_input, lang=detected_lang,
                                conversation_history=history_list,
                            ):
                                buf += delta
                                sentences, buf = _pop_complete_sentences(buf)
                                for s in sentences:
                                    idx = len(ai_parts)
                                    ai_parts.append(s)
                                    await sentence_q.put(("sentence", idx, s))
                            trailing = buf.strip()
                            if trailing:
                                idx = len(ai_parts)
                                ai_parts.append(trailing)
                                await sentence_q.put(("sentence", idx, trailing))
                        except Exception as e:
                            logger.error("Streaming LLM failed: %s", e)
                            await sentence_q.put(("error", str(e)))
                        finally:
                            await sentence_q.put(("end", None))

                    llm_task = asyncio.create_task(_llm_streamer())
                    count = 0
                    _t0 = time.time()
                    try:
                        while True:
                            kind = await sentence_q.get()
                            if kind[0] == "end":
                                break
                            if kind[0] == "error":
                                stream_error = kind[1]
                                break
                            _idx, payload = kind[1], kind[2]
                            _s0 = time.time()
                            async for chunk in tts_service.stream_sentences(
                                payload, language=synth_lang
                            ):
                                if chunk.get("audio_data") is None:
                                    continue
                                if first_sentence_ms == 0:
                                    first_sentence_ms = (
                                        time.time() - turn_start
                                    ) * 1000
                                yield sse_event(
                                    "sentence",
                                    {
                                        "index": _idx,
                                        "text": chunk["text"],
                                        "audio_data": chunk["audio_data"],
                                    },
                                )
                                count += 1
                            tts_ms += (time.time() - _s0) * 1000
                    finally:
                        if not llm_task.done():
                            llm_task.cancel()
                    llm_ms = (time.time() - _l0) * 1000
                    if first_sentence_ms == 0:
                        first_sentence_ms = llm_ms

                    ai_response = "".join(ai_parts).strip()
                if stream_error:
                    logger.error("Streaming conversation LLM error: %s", stream_error)
                    if not ai_response:
                        ai_response = (
                            "I can help with that. We offer MPC, BiPC, MEC and CEC streams. "
                            "What would you like to know more about \\u2014 courses, fees or admission?"
                        )
                        async for chunk in tts_service.stream_sentences(
                            ai_response, language=synth_lang
                        ):
                            if chunk.get("audio_data"):
                                yield sse_event(
                                    "sentence",
                                    {
                                        "index": 0,
                                        "text": chunk["text"],
                                        "audio_data": chunk["audio_data"],
                                    },
                                )
                                count += 1
                    yield sse_event("error", {"detail": stream_error})

                memory.append(user_input)
                memory.append(ai_response)
"""

new_lines = lines[:start_line] + [replacement] + lines[end_line+1:]

with open('backend/app/api/conversation_routes.py', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("OK: streaming section rewritten")
