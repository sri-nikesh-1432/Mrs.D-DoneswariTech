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
      ? { label: "Ready", color: "bg-emerald-500/15 border border-emerald-400/40 text-emerald-300" }
      : {
          disconnected: { label: "Voice Idle", color: "bg-slate-800 border border-slate-700 text-slate-400" },
          connecting: { label: "Connecting…", color: "bg-amber-500/15 border border-amber-400/40 text-amber-300" },
          connected: { label: "Voice Ready", color: "bg-sky-500/15 border border-sky-400/40 text-sky-300" },
          greeting: { label: "Speaking…", color: "bg-sky-500/15 border border-sky-400/40 text-sky-300" },
          listening: { label: "Listening…", color: "bg-emerald-500/15 border border-emerald-400/40 text-emerald-300" },
          processing: { label: "Thinking…", color: "bg-amber-500/15 border border-amber-400/40 text-amber-300" },
          speaking: { label: "Speaking…", color: "bg-sky-500/15 border border-sky-400/40 text-sky-300" },
          error: { label: "Voice Error", color: "bg-red-500/15 border border-red-400/40 text-red-300" },
        }[wsState] ?? { label: "Voice Idle", color: "bg-slate-800 border border-slate-700 text-slate-400" };

  const inConversation = wsState !== "disconnected" && wsState !== "error";
  const isSpeaking = wsState === "speaking" || wsState === "greeting" || activeAudio !== null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col text-slate-100" style={{ minHeight: "calc(100vh - 20px)" }}>
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              {agentName}
            </h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/30 text-sky-300 font-mono">
              Mrs. D Telecaller
            </span>
            <span className={`text-xs font-semibold px-3 py-0.5 rounded-full ${badge.color}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Admissions Telecaller for <strong className="text-slate-200">{companyName}</strong> · Grounded in uploaded institutional PDF documents
          </p>
        </div>

        {/* Language selector & actions */}
        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs shadow-inner">
            <Globe className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <select
              value={selectedLanguage}
              onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
              className="bg-transparent text-xs font-medium text-slate-200 outline-none cursor-pointer"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang} value={lang} className="bg-slate-900 text-slate-200">
                  {LANGUAGE_NATIVE_NAMES[lang]} ({lang})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleClearConversation}
            className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-slate-800 border border-transparent hover:border-slate-700 transition-colors"
            title="Clear Conversation"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {toast && (
        <div className="mb-3 text-xs text-sky-300 bg-sky-950/80 border border-sky-500/40 rounded-xl px-4 py-2.5 shadow-lg">
          {toast}
        </div>
      )}

      {/* ── Voice Assistant Visualization ── */}
      <div className="flex flex-col items-center justify-center py-2 relative">
        <div className="absolute w-64 h-64 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
        <AgentOrb state={isSpeaking ? "speaking" : mapToOrbState(wsState)} amplitude={amplitude} />
      </div>

      {/* REAL waveforms */}
      <div className="flex justify-center h-14 mb-1">
        {isSpeaking ? (
          <RealWaveform source="playback" amplitude={playAmplitude || 0.4} active={true} height={56} color="#38bdf8" />
        ) : (
          <RealWaveform source="mic" amplitude={amplitude} active={wsState === "listening"} height={56} color="#0ea5e9" />
        )}
      </div>

      {/* Audio Status & Interruption Notice */}
      <div className="text-center text-xs text-slate-400 mb-3 flex items-center justify-center gap-2">
        {isSpeaking ? (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-ping" />
            <span className="text-sky-300 font-medium">Mrs. D is speaking — barge-in interrupts instantly</span>
            <button
              onClick={stopCurrentAudio}
              className="ml-2 inline-flex items-center gap-1 text-[11px] bg-red-950/80 text-red-300 border border-red-500/40 px-2 py-0.5 rounded-md hover:bg-red-900"
            >
              <Square className="w-3 h-3 fill-current" /> Stop Speaking
            </button>
          </>
        ) : wsState === "listening" ? (
          <span className="text-emerald-400 font-medium flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Listening to your question…
          </span>
        ) : (
          <span className="text-slate-400">Ask questions about admissions, courses, fees, or eligibility via voice or text below</span>
        )}
      </div>

      {/* ── Conversation Workspace / Transcript ── */}
      <div
        ref={transcriptRef}
        className="flex-1 overflow-y-auto glass-strong rounded-3xl p-5 mb-4 min-h-[220px] border border-slate-800 shadow-2xl space-y-3"
      >
        {messages.length === 0 && !partialUser && !partialAgent && !isTypingLoading && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 mb-3">
              <Headphones className="w-6 h-6" />
            </div>
            <p className="text-base font-bold text-white">Welcome to Admissions Support</p>
            <p className="text-xs max-w-md mt-1 text-slate-400 leading-relaxed">
              Start voice calling or type any question below. Answers are strictly grounded in the institution's official documents.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-4 max-w-lg">
              {[
                "What courses are offered?",
                "What is the fee structure for MPC?",
                "Do you provide hostel facilities?",
                "What is the admission procedure?",
              ].map((sample) => (
                <button
                  key={sample}
                  onClick={() => handleSendText(sample)}
                  className="text-xs bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 px-3 py-1.5 rounded-xl text-slate-200 hover:text-white transition-all shadow-sm"
                >
                  "{sample}"
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 text-white rounded-br-md shadow-md border border-sky-400/30"
                  : "bg-slate-900/95 border border-slate-800 text-slate-100 rounded-bl-md shadow-lg"
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className={`text-xs font-bold ${m.role === "user" ? "text-sky-100" : "text-sky-400"}`}>
                  {m.role === "user" ? "You" : agentName}
                </span>
                <span className={`text-[10px] ${m.role === "user" ? "text-sky-200" : "text-slate-500"} font-mono`}>
                  {m.timestamp}
                </span>
              </div>

              <div className="whitespace-pre-wrap">{m.content}</div>

              {/* Provenance citations */}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-slate-800 flex flex-wrap gap-1.5">
                  {m.sources.slice(0, 2).map((s, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 text-[11px] bg-slate-950/90 border border-sky-500/30 text-sky-300 px-2.5 py-1 rounded-lg font-medium"
                      title={s.section}
                    >
                      <BookOpen className="w-3 h-3 text-sky-400" />
                      {s.document_name || "Document"}{s.page ? ` · Page ${s.page}` : ""}
                    </span>
                  ))}
                </div>
              )}

              {/* Play synthesized audio button */}
              {m.role === "assistant" && m.audioData && (
                <div className="mt-2.5 pt-1.5 border-t border-slate-800/60 flex justify-end">
                  <button
                    onClick={() => playAudioData(m.audioData!, i)}
                    className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 bg-sky-500/10 border border-sky-500/25 px-2.5 py-1 rounded-lg font-medium transition-all"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>{playingMsgIndex === i ? "Playing voice…" : "Listen (ElevenLabs)"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {partialUser && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm bg-sky-950/80 border border-sky-500/40 text-sky-200 italic rounded-br-md">
              {partialUser}…
            </div>
          </div>
        )}

        {partialAgent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm bg-slate-900 border border-slate-800 text-slate-100 rounded-bl-md">
              {partialAgent}
            </div>
          </div>
        )}

        {isTypingLoading && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-2.5 text-xs bg-slate-900/90 border border-slate-800 text-slate-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
              <span>Mrs. D is retrieving institutional documents…</span>
            </div>
          </div>
        )}
      </div>

      {/* ── First-Class Text Input ── */}
      <div className="mb-4">
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
            className="flex items-center gap-2.5 bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-sm rounded-xl px-7 py-3.5 shadow-xl shadow-sky-500/30 border border-sky-400/40 transition-all cursor-pointer"
          >
            <Mic className="w-4.5 h-4.5" />
            <span>Start Voice Call</span>
          </button>
        ) : (
          <>
            <button
              onClick={toggleMic}
              className={`flex items-center gap-2 font-semibold text-sm rounded-xl px-5 py-3 border transition-colors ${
                wsState === "listening"
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/40 hover:bg-emerald-500/30"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
              }`}
            >
              {wsState === "listening" ? <Mic className="w-4.5 h-4.5" /> : <MicOff className="w-4.5 h-4.5" />}
              <span>{wsState === "listening" ? "Mute Mic" : "Unmute Mic"}</span>
            </button>

            {isSpeaking && (
              <button
                onClick={stopCurrentAudio}
                className="flex items-center gap-2 bg-rose-950/80 hover:bg-rose-900 text-rose-300 font-semibold text-sm rounded-xl px-4 py-3 border border-rose-500/40 transition-colors"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Stop Speaking</span>
              </button>
            )}

            <button
              onClick={restartConversation}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm rounded-xl px-5 py-3 border border-slate-700 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Restart Call</span>
            </button>
          </>
        )}

        <button
          onClick={handlePublish}
          disabled={publishing}
          className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-sm rounded-xl px-6 py-3.5 shadow-xl shadow-emerald-500/30 border border-emerald-400/40 disabled:opacity-60 transition-all"
        >
          {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4.5 h-4.5" />}
          <span>Publish Telecaller</span>
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
