import { useCallback, useEffect, useRef, useState } from "react";

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
  chunks_retrieved: number;
  knowledge_source: string;
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

  // ── Sentence audio queue (ONE queue per conversation) ─────────────────────
  // Responses arrive as sentence-level audio chunks. They are played strictly
  // one at a time so the caller always hears a COMPLETE sentence and no two
  // TTS streams ever overlap. A new response or a barge-in clears the queue.
  const audioQueueRef = useRef<Array<{ text: string; audioData: string }>>([]);
  const queueActiveRef = useRef(false);
  const aiSpeakStartedAtRef = useRef(0); // barge-in cooldown anchor
  const aiFinishedAtRef = useRef(0); // when AI finished speaking (post-TTS grace)

  // ── Silence / VAD: fire after ~1.3s with no new speech ────────────────────
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

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
    }, silenceTimeoutMs);
  }, [silenceTimeoutMs, clearSilenceTimer]);

  // ── Recognition lifecycle: exactly ONE active session ─────────────────────
  const stopListening = useCallback(() => {
    listeningRef.current = false;
    setIsListening(false);
    clearSilenceTimer();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* already stopped */
      }
    }
  }, [clearSilenceTimer]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    if (listeningRef.current) return; // never start a second session
    listeningRef.current = true;
    setIsListening(true);
    try {
      recognitionRef.current.start();
    } catch {
      /* may throw if already started */
    }
  }, []);

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
      setTimeout(() => startListening(), 120);
    }
  }, [setStage, startListening]);

  // ── Play the next sentence in the queue. Each sentence is a COMPLETE
  //    utterance — never cut in the middle. When the queue is empty the turn
  //    is finished and we return to LISTENING. ───────────────────────────────
  const playNextInQueue = useCallback(async () => {
    if (endedRef.current || !queueActiveRef.current) return;
    const next = audioQueueRef.current.shift();
    if (!next) {
      queueActiveRef.current = false;
      handleTurnEnd();
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
    el.onended = () => playNextInQueue();
    try {
      await el.play();
    } catch {
      // Autoplay blocked or aborted — skip to the next sentence.
      playNextInQueue();
    }
  }, [handleTurnEnd]);

  // ── Start the sentence queue for a freshly generated response ─────────────
  const playAudioQueue = useCallback(
    (sentences: Array<{ text: string; audio_data: string | null }>) => {
      const withAudio = sentences.filter((s) => s.audio_data);
      if (withAudio.length === 0) return false;
      stopAudioQueue();
      audioQueueRef.current = withAudio.map((s) => ({
        text: s.text,
        audioData: s.audio_data as string,
      }));
      queueActiveRef.current = true;
      playNextInQueue();
      return true;
    },
    [playNextInQueue, stopAudioQueue]
  );

  // ── Barge-in: user talks while AI is speaking → stop TTS, queue speech ────
  const handleBargeIn = useCallback(
    (text: string) => {
      stopAudioQueue();
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
    [armSilenceTimer, clearSilenceTimer, setStage, stopAudioQueue]
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

        const params = new URLSearchParams(
          mode === "test"
            ? {
                knowledge_file: knowledgeFile,
                user_input: text,
                conversation_id: conversationId.current,
                include_audio: "true",
                language: lang,
              }
            : {
                institute_id: String(instituteId),
                user_input: text,
                conversation_id: conversationId.current,
                include_audio: "true",
                language: lang,
              }
        );

        const endpoint =
          mode === "test"
            ? `/api/conversation/test?${params}`
            : `/api/conversation/process?${params}`;

        const response = await fetch(endpoint, { method: "POST" });
        if (!response.ok) throw new Error("Failed to get response");

        const data = await response.json();
        const aiText = data.ai_response || "I'm sorry, I couldn't respond.";

        // If the user barged in while we were waiting, discard this turn's audio.
        if (stageRef.current !== "thinking") {
          return;
        }

        setMessages((prev) => [
          ...prev,
          { role: "ai", content: aiText, timestamp: new Date().toISOString() },
        ]);
        setDebugInfo(data.debug_info || null);
        setStage("speaking");

        // Prefer the sentence queue (no mid-sentence cut-off, one TTS at a
        // time). Fall back to a single blob for legacy endpoints.
        const queueStarted =
          Array.isArray(data.sentence_audios) &&
          data.sentence_audios.length > 0
            ? playAudioQueue(data.sentence_audios)
            : false;
        if (!queueStarted && data.audio_data && audioRef.current) {
          playAudioQueue([{ text: aiText, audio_data: data.audio_data }]);
        } else if (!queueStarted) {
          setTimeout(() => handleTurnEnd(), 400);
        }
      } catch (e) {
        console.error("Voice pipeline error:", e);
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
        setStage("listening");
        startListening();
      }
    },
    [
      instituteId,
      knowledgeFile,
      mode,
      setStage,
      startListening,
      handleTurnEnd,
      clearSilenceTimer,
      playAudioQueue,
    ]
  );

  // Forward refs so earlier callbacks (silence timer, turn end) can submit.
  const submitSpeechRef = useRef(submitSpeech);
  submitSpeechRef.current = submitSpeech;

  // ── Speech recognition setup (once per mount) ─────────────────────────────
  useEffect(() => {
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
      if (event.error === "not-allowed") {
        setError("Microphone access denied. Please allow microphone access.");
        setStage("error");
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
  }, [armSilenceTimer, clearSilenceTimer, handleBargeIn, setStage]);

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
      const params = new URLSearchParams(
        mode === "test"
          ? {
              knowledge_file: knowledgeFile,
              user_input: "",
              conversation_id: conversationId.current,
              include_audio: "true",
              is_greeting: "true",
              language: detectedLanguage,
            }
          : {
              institute_id: String(instituteId),
              user_input: "START_CALL",
              conversation_id: conversationId.current,
              include_audio: "true",
              is_greeting: "true",
              language: detectedLanguage,
            }
      );
      const endpoint =
        mode === "test"
          ? `/api/conversation/test?${params}`
          : `/api/conversation/process?${params}`;

      const response = await fetch(endpoint, { method: "POST" });
      if (!response.ok) throw new Error("Failed to connect to voice agent");

      const data = await response.json();
      const greeting = data.ai_response || "Hi! How can I help you today?";

      setMessages([
        { role: "ai", content: greeting, timestamp: new Date().toISOString() },
      ]);
      setDebugInfo(data.debug_info || null);
      setStage("speaking");

      // Greeting also flows through the same audio queue. On completion it
      // transitions to LISTENING and starts a FRESH recognition session (the
      // old mic buffer is discarded so the AI can never hear itself).
      const greetQueued =
        Array.isArray(data.sentence_audios) && data.sentence_audios.length > 0
          ? playAudioQueue(data.sentence_audios)
          : data.audio_data
          ? playAudioQueue([{ text: greeting, audio_data: data.audio_data }])
          : false;
      if (!greetQueued) {
        setTimeout(() => {
          pendingTranscriptRef.current = "";
          setStage("listening");
          startListening();
        }, 400);
      }
      // (When the greeting queue is exhausted, playNextInQueue → handleTurnEnd
      //  already clears the mic buffer and resumes LISTENING.)
    } catch (e) {
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
    startListening,
    playAudioQueue,
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
  }, [onEnded, setStage, stopListening, stopAudioQueue]);

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
  };
}
