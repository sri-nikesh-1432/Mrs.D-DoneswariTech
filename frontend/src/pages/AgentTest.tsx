import React, { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Mic, MicOff, RotateCcw, Rocket, Loader2, Volume2, Square,
  Trash2, Globe, BookOpen, CheckCircle2, AlertCircle, Headphones
} from "lucide-react";
import AgentOrb from "../components/AgentOrb";
import RealWaveform from "../components/RealWaveform";
import TextInput from "../components/TextInput";
import { voiceWS } from "../services/voiceWebSocket";
import type { VoiceWSState } from "../services/voiceWebSocket";
import { publishAgent, getAgent, sendTextMessage, clearChatSession } from "../services/api";
import LatencyPanel from "../components/LatencyPanel";
import RetrievalDebugPanel from "../components/RetrievalDebugPanel";
import { useTranslation, SUPPORTED_LANGUAGES, LANGUAGE_NATIVE_NAMES, SupportedLanguage } from "../i18n";
import type { ConversationMessage } from "../types";

const STATE_MAP: Record<VoiceWSState, { label: string; color: string }> = {
  disconnected: { label: "Voice Idle", color: "bg-[var(--gray-100)] text-[var(--gray-600)]" },
  connecting: { label: "Connecting…", color: "bg-amber-50 text-amber-700" },
  connected: { label: "Voice Ready", color: "bg-[var(--sky-50)] text-[var(--sky-700)]" },
  greeting: { label: "Speaking…", color: "bg-[var(--sky-50)] text-[var(--sky-700)]" },
  listening: { label: "Listening…", color: "bg-emerald-50 text-emerald-700" },
  processing: { label: "Thinking…", color: "bg-amber-50 text-amber-700" },
  speaking: { label: "Speaking…", color: "bg-[var(--sky-50)] text-[var(--sky-700)]" },
  error: { label: "Voice Error", color: "bg-red-50 text-red-700" },
};

export default function AgentTest() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { t, lang, changeLanguage } = useTranslation();

  const [wsState, setWsState] = useState<VoiceWSState>("disconnected");
  const [amplitude, setAmplitude] = useState(0);      // REAL mic level
  const [playAmplitude, setPlayAmplitude] = useState(0); // REAL agent audio level
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [partialUser, setPartialUser] = useState("");
  const [partialAgent, setPartialAgent] = useState("");
  const [agentName, setAgentName] = useState("Mrs. D");
  const [companyName, setCompanyName] = useState("Doneswari Technologies");
  const [agentStatus, setAgentStatus] = useState<string | undefined>();
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState("");
  const [isTypingLoading, setIsTypingLoading] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>(lang);
  const [activeAudio, setActiveAudio] = useState<HTMLAudioElement | null>(null);
  const [playingMsgIndex, setPlayingMsgIndex] = useState<number | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(`session_${Date.now()}`);

  // Load agent profile
  useEffect(() => {
    const id = agentId || "1";
    getAgent(id)
      .then((a) => {
        setAgentName(a.agent_name || "Mrs. D");
        setCompanyName(a.name || "Doneswari Technologies");
        setAgentStatus(a.status);
      })
      .catch(() => {
        setAgentName("Mrs. D");
        setCompanyName("Doneswari Technologies");
      });
  }, [agentId]);

  useEffect(() => {
    return () => {
      voiceWS.disconnect();
      if (activeAudio) {
        activeAudio.pause();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Autoscroll transcript
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, partialUser, partialAgent, isTypingLoading]);

  const connect = useCallback(() => {
    const id = agentId || "1";
    voiceWS.connect(id, {
      onStateChange: (s) => setWsState(s),
      onAmplitude: (a) => setAmplitude(a),
      onPlaybackAmplitude: (a) => setPlayAmplitude(a),
      onTranscriptPartial: (t) => setPartialUser(t),
      onTranscriptFinal: (t) => {
        setPartialUser("");
        setMessages((prev) => [...prev, { role: "user", content: t, timestamp: now() }]);
      },
      onAgentPartial: (t) => setPartialAgent(t),
      onAgentFinal: (t) => {
        setPartialAgent("");
        if (t.trim()) {
          setMessages((prev) => [...prev, { role: "assistant", content: t, timestamp: now() }]);
        }
      },
      onError: (msg) => {
        console.warn("[VoiceWS]", msg);
        setToast(msg);
        setTimeout(() => setToast(""), 4000);
      },
    });
  }, [agentId]);

  const startConversation = async () => {
    connect();
    await voiceWS.startMic();
  };

  const restartConversation = () => {
    stopCurrentAudio();
    voiceWS.disconnect();
    setMessages([]);
    setPartialUser("");
    setPartialAgent("");
    setTimeout(connect, 300);
  };

  const toggleMic = () => {
    if (wsState === "listening") voiceWS.stopMic();
    else voiceWS.startMic();
  };

  const stopCurrentAudio = () => {
    if (activeAudio) {
      activeAudio.pause();
      setActiveAudio(null);
      setPlayingMsgIndex(null);
    }
    voiceWS.interrupt();
  };

  // ── First-Class Text Handler ───────────────────────────────────────────
  const handleSendText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Display user utterance immediately
    const userMsg: ConversationMessage = {
      role: "user",
      content: trimmed,
      timestamp: now(),
      language: selectedLanguage,
    };
    setMessages((prev) => [...prev, userMsg]);

    // If WebSocket voice is open, route through real-time socket
    if (wsState !== "disconnected" && wsState !== "error") {
      voiceWS.sendText(trimmed);
      return;
    }

    // Otherwise, execute independent first-class REST RAG chat
    setIsTypingLoading(true);
    try {
      const res = await sendTextMessage(
        agentId || 1,
        trimmed,
        sessionIdRef.current,
        selectedLanguage
      );

      const assistantMsg: ConversationMessage = {
        role: "assistant",
        content: res.response || res.message || "",
        timestamp: now(),
        sources: res.sources,
        audioData: res.audio_data,
        language: res.language || selectedLanguage,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Autoplay voice response if available
      if (res.audio_data) {
        playAudioData(res.audio_data, messages.length + 1);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I couldn't process that question right now. Please try again or contact the admissions office directly.",
          timestamp: now(),
        },
      ]);
    } finally {
      setIsTypingLoading(false);
    }
  };

  // Play audio from base64 MP3
  const playAudioData = (b64Audio: string, msgIndex?: number) => {
    stopCurrentAudio();
    try {
      const audio = new Audio("data:audio/mp3;base64," + b64Audio);
      if (typeof msgIndex === "number") setPlayingMsgIndex(msgIndex);
      setActiveAudio(audio);
      audio.onended = () => {
        setActiveAudio(null);
        setPlayingMsgIndex(null);
      };
      audio.onerror = () => {
        setActiveAudio(null);
        setPlayingMsgIndex(null);
      };
      audio.play().catch(() => {});
    } catch (e) {
      console.warn("Failed to play synthesized audio", e);
    }
  };

  // Clear conversation history
  const handleClearConversation = async () => {
    if (window.confirm("Clear active conversation history?")) {
      stopCurrentAudio();
      setMessages([]);
      setPartialUser("");
      setPartialAgent("");
      try {
        await clearChatSession(sessionIdRef.current);
      } catch {}
      sessionIdRef.current = `session_${Date.now()}`;
      setToast("Conversation cleared");
      setTimeout(() => setToast(""), 3000);
    }
  };

  const handleLanguageChange = (lang: SupportedLanguage) => {
    setSelectedLanguage(lang);
    changeLanguage(lang);
  };

  const handlePublish = async () => {
    const id = agentId || "1";
    setPublishing(true);
    try {
      const res = await publishAgent(id);
      setToast(res.message);
      setTimeout(() => navigate(`/agent/${id}/students`), 1200);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setToast(detail || "Publish failed — upload a knowledge document first");
      setTimeout(() => setToast(""), 4000);
    } finally {
      setPublishing(false);
    }
  };

  const isLiveAgent = agentStatus === "published" || agentStatus === "ready" || agentStatus === "testing";
  const badge =
    wsState === "disconnected" && isLiveAgent
      ? { label: "Ready", color: "bg-emerald-50 text-emerald-700" }
      : STATE_MAP[wsState] ?? STATE_MAP.disconnected;
  const inConversation = wsState !== "disconnected" && wsState !== "error";
  const isSpeaking = wsState === "speaking" || wsState === "greeting" || activeAudio !== null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col" style={{ minHeight: "calc(100vh - 20px)" }}>
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-3 border-b hairline">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-display font-semibold text-[var(--gray-800)]">
              {agentName}
            </h1>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-sky-100 text-[var(--sky-700)]">
              Doneswari AI Telecaller
            </span>
            <span className={`text-[12px] font-semibold px-3 py-0.5 rounded-full ${badge.color}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-[13px] text-[var(--gray-500)] mt-0.5">
            Admissions Telecaller for {companyName} · Grounded in uploaded institutional PDF documents
          </p>
        </div>

        {/* Language selector & actions */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <div className="flex items-center gap-1.5 bg-white/70 backdrop-blur-md border hairline rounded-xl px-2.5 py-1 text-[13px]">
            <Globe className="w-3.5 h-3.5 text-[var(--sky-500)]" />
            <select
              value={selectedLanguage}
              onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
              className="bg-transparent text-[13px] font-medium text-[var(--gray-700)] outline-none cursor-pointer"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {LANGUAGE_NATIVE_NAMES[lang]} ({lang})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleClearConversation}
            className="p-2 rounded-xl text-[var(--gray-400)] hover:text-red-600 hover:bg-red-50 transition-colors"
            title="Clear Conversation"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {toast && (
        <div className="mb-3 text-sm text-[var(--sky-700)] glass-sky rounded-[var(--radius-md)] px-4 py-2">
          {toast}
        </div>
      )}

      {/* ── Voice Assistant Visualization ── */}
      <div className="flex justify-center py-2">
        <AgentOrb state={isSpeaking ? "speaking" : mapToOrbState(wsState)} amplitude={amplitude} />
      </div>

      {/* REAL waveforms */}
      <div className="flex justify-center h-14 mb-1">
        {isSpeaking ? (
          <RealWaveform source="playback" amplitude={playAmplitude || 0.4} active={true} height={56} color="#0e93e8" />
        ) : (
          <RealWaveform source="mic" amplitude={amplitude} active={wsState === "listening"} height={56} color="#3fb1f5" />
        )}
      </div>

      {/* Audio Status & Interruption Notice */}
      <div className="text-center text-[12px] text-[var(--gray-400)] mb-3 flex items-center justify-center gap-2">
        {isSpeaking ? (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-sky-500 animate-ping" />
            <span className="text-[var(--sky-700)] font-medium">Mrs. D is speaking — barge-in interrupts instantly</span>
            <button
              onClick={stopCurrentAudio}
              className="ml-2 inline-flex items-center gap-1 text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-md hover:bg-red-100"
            >
              <Square className="w-3 h-3 fill-current" /> Stop
            </button>
          </>
        ) : wsState === "listening" ? (
          <span className="text-emerald-600 font-medium">Listening to your question…</span>
        ) : (
          <span>Ask questions about admissions, courses, fees, or eligibility via voice or text below</span>
        )}
      </div>

      {/* ── Conversation Workspace / Transcript ── */}
      <div
        ref={transcriptRef}
        className="flex-1 overflow-y-auto glass rounded-[var(--radius-lg)] p-4 mb-4 min-h-[220px] shadow-[inset_0_1px_3px_rgba(0,0,0,0.03)]"
      >
        {messages.length === 0 && !partialUser && !partialAgent && !isTypingLoading && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[var(--gray-400)]">
            <Headphones className="w-8 h-8 text-[var(--gray-300)] mb-2" />
            <p className="text-[14px] font-medium text-[var(--gray-600)]">Welcome to Admissions Support</p>
            <p className="text-[12.5px] max-w-md mt-1 text-[var(--gray-400)]">
              Click the microphone to start voice calling, or type any question below. Answers are strictly grounded in the institution's official documents.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-4 max-w-lg">
              {[
                "What courses are offered?",
                "What is the fee structure?",
                "Do you provide hostel facility?",
                "What is the admission procedure?",
              ].map((sample) => (
                <button
                  key={sample}
                  onClick={() => handleSendText(sample)}
                  className="text-[11.5px] bg-white/70 hover:bg-sky-50 border hairline px-2.5 py-1.5 rounded-lg text-[var(--gray-700)] transition-colors"
                >
                  "{sample}"
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed ${
                m.role === "user"
                  ? "bg-[var(--sky-500)] text-white rounded-br-md shadow-sm"
                  : "bg-white/85 backdrop-blur-md border hairline text-[var(--gray-800)] rounded-bl-md shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className={`text-[11px] font-semibold ${m.role === "user" ? "text-sky-100" : "text-[var(--sky-600)]"}`}>
                  {m.role === "user" ? "You" : agentName}
                </span>
                <span className={`text-[10px] ${m.role === "user" ? "text-sky-200" : "text-[var(--gray-400)]"}`}>
                  {m.timestamp}
                </span>
              </div>

              <div className="whitespace-pre-wrap">{m.content}</div>

              {/* Provenance citations */}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-[var(--gray-100)] flex flex-wrap gap-1.5">
                  {m.sources.slice(0, 2).map((s, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 text-[11px] bg-sky-50 text-[var(--sky-700)] px-2 py-0.5 rounded-md font-medium"
                      title={s.section}
                    >
                      <BookOpen className="w-3 h-3 text-[var(--sky-500)]" />
                      {s.document_name || "Document"}{s.page ? ` · Page ${s.page}` : ""}
                    </span>
                  ))}
                </div>
              )}

              {/* Play synthesized audio button */}
              {m.role === "assistant" && m.audioData && (
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => playAudioData(m.audioData!, i)}
                    className="inline-flex items-center gap-1 text-[11px] text-[var(--sky-600)] hover:text-[var(--sky-800)] font-medium"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    {playingMsgIndex === i ? "Playing voice…" : "Listen"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {partialUser && (
          <div className="mb-3 flex justify-end">
            <div className="max-w-[82%] rounded-2xl px-4 py-2.5 text-[13.5px] bg-[var(--sky-100)] text-[var(--sky-800)] italic rounded-br-md">
              {partialUser}…
            </div>
          </div>
        )}

        {partialAgent && (
          <div className="mb-3 flex justify-start">
            <div className="max-w-[82%] rounded-2xl px-4 py-2.5 text-[13.5px] bg-white/80 backdrop-blur-md border hairline text-[var(--gray-800)] rounded-bl-md">
              {partialAgent}
            </div>
          </div>
        )}

        {isTypingLoading && (
          <div className="mb-3 flex justify-start">
            <div className="rounded-2xl px-4 py-2.5 text-[13px] bg-white/70 backdrop-blur-md border hairline text-[var(--gray-500)] flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--sky-500)]" />
              <span>Mrs. D is retrieving institutional documents…</span>
            </div>
          </div>
        )}
      </div>

      {/* ── First-Class Text Input ── */}
      <div className="mb-3">
        <TextInput
          voiceState={isSpeaking ? "speaking" : mapToOrbState(wsState)}
          onSendText={handleSendText}
          onMicStart={() => (inConversation ? voiceWS.startMic() : startConversation())}
          onMicStop={() => voiceWS.stopMic()}
          disabled={false}
        />
      </div>

      {/* Internal latency & retrieval inspection panels */}
      {agentId && <LatencyPanel agentId={agentId} />}
      {agentId && <RetrievalDebugPanel agentId={agentId} />}

      {/* ── Main Voice & Action Controls ── */}
      <div className="flex items-center justify-center gap-3 pt-2 pb-1">
        {!inConversation ? (
          <button
            onClick={startConversation}
            className="flex items-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white font-semibold text-sm rounded-xl px-6 py-3 shadow-[0_8px_24px_rgba(14,147,232,0.35)] transition-all"
          >
            <Mic className="w-4.5 h-4.5" /> Start Voice Call
          </button>
        ) : (
          <>
            <button
              onClick={toggleMic}
              className={`flex items-center gap-2 font-semibold text-sm rounded-xl px-5 py-3 border transition-colors ${
                wsState === "listening"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                  : "bg-white/80 backdrop-blur-md text-[var(--gray-800)] border-[var(--gray-200)] hover:bg-white"
              }`}
            >
              {wsState === "listening" ? <Mic className="w-4.5 h-4.5" /> : <MicOff className="w-4.5 h-4.5" />}
              {wsState === "listening" ? "Mute Mic" : "Unmute Mic"}
            </button>

            {isSpeaking && (
              <button
                onClick={stopCurrentAudio}
                className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 font-semibold text-sm rounded-xl px-4 py-3 border border-red-200 transition-colors"
              >
                <Square className="w-4 h-4 fill-current" /> Stop Speaking
              </button>
            )}

            <button
              onClick={restartConversation}
              className="flex items-center gap-2 glass hover:bg-white/80 text-[var(--gray-800)] font-semibold text-sm rounded-xl px-5 py-3 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Restart Call
            </button>
          </>
        )}

        <button
          onClick={handlePublish}
          disabled={publishing}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl px-6 py-3 shadow-[0_8px_24px_rgba(16,185,129,0.35)] disabled:opacity-60 transition-all"
        >
          {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4.5 h-4.5" />}
          Publish Telecaller
        </button>
      </div>
    </div>
  );
}

function mapToOrbState(s: VoiceWSState): "idle" | "listening" | "thinking" | "speaking" {
  if (s === "listening") return "listening";
  if (s === "processing") return "thinking";
  if (s === "speaking" || s === "greeting") return "speaking";
  return "idle";
}

function now(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
