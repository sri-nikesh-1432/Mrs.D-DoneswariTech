"""Completely rewrite the streaming section of conversation_routes.py to fix all indentation issues."""
with open('backend/app/api/conversation_routes.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the section from "async def _llm_streamer" to "memory.append(ai_response)"
# and replace it with properly indented code

old_section_start = "                async def _llm_streamer():"
old_section_end = "                memory.append(ai_response)"

start_idx = content.find(old_section_start)
end_idx = content.find(old_section_end)

if start_idx == -1 or end_idx == -1:
    print(f"Could not find section boundaries. start={start_idx}, end={end_idx}")
    exit(1)

# Find the end of "memory.append(ai_response)\n"
end_idx_after = content.index("\n", end_idx) + 1

# Also include the next line (memory append or len check)
lines_after = content[end_idx_after:end_idx_after+100].split('\n')
extra_end = 0
for line in lines_after:
    if 'conversation_memory[conv_id]' in line:
        extra_end += len(line) + 1
        break
    elif line.strip().startswith('if len(memory)'):
        extra_end += len(line) + 1
        break

new_section = """                    async def _llm_streamer():
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
                memory.append(user_input)
                memory.append(ai_response)
                if len(memory) > 20:
                    conversation_memory[conv_id] = memory[-20:]"""

content = content[:start_idx] + new_section + content[end_idx_after + extra_end:]

with open('backend/app/api/conversation_routes.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("OK: streaming section rewritten with proper indentation")
