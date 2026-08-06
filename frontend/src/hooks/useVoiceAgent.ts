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

export type CallStage = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

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

function detectLanguage(text: string): string {
  for (const { re, lang } of SCRIPT_TO_LANGUAGE) {
    if (re.test(text)) return lang;
  }
  return "English";
}

function normalizeTranscript(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function useVoiceAgent({
  mode = "test",
  knowledgeFile = "institute.json",
  instituteId = 1,
  silenceTimeoutMs = 2000,
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

  // ── Silence / VAD: fire after ~2s with no new speech ──────────────────────
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
    if (processingRef.current || !recognitionRef.current) return;
    if (listeningRef.current) return; // never start a second session
    listeningRef.current = true;
    setIsListening(true);
    try {
      recognitionRef.current.start();
    } catch {
      /* may throw if already started */
    }
  }, []);

  // ── Barge-in: user talks while AI is speaking → stop TTS, listen ──────────
  const handleVoiceInterruption = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.onended = null;
    }
    if (stageRef.current === "speaking" || stageRef.current === "thinking") {
      setStage("listening");
      startListening();
    }
  }, [setStage, startListening]);

  // ── Submit an utterance through the chosen pipeline ───────────────────────
  const submitSpeech = useCallback(
    async (text: string) => {
      const normalized = normalizeTranscript(text);
      // Duplicate filter: never re-send the same transcript twice in a row.
      if (normalized === lastProcessedRef.current) {
        console.log("[VoiceAgent] Duplicate transcript ignored:", text);
        return;
      }
      if (processingRef.current) return;

      lastProcessedRef.current = normalized;
      processingRef.current = true;
      setIsProcessing(true);
      stopListening();
      setInputText("");

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

        setMessages((prev) => [
          ...prev,
          { role: "ai", content: aiText, timestamp: new Date().toISOString() },
        ]);
        setDebugInfo(data.debug_info || null);
        setStage("speaking");

        if (data.audio_data && audioRef.current) {
          audioRef.current.src = `data:audio/mp3;base64,${data.audio_data}`;
          await audioRef.current.play();
          audioRef.current.onended = () => {
            // ── Clear buffers, then resume listening for NEW audio only ──
            processingRef.current = false;
            setIsProcessing(false);
            pendingTranscriptRef.current = "";
            setInputText("");
            setStage("listening");
            startListening();
          };
        } else {
          setTimeout(() => {
            processingRef.current = false;
            setIsProcessing(false);
            pendingTranscriptRef.current = "";
            setStage("listening");
            startListening();
          }, 400);
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
        processingRef.current = false;
        setIsProcessing(false);
        pendingTranscriptRef.current = "";
        setStage("listening");
        startListening();
      }
    },
    [instituteId, knowledgeFile, mode, setStage, startListening, stopListening]
  );

  // Expose submitSpeech so the silence timer (defined above) can call it.
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

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      // Barge-in: new speech while AI is talking.
      if (
        stageRef.current === "speaking" &&
        (interimTranscript || finalTranscript)
      ) {
        handleVoiceInterruption();
      }

      // Ignore speech while processing or thinking — never re-feed old audio.
      if (processingRef.current || stageRef.current !== "listening") {
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
      // Recognition stopped. Only auto-restart while still listening AND idle.
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
  }, [armSilenceTimer, clearSilenceTimer, handleVoiceInterruption, setStage]);

  // ── Greeting on mount ──────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
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

      if (data.audio_data && audioRef.current) {
        audioRef.current.src = `data:audio/mp3;base64,${data.audio_data}`;
        audioRef.current.play();
        audioRef.current.onended = () => {
          pendingTranscriptRef.current = "";
          setStage("listening");
          startListening();
        };
      } else {
        setTimeout(() => {
          setStage("listening");
          startListening();
        }, 400);
      }
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
    stopListening();
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
  }, [onEnded, setStage, stopListening]);

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
