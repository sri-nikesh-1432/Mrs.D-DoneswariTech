import { useCallback, useEffect, useRef, useState } from "react";
import { playBreath } from "../lib/breath";
import { VoiceActivityDetector, isVADSupported } from "../lib/vad";

export interface VoiceMessage {
  role: "user" | "ai";
  content: string;
  timestamp: string;
}

export interface VoiceDebugInfo {
  retrieval_time_ms: number;
  llm_time_ms: number;
  tts_time_ms: number;
  total_time_ms: number;
  /** Time-to-first-audio: ms from turn start until the first sentence plays. */
  first_sentence_ms?: number;
  chunks_retrieved: number;
  knowledge_source: string;
  /** Real backend error detail (shown in the debug panel, never faked). */
  stream_error?: string;
}

export type CallStage =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

interface UseVoiceAgentOptions {
  /** Which backend pipeline to use: "test" (JSON knowledge) or "process" (FAISS) */
  mode?: "test" | "process";
  knowledgeFile?: string;
  instituteId?: number;
  /** Seconds of silence after which a pending utterance is submitted. */
  silenceTimeoutMs?: number;
  /** Language hint sent to the backend. */
  initialLanguage?: string;
  /**
   * Use the real-time Web Audio VAD + Groq Whisper pipeline instead of the
   * flaky webkitSpeechRecognition. Catches ANY voice in ANY language via raw
   * mic energy (default: true when the browser supports it).
   */
  useVAD?: boolean;
  onEnded?: () => void;
}

const LANGUAGE_VOICES: Record<string, string> = {
  English: "en-IN",
  Telugu: "te-IN",
  Hindi: "hi-IN",
  Tamil: "ta-IN",
  Kannada: "kn-IN",
  Malayalam: "ml-IN",
};

const SCRIPT_TO_LANGUAGE: Array<{ re: RegExp; lang: string }> = [
  { re: /[\u0C00-\u0C7F]/, lang: "Telugu" },
  { re: /[\u0900-\u097F]/, lang: "Hindi" },
  { re: /[\u0B80-\u0BFF]/, lang: "Tamil" },
  { re: /[\u0C80-\u0CFF]/, lang: "Kannada" },
  { re: /[\u0D00-\u0D7F]/, lang: "Malayalam" },
];

// High-frequency Roman Telugu words that let us detect Telugu typed in Latin
// letters ("idhi enti", "meeru ekkada unnaru"). STRONG words are unambiguous
// Roman-Telugu words; WEAK words are shared with English (fee, college, bus)
// and must never trigger a Telugu verdict on their own.
const ROMAN_TELUGU_STRONG = new Set([
  "idhi", "idi", "adi", "ivi", "enti", "endhi", "endi", "meeru", "maa",
  "naku", "naaku", "nee", "nuvvu", "eppudu", "ekkada", "enduku", "ela",
  "entha", "undi", "unna", "unnaru", "unnay", "unnayi", "kavali", "kaavali",
  "cheppandi", "cheppu", "isthara", "isthunnaru", "avutundi", "avuthundi",
  "padutundi", "paduthundi", "chestharu", "raavali", "koncham", "konchem",
  "chaala", "chala", "telsa", "telusa", "manchi", "appudu", "alage",
  "inkem", "inkemi", "baagundi", "bagundi", "ante", "antava", "raandi",
  "raandru", "tarandi", "chesoccha", "raavoccha", "undachu", "undach",
]);

const ROMAN_TELUGU_WEAK = new Set([
  "campus", "college", "colleji", "hostel", "bus", "cluster", "fee", "fees",
]);

function detectLanguage(text: string): string {
  // Real regional script first
  for (const { re, lang } of SCRIPT_TO_LANGUAGE) {
    if (re.test(text)) return lang;
  }
  // Roman Telugu (Latin script): "idhi enti" → Telugu so the AI speaks Telugu
  const tokens = text.toLowerCase().match(/[a-z]+/g) || [];
  let strongHits = 0;
  let weakHits = 0;
  for (const tok of tokens) {
    if (ROMAN_TELUGU_STRONG.has(tok)) strongHits++;
    else if (ROMAN_TELUGU_WEAK.has(tok)) weakHits++;
  }
  // At least one unambiguous Telugu word, or a heavy accumulation of shared
  // words — a single "college" or "bus" alone is not enough.
  if (strongHits >= 1 || weakHits >= 3) {
    return "Telugu";
  }
  return "English";
}

function normalizeTranscript(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Whisper ISO-639-1 codes → UI language names (auto-detected per utterance). */
const LANG_CODE_TO_NAME: Record<string, string> = {
  te: "Telugu",
  hi: "Hindi",
  ta: "Tamil",
  kn: "Kannada",
  ml: "Malayalam",
  en: "English",
};

/**
 * useVoiceAgent — the ONE conversation state machine for the whole voice UI.
 *
 * Pipeline guarantees (ChatGPT-Voice-style):
 *   Listen → speech ends (~1.3s silence) → thinking → speaking (sentence
 *   audio queue) → clear buffers + fresh STT session → listen
 *
 *  - Exactly ONE active SpeechRecognition session at a time.
 *  - Previously processed audio is never re-processed: identical consecutive
 *    transcripts are ignored, and the STT session is restarted after every
 *    AI turn so the AI's own voice can never be fed back as user speech.
 *  - Transcripts arriving while "thinking" are ignored.
 *  - Barge-in: if the user speaks (final result, decent confidence) while the
 *    AI is speaking, the audio queue stops immediately and the new speech is
 *    submitted once they pause.
 *  - Listening resumes only after the TTS queue has completely finished.
 */
export function useVoiceAgent({
  mode = "test",
  knowledgeFile = "institute.json",
  instituteId = 1,
  silenceTimeoutMs = 1300,
  initialLanguage = "English",
  useVAD = true,
  onEnded,
}: UseVoiceAgentOptions = {}) {
  const [callStage, setCallStage] = useState<CallStage>("idle");
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [debugInfo, setDebugInfo] = useState<VoiceDebugInfo | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState(initialLanguage);
  const [error, setError] = useState("");
  // Real-time indicator: the caller is currently speaking (VAD caught their
  // voice) — drives the live waveform colour and orb glow.
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);

  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const conversationId = useRef(`voice_${Date.now()}`);

  // ── Mutable pipeline state (refs avoid stale closures) ─────────────────────
  const stageRef = useRef<CallStage>("idle");
  const setStage = useCallback((s: CallStage) => {
    stageRef.current = s;
    setCallStage(s);
  }, []);

  const processingRef = useRef(false); // true while STT→LLM→TTS is running
  const pendingTranscriptRef = useRef(""); // accumulated new speech
  const lastProcessedRef = useRef(""); // last text already sent to the LLM
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningRef = useRef(false);
  const endedRef = useRef(false); // endCall idempotency guard

  // ── Real-time VAD (Web Audio) — the PRIMARY input path ────────────────────
  // Replaces webkitSpeechRecognition: raw mic energy is analysed directly so
  // ANY voice (any language, any accent, any volume) is detected; utterances
  // are recorded and transcribed by Groq Whisper (auto language detection).
  const vadSupported = useVAD && isVADSupported();
  const vadRef = useRef<VoiceActivityDetector | null>(null);
  const micLevelsRef = useRef<Float32Array>(new Float32Array(48)); // caller wave
  const aiLevelsRef = useRef<Float32Array>(new Float32Array(48)); // Mrs. D wave
  const aiRmsRef = useRef(0); // Mrs. D's output level (barge-in threshold anchor)
  const aiRafRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const transcribingRef = useRef(false); // one STT request at a time
  const handleVadStartRef = useRef<() => void>(() => {});
  const handleVadEndRef = useRef<() => void>(() => {});
  const transcribeBlobRef = useRef<(blob: Blob) => void>(() => {});

  // ── Sentence audio queue (ONE queue per conversation) ─────────────────────
  // Responses arrive as sentence-level audio chunks. They are played strictly
  // one at a time so the caller always hears a COMPLETE sentence and no two
  // TTS streams ever overlap. A new response or a barge-in clears the queue.
  const audioQueueRef = useRef<Array<{ text: string; audioData: string }>>([]);
  const queueActiveRef = useRef(false);
  const aiSpeakStartedAtRef = useRef(0); // barge-in cooldown anchor
  const aiFinishedAtRef = useRef(0); // when AI finished speaking (post-TTS grace)

  // ── Streaming (SSE) state ────────────────────────────────────────────────
  // The /stream endpoint delivers each sentence's audio as soon as it is
  // ready, so playback of sentence 1 can begin while the reply is still being
  // generated/synthesized. One in-flight stream per conversation; aborting it
  // (barge-in / end call / new turn) cancels the fetch immediately.
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamActiveRef = useRef(false);

  // ── Silence / VAD: fire after no new speech for a while ────────────────────
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // ── ADAPTIVE TURN-TAKING ───────────────────────────────────────────────────
  // A FIXED silence timeout is exactly what makes a voice agent feel robotic:
  // it cuts people off mid-thought on long answers and feels sluggish on short
  // ones. Humans pause mid-sentence, take breaths, say "um" while they think —
  // so the wait must scale with what has been said so far:
  //   - one-word acknowledgements ("Avunu", "Ok")  → brisk, ~0.75×
  //   - a typical short question                        → base
  //   - long, complex utterances (details, lists)       → patient, up to 1.35×
  // plus ±10% organic jitter so no two pauses are ever identical. Clamped to a
  // sane range so the caller is never cut off mid-word NOR left hanging.
  const adaptiveSilenceTimeout = useCallback(
    (pending: string): number => {
      const len = pending.trim().length;
      let scale = 1;
      if (len < 15) scale = 0.75; // brisk: "Avunu..." "Okay"
      else if (len > 80) scale = 1.35; // patient: long detailed thought
      else if (len > 40) scale = 1.15; // a little patience mid-length
      const jitter = 0.9 + Math.random() * 0.2;
      return Math.min(Math.max(silenceTimeoutMs * scale * jitter, 800), 2600);
    },
    [silenceTimeoutMs]
  );

  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      const pending = pendingTranscriptRef.current;
      if (
        pending.trim() &&
        stageRef.current === "listening" &&
        !processingRef.current
      ) {
        pendingTranscriptRef.current = "";
        submitSpeechRef.current(pending);
      }
    }, adaptiveSilenceTimeout(pendingTranscriptRef.current));
  }, [adaptiveSilenceTimeout, clearSilenceTimer]);

  // ── VAD lifecycle (real-time mic energy — the PRIMARY input) ─────────────
  const startVAD = useCallback(async () => {
    if (!vadRef.current) return;
    const ok = await vadRef.current.start();
    if (!ok && listeningRef.current && !endedRef.current) {
      // Mic denied / hardware failure — this is NOT a backend outage. Keep the
      // conversation usable in text mode and tell the user the real reason.
      listeningRef.current = false;
      setIsListening(false);
      setError(
        "Microphone access is blocked. Allow the microphone for this site " +
          "in the browser, or type your message below to continue the call."
      );
    }
  }, []);

  const stopVAD = useCallback(() => {
    vadRef.current?.stop();
    setIsUserSpeaking(false);
    // Discard any in-flight recording (never transcribe a half-spoken clip).
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
    recChunksRef.current = [];
  }, []);

  // ── Recognition lifecycle: exactly ONE active session ─────────────────────
  const stopListening = useCallback(() => {
    listeningRef.current = false;
    setIsListening(false);
    clearSilenceTimer();
    if (vadSupported) {
      stopVAD();
      return;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* already stopped */
      }
    }
  }, [clearSilenceTimer, stopVAD, vadSupported]);

  const startListening = useCallback(() => {
    if (listeningRef.current) return; // never start a second session
    listeningRef.current = true;
    setIsListening(true);
    if (vadSupported) {
      void startVAD();
      return;
    }
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
    } catch {
      /* may throw if already started */
    }
  }, [startVAD, vadSupported]);

  // ── Stop the audio queue immediately (barge-in, new response, end call) ───
  const stopAudioQueue = useCallback(() => {
    queueActiveRef.current = false;
    audioQueueRef.current = [];
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.onended = null;
    }
  }, []);

  // ── Cancel any in-flight streaming fetch (barge-in, end call, new turn) ──
  const stopStreaming = useCallback(() => {
    streamActiveRef.current = false;
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
  }, []);

  // ── Turn end: clear buffers, THEN listen for new audio only ───────────────
  const handleTurnEnd = useCallback(() => {
    processingRef.current = false;
    setIsProcessing(false);
    queueActiveRef.current = false;
    audioQueueRef.current = [];
    aiFinishedAtRef.current = Date.now();
    setStage("listening");
    const pending = pendingTranscriptRef.current;
    pendingTranscriptRef.current = "";
    setInputText("");
    if (pending.trim() && pending.trim() !== lastProcessedRef.current) {
      // Speech captured during the turn (barge-in) — submit it now.
      submitSpeechRef.current(pending);
    } else if (vadSupported) {
      // The VAD session keeps running continuously across turns — just reset
      // its speech state so the AI's own trailing audio in the mic buffer can
      // NEVER be recorded as the next user query (spec: reset STT after TTS).
      vadRef.current?.reset();
      listeningRef.current = true;
      setIsListening(true);
      if (!endedRef.current) {
        // Ensure the mic is live (first listening starts here after greeting)
        // and re-arm cleanly: short delay lets the AI's last syllables drain.
        void startVAD();
        setTimeout(() => vadRef.current?.reset(), 120);
      }
    } else {
      // Fresh STT session: stop the old (continuous) recognition and start a
      // brand-new one so the AI's own trailing audio in the old mic buffer can
      // NEVER be fed back as the next user query (spec: reset STT after TTS).
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      listeningRef.current = false;
      setIsListening(false);
      if (!endedRef.current) {
        setTimeout(() => startListening(), 120);
      }
    }
  }, [setStage, startListening, startVAD, vadSupported]);

  // Natural inter-sentence pause (the "breathing" cadence). Humans do NOT
  // pause the same length after every sentence — uniform gaps are exactly
  // what makes TTS sound robotic. Questions get a thinking beat, a long
  // thought a deeper breath, short acknowledgements flow fast.
  const pauseAfterSentence = useCallback((sentence: string): number => {
    const s = sentence.trim();
    let base: number;
    if (s.endsWith("?")) base = 560;
    else if (s.endsWith("!")) base = 460;
    else if (s.length > 140) base = 620;
    else if (s.length < 20) base = 300;
    else base = 380;
    // ±12% organic jitter — real people never pause for exactly the same
    // length; identical gaps are precisely what reads as mechanical.
    return Math.round(base * (0.88 + Math.random() * 0.24));
  }, []);

  // How deep the breath before the next sentence should be. Questions and
  // long thoughts get a real inhale; quick acknowledgements barely breathe.
  const breathIntensity = useCallback((sentence: string): number => {
    const s = sentence.trim();
    if (s.endsWith("?")) return 0.5; // thinking beat → deeper inhale
    if (s.length > 140) return 0.55; // long thought → real breath
    if (s.length < 20) return 0.2; // brisk ack → tiny breath
    return 0.35;
  }, []);

  // ── Play the next sentence in the queue. Each sentence is a COMPLETE
  //    utterance — never cut in the middle. When the queue is empty the turn
  //    is finished and we return to LISTENING. ───────────────────────────────
  const playNextInQueue = useCallback(async () => {
    if (endedRef.current || !queueActiveRef.current) return;
    const next = audioQueueRef.current.shift();
    if (!next) {
      queueActiveRef.current = false;
      // While the stream is still delivering sentences, wait for the rest —
      // never close the turn mid-stream. Otherwise playback is complete.
      if (!streamActiveRef.current) handleTurnEnd();
      return;
    }
    if (!audioRef.current) {
      // No audio element (text-only mode) — fast-forward through the queue.
      playNextInQueue();
      return;
    }
    // Reset the barge-in cooldown per sentence so the caller can interrupt
    // between sentences, but the AI's own first few syllables can't trigger it.
    aiSpeakStartedAtRef.current = Date.now();
    const el = audioRef.current;
    el.src = `data:audio/mp3;base64,${next.audioData}`;
    el.onended = () => {
      // Vary the gap by sentence type — one continuous speaker with natural
      // rhythm, never a clipped machine-gun of clips. While the reply is
      // STILL TALKING (more sentences queued), breathe during the gap — a
      // soft synthesized inhale, skipped ~1 in 4 so it stays organic. Never
      // after the last sentence: trailing silence belongs to the caller,
      // not the AI.
      const gap = pauseAfterSentence(next.text);
      if (audioQueueRef.current.length > 0 && Math.random() > 0.25) {
        playBreath({
          durationMs: gap,
          intensity: breathIntensity(next.text),
        });
      }
      setTimeout(() => playNextInQueue(), gap);
    };
    try {
      await el.play();
    } catch {
      // Autoplay blocked or aborted — skip to the next sentence.
      setTimeout(() => playNextInQueue(), pauseAfterSentence(next.text));
    }
  }, [handleTurnEnd, pauseAfterSentence, breathIntensity]);

  // ── Enqueue one streamed sentence for immediate playback ─────────────────
  // Each sentence's audio is queued the moment it arrives from the SSE
  // stream; if nothing is playing yet, playback begins right away so the
  // caller hears a live response instead of a 30-second wait.
  const enqueueStreamedSentence = useCallback(
    (s: { text: string; audioData: string }) => {
      if (endedRef.current) return;
      if (!queueActiveRef.current) {
        audioQueueRef.current = [s];
        queueActiveRef.current = true;
        setStage("speaking");
        playNextInQueue();
      } else {
        audioQueueRef.current.push(s);
      }
    },
    [playNextInQueue, setStage]
  );

  // ── Consume the /stream SSE endpoint ─────────────────────────────────────
  // Events: `sentence` (audio ready → enqueue + play as soon as possible),
  // `done` (full reply + debug info), `error`. Aborting the fetch (barge-in /
  // end call) cancels both the network request and further playback.
  const streamConversation = useCallback(
    async (
      params: URLSearchParams,
      onSentence: (text: string) => void,
      onDone: (aiResponse: string, debugInfo: any) => void,
      onTurn?: (detectedLanguage: string) => void
    ) => {
      const controller = new AbortController();
      streamAbortRef.current = controller;
      streamActiveRef.current = true;
      try {
        const response = await fetch(`/api/conversation/stream?${params}`, {
          method: "POST",
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error("Failed to get response");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep = buffer.indexOf("\n\n");
          while (sep !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const eventName = (frame.match(/^event:\s*(.+)$/m) || [])[1]?.trim();
            const dataLine = (frame.match(/^data:\s*(.+)$/m) || [])[1];
            if (eventName && dataLine) {
              let data: any = null;
              try {
                data = JSON.parse(dataLine);
              } catch {
                /* skip malformed frame */
              }
              if (data) {
                if (eventName === "turn") {
                  onTurn?.(data.detected_language || "");
                } else if (eventName === "sentence") {
                  onSentence(data.text || "");
                  if (data.audio_data) {
                    enqueueStreamedSentence({
                      text: data.text || "",
                      audioData: data.audio_data,
                    });
                  }
                } else if (eventName === "done") {
                  onDone(data.ai_response || "", data.debug_info || null);
                } else if (eventName === "error") {
                  throw new Error(data.detail || "Stream error");
                }
              }
            }
            sep = buffer.indexOf("\n\n");
          }
        }
      } finally {
        streamActiveRef.current = false;
        if (streamAbortRef.current === controller) {
          streamAbortRef.current = null;
        }
        // The stream ended but produced no playable audio → close the turn so
        // the mic returns to LISTENING instead of hanging on THINKING. Skipped
        // when the call ended (endCall owns that transition) or when a barge-in
        // already moved to LISTENING (there the silence timer owns the
        // re-submit — never submit a half-spoken interruption).
        if (
          !endedRef.current &&
          stageRef.current !== "listening" &&
          !queueActiveRef.current
        ) {
          handleTurnEnd();
        }
      }
    },
    [enqueueStreamedSentence, handleTurnEnd]
  );

  // ── Barge-in: user talks while AI is speaking → stop TTS, queue speech ────
  const handleBargeIn = useCallback(
    (text: string) => {
      stopAudioQueue();
      stopStreaming();
      clearSilenceTimer();
      processingRef.current = false;
      setIsProcessing(false);
      pendingTranscriptRef.current = text;
      setInputText(text);
      setDetectedLanguage(detectLanguage(text));
      setStage("listening");
      // Submit after the user pauses — same silence logic as normal turns.
      armSilenceTimer();
    },
    [armSilenceTimer, clearSilenceTimer, setStage, stopAudioQueue, stopStreaming]
  );

  // ── Submit an utterance through the chosen pipeline ───────────────────────
  const submitSpeech = useCallback(
    async (text: string) => {
      const normalized = normalizeTranscript(text);
      if (!normalized) return;
      if (processingRef.current) return;

      // Duplicate filter: never re-send the same transcript twice in a row.
      if (normalized === lastProcessedRef.current) {
        console.log("[VoiceAgent] Duplicate transcript ignored:", text);
        return;
      }
      lastProcessedRef.current = normalized;
      processingRef.current = true;
      setIsProcessing(true);
      clearSilenceTimer();
      setInputText("");
      pendingTranscriptRef.current = "";

      setMessages((prev) => [
        ...prev,
        { role: "user", content: text, timestamp: new Date().toISOString() },
      ]);
      setStage("thinking");

      try {
        const lang = detectLanguage(text);
        setDetectedLanguage(lang);

        const params = new URLSearchParams({
          mode,
          user_input: text,
          conversation_id: conversationId.current,
          language: lang,
          ...(mode === "test"
            ? { knowledge_file: knowledgeFile }
            : { institute_id: String(instituteId) }),
        });

        // SSE streaming: each sentence's audio is delivered as soon as it is
        // ready and playback begins immediately — the caller hears one live,
        // continuous speaker instead of waiting for a 30-second blob.
        let aiAccumulated = "";
        await streamConversation(
          params,
          (sentenceText) => {
            aiAccumulated += sentenceText;
            // Progressively reveal the reply while it is being spoken.
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "ai") {
                return [...prev.slice(0, -1), { ...last, content: aiAccumulated }];
              }
              return [
                ...prev,
                {
                  role: "ai",
                  content: aiAccumulated,
                  timestamp: new Date().toISOString(),
                },
              ];
            });
          },
          (fullText, debug) => {
            if (fullText) aiAccumulated = fullText;
            if (debug) setDebugInfo(debug);
          },
          (lang) => {
            if (lang) setDetectedLanguage(lang);
          }
        );

        // Finalize the AI message with the canonical response text.
        const aiText = aiAccumulated || "I'm sorry, I couldn't respond.";
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "ai") {
            return [...prev.slice(0, -1), { ...last, content: aiText }];
          }
          return [
            ...prev,
            { role: "ai", content: aiText, timestamp: new Date().toISOString() },
          ];
        });
      } catch (e: any) {
        // Barge-in / end call aborts the stream — the pipeline was already
        // reset by handleBargeIn/endCall, so this is expected and silent.
        if (e && e.name === "AbortError") {
          return;
        }
        // The user sees a friendly message; the REAL exception is logged to
        // the console and surfaced in the debug panel (never silently hidden).
        const detail = e && e.message ? String(e.message) : String(e);
        console.error("Voice pipeline error:", e);
        setDebugInfo((prev) =>
          prev
            ? { ...prev, stream_error: detail }
            : {
                retrieval_time_ms: 0,
                llm_time_ms: 0,
                tts_time_ms: 0,
                total_time_ms: 0,
                chunks_retrieved: 0,
                knowledge_source: "",
                stream_error: detail,
              }
        );
        setMessages((prev) => [
          ...prev,
          {
            role: "ai",
            content: "Sorry, something went wrong. Please try again.",
            timestamp: new Date().toISOString(),
          },
        ]);
        lastProcessedRef.current = ""; // allow retrying the same text
        processingRef.current = false;
        setIsProcessing(false);
        pendingTranscriptRef.current = "";
        // Full recovery: stop any queued AI audio and reset the STT session
        // so Mrs. D's trailing voice in the old mic buffer can NEVER become
        // the next user query — same guarantee as handleTurnEnd, on the
        // error path too (spec: AI must never hear itself).
        stopAudioQueue();
        setStage("listening");
        stopListening();
        if (!endedRef.current) {
          setTimeout(() => startListening(), 150);
        }
      }
    },
    [
      instituteId,
      knowledgeFile,
      mode,
      setStage,
      startListening,
      stopListening,
      stopAudioQueue,
      clearSilenceTimer,
      streamConversation,
    ]
  );

  // Forward refs so earlier callbacks (silence timer, turn end) can submit.
  const submitSpeechRef = useRef(submitSpeech);
  submitSpeechRef.current = submitSpeech;

  // ── Real-time VAD → MediaRecorder → Whisper STT ──────────────────────────
  // When the VAD catches speech, a recording starts; when the caller pauses,
  // the recording is sent to /api/conversation/transcribe (Whisper auto-
  // detects the language) and the transcript feeds the SAME pipeline as typed
  // input. This is the fix for "not listening": it detects ANY voice.
  const startRecording = useCallback(() => {
    const stream = vadRef.current?.stream;
    if (!stream || recorderRef.current || transcribingRef.current) return;
    try {
      const mime =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        recorderRef.current = null;
        const blob = new Blob(recChunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        recChunksRef.current = [];
        if (blob.size > 200) transcribeBlobRef.current(blob);
      };
      recorderRef.current = rec;
      rec.start();
    } catch (e) {
      console.error("MediaRecorder start failed:", e);
    }
  }, []);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
  }, []);

  // ── VAD speech events ─────────────────────────────────────────────────────
  // Speech START: while Mrs. D is talking this is a barge-in (stop TTS + the
  // stream immediately, then capture the caller). While listening it simply
  // begins a new recording. Never fires while thinking/processing.
  const handleVadSpeechStart = useCallback(() => {
    const stage = stageRef.current;
    if (endedRef.current || processingRef.current) return;
    // Post-TTS grace: ignore anything within ~450ms of the AI finishing —
    // the AI's own trailing audio in the mic must never start a recording.
    if (Date.now() - aiFinishedAtRef.current < 450) {
      vadRef.current?.reset();
      return;
    }
    if (stage === "speaking") {
      // Barge-in cooldown: ignore audio during the first ~400ms of a sentence
      // so the AI's own voice (or echo) can never trigger an interruption.
      if (Date.now() - aiSpeakStartedAtRef.current < 400) {
        vadRef.current?.reset();
        return;
      }
      stopAudioQueue();
      stopStreaming();
      processingRef.current = false;
      setIsProcessing(false);
      setStage("listening");
    }
    if (stage === "listening" || stage === "speaking") {
      setIsUserSpeaking(true);
      startRecording();
    }
  }, [setStage, startRecording, stopAudioQueue, stopStreaming]);

  const handleVadSpeechEnd = useCallback(() => {
    setIsUserSpeaking(false);
    stopRecording();
  }, [stopRecording]);

  // Keep the detector's callbacks pointed at the LATEST closures.
  handleVadStartRef.current = handleVadSpeechStart;
  handleVadEndRef.current = handleVadSpeechEnd;

  // Transcribe an utterance blob → feed the transcript into the pipeline.
  const transcribeBlob = useCallback(async (blob: Blob) => {
    if (endedRef.current || transcribingRef.current) return;
    transcribingRef.current = true;
    try {
      const form = new FormData();
      form.append("audio", blob, "utterance.webm");
      const res = await fetch("/api/conversation/transcribe", {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`STT ${res.status}`);
      const data = await res.json();
      const text = (data.text || "").trim();
      if (text) {
        const langName = LANG_CODE_TO_NAME[data.language] || "English";
        setDetectedLanguage(langName);
        submitSpeechRef.current(text);
      }
    } catch (e) {
      console.error("Transcription failed:", e);
      setError("Could not understand that. Please try again or type your message.");
      // Clear the error once the caller tries again / next turn succeeds.
      setTimeout(() => setError(""), 4000);
    } finally {
      transcribingRef.current = false;
    }
  }, []);
  transcribeBlobRef.current = transcribeBlob;

  // ── Input setup (once per mount) ──────────────────────────────────────────
  useEffect(() => {
    // Real-time VAD is the PRIMARY input: raw mic energy detects ANY voice in
    // ANY language, utterances are recorded and transcribed by Whisper. Only
    // fall back to the browser speech API when Web Audio VAD can't run.
    if (vadSupported) {
      const vad = new VoiceActivityDetector(
        {
          silenceMs: Math.min(Math.max(silenceTimeoutMs * 0.7, 900), 1600),
          buckets: 48,
        },
        {
          onSpeechStart: () => handleVadStartRef.current(),
          onSpeechEnd: () => handleVadEndRef.current(),
        }
      );
      // While Mrs. D is speaking, the mic hears her own voice too — raise the
      // effective threshold so only the CALLER's voice (louder than the AI)
      // can trigger a barge-in.
      vad.dynamicThreshold = () => {
        if (stageRef.current === "speaking") {
          return Math.max(0.03, aiRmsRef.current * 1.2 + 0.02);
        }
        return 0;
      };
      vadRef.current = vad;
      micLevelsRef.current = vad.levels;
      return () => {
        vad.stop();
        vadRef.current = null;
      };
    }

    if (
      !("webkitSpeechRecognition" in window) &&
      !("SpeechRecognition" in window)
    ) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      let interimTranscript = "";
      const confidences: number[] = [];

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          finalTranscript += transcript;
          confidences.push(result[0].confidence || 0);
        } else {
          interimTranscript += transcript;
        }
      }

      const stage = stageRef.current;

      // Barge-in: user speaks while the AI is talking → stop TTS immediately.
      // Cooldown: ignore audio during the first ~400ms of a sentence so the
      // AI's own voice (or echo of it) can never trigger an interruption.
      if (stage === "speaking") {
        if (finalTranscript.trim().length >= 2) {
          const avgConf = confidences.length
            ? confidences.reduce((a, b) => a + b, 0) / confidences.length
            : 0;
          const aiJustSpoke = Date.now() - aiSpeakStartedAtRef.current < 400;
          if (!aiJustSpoke && avgConf >= 0.5) {
            handleBargeIn(finalTranscript);
          }
        }
        return;
      }

      // Ignore everything while processing/thinking — never re-feed old audio.
      if (processingRef.current || stage !== "listening") {
        return;
      }

      // Post-TTS grace window: ignore any final transcript arriving right
      // after the AI stopped speaking (echo/trailing audio) — real new speech
      // will arrive a moment later and be captured by the fresh session.
      if (Date.now() - aiFinishedAtRef.current < 450) {
        return;
      }

      if (interimTranscript) {
        setInputText(interimTranscript);
      }
      if (finalTranscript) {
        pendingTranscriptRef.current = finalTranscript;
        setInputText(finalTranscript);
        const lang = detectLanguage(finalTranscript);
        setDetectedLanguage(lang);
        try {
          recognition.lang = LANGUAGE_VOICES[lang] || "en-IN";
        } catch {
          /* ignore */
        }
        armSilenceTimer();
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        // The microphone is blocked — this is NOT a backend failure. Do NOT
        // flip the call into the "connection error" screen (whose hardcoded
        // message would claim the backend is down while it is actually fine):
        // keep the conversation usable in text mode and tell the user the
        // REAL reason instead.
        listeningRef.current = false;
        setIsListening(false);
        setError(
          "Microphone access is blocked. Allow the microphone for this site " +
            "in the browser, or type your message below to continue the call."
        );
      }
    };

    recognition.onend = () => {
      // Recognition stopped. Only auto-restart while still wanted AND idle.
      if (
        listeningRef.current &&
        stageRef.current === "listening" &&
        !processingRef.current
      ) {
        try {
          recognition.start();
        } catch {
          /* ignore */
        }
      }
    };

    return () => {
      clearSilenceTimer();
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [armSilenceTimer, clearSilenceTimer, handleBargeIn, setStage, silenceTimeoutMs, vadSupported]);

  // ── Mrs. D's live waveform (AI audio analyser) ────────────────────────────
  // captureStream() on the <audio> element gives us her actual output without
  // rerouting it through a MediaElementSource (which can only be created once
  // per element — captureStream has no such restriction, so it survives
  // React StrictMode's double-mount cleanly). The analyser feeds aiLevelsRef
  // (waveform) + aiRmsRef (used to raise the VAD barge-in threshold above
  // her own voice so the AI can never interrupt herself).
  useEffect(() => {
    const el = audioRef.current as (HTMLAudioElement & { captureStream?: () => MediaStream }) | null;
    if (!el || typeof el.captureStream !== "function") return;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new Ctor();
      const stream = el.captureStream!();
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.25;
      src.connect(analyser);
    } catch (e) {
      console.warn("AI audio analyser unavailable:", e);
      return;
    }
    if (!analyser) return;
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const levels = aiLevelsRef.current;
    const N = levels.length;
    const per = Math.max(1, Math.floor(freq.length / N));
    const loop = () => {
      aiRafRef.current = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(freq);
      let sum = 0;
      for (let b = 0; b < N; b++) {
        let peak = 0;
        const start = b * per;
        const end = Math.min(freq.length, start + per);
        for (let i = start; i < end; i++) {
          if (freq[i] > peak) peak = freq[i];
        }
        levels[b] = peak / 255;
        sum += peak;
      }
      aiRmsRef.current = sum / (N * 255);
    };
    aiRafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(aiRafRef.current);
      ctx?.close().catch(() => {});
    };
  }, [audioRef]);

  // ── Greeting on mount ──────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    endedRef.current = false;
    setError("");
    setMessages([]);
    setDebugInfo(null);
    pendingTranscriptRef.current = "";
    lastProcessedRef.current = "";
    setStage("connecting");

    try {
      const params = new URLSearchParams({
        mode,
        user_input: mode === "process" ? "START_CALL" : "",
        conversation_id: conversationId.current,
        is_greeting: "true",
        language: detectedLanguage,
        ...(mode === "test"
          ? { knowledge_file: knowledgeFile }
          : { institute_id: String(instituteId) }),
      });

      // The greeting streams through the same SSE pipeline: sentence audio
      // starts playing the moment it is ready. When the queue drains,
      // handleTurnEnd transitions to LISTENING and starts a FRESH recognition
      // session (old mic buffer discarded → the AI can never hear itself).
      let greetingAccum = "";
      await streamConversation(
        params,
        (sentenceText) => {
          greetingAccum += sentenceText;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "ai") {
              return [...prev.slice(0, -1), { ...last, content: greetingAccum }];
            }
            return [
              ...prev,
              {
                role: "ai",
                content: greetingAccum,
                timestamp: new Date().toISOString(),
              },
            ];
          });
        },
        (fullText, debug) => {
          if (fullText) greetingAccum = fullText;
          if (debug) setDebugInfo(debug);
        },
        (lang) => {
          if (lang) setDetectedLanguage(lang);
        }
      );
      // Safety net: if the greeting produced no sentences at all, keep the
      // transcript from being blank.
      setMessages((prev) =>
        prev.length === 0
          ? [
              {
                role: "ai",
                content: greetingAccum || "Hi! How can I help you today?",
                timestamp: new Date().toISOString(),
              },
            ]
          : prev
      );
    } catch (e: any) {
      if (e && e.name === "AbortError") return;
      console.error("Error starting call:", e);
      setError("Failed to connect to the voice agent. Is the backend running?");
      setStage("error");
    }
  }, [
    detectedLanguage,
    instituteId,
    knowledgeFile,
    mode,
    setStage,
    streamConversation,
  ]);

  const sendMessage = useCallback(
    async (text?: string) => {
      const content = (text ?? inputText).trim();
      if (!content || processingRef.current) return;
      pendingTranscriptRef.current = "";
      await submitSpeechRef.current(content);
    },
    [inputText]
  );

  const toggleListening = useCallback(() => {
    if (listeningRef.current) {
      stopListening();
    } else {
      startListening();
    }
  }, [startListening, stopListening]);

  const endCall = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    stopListening();
    stopAudioQueue();
    stopStreaming();
    processingRef.current = false;
    pendingTranscriptRef.current = "";
    setMessages([]);
    setDebugInfo(null);
    setInputText("");
    setStage("idle");
    try {
      await fetch(
        `/api/conversation/end?conversation_id=${conversationId.current}`,
        { method: "POST" }
      );
    } catch {
      /* ignore */
    }
    onEnded?.();
  }, [onEnded, setStage, stopListening, stopAudioQueue, stopStreaming]);

  return {
    callStage,
    messages,
    inputText,
    setInputText,
    isListening,
    isProcessing,
    debugInfo,
    detectedLanguage,
    error,
    setError,
    recognitionRef,
    audioRef,
    conversationId,
    startCall,
    endCall,
    sendMessage,
    toggleListening,
    startListening,
    stopListening,
    // Real-time voice UX
    vadSupported,
    isUserSpeaking,
    micLevelsRef, // live caller waveform (0..1 per bar)
    aiLevelsRef, // live Mrs. D waveform (0..1 per bar)
  };
}
