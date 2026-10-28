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
        setToast(`Voice server: ${msg}`);
        setTimeout(() => setToast(""), 5000);
      },
    });
  }, [agentId]);

  const startConversation = () => {
    connect();
  };

  const toggleMic = () => {
    if (wsState === "listening") {
      voiceWS.stopMic();
    } else {
      voiceWS.startMic();
    }
  };

  const stopCurrentAudio = () => {
    if (activeAudio) {
      activeAudio.pause();
      setActiveAudio(null);
      setPlayingMsgIndex(null);
    }
    voiceWS.stopPlayback();
  };

  const restartConversation = () => {
    stopCurrentAudio();
    voiceWS.disconnect();
    setMessages([]);
    setPartialUser("");
    setPartialAgent("");
    sessionIdRef.current = `session_${Date.now()}`;
    setTimeout(() => connect(), 300);
  };

  // Text chat fallback with Grounded RAG & optional TTS
  const handleSendText = async (text: string) => {
    if (!text.trim() || isTypingLoading) return;

    stopCurrentAudio();
    const userMsg: ConversationMessage = { role: "user", content: text, timestamp: now() };
    setMessages((prev) => [...prev, userMsg]);
    setIsTypingLoading(true);

    try {
      const res = await sendTextMessage(
        agentId || "1",
        text,
        sessionIdRef.current,
        selectedLanguage,
      );

      const assistantMsg: ConversationMessage = {
        role: "assistant",
        content: res.response || res.message || "",
        timestamp: now(),
        sources: res.sources,
        audioData: res.audio_data || undefined,
      };

      setMessages((prev) => [...prev, assistantMsg]);

      if (res.audio_data) {
        playAudioData(res.audio_data, messages.length + 1);
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      const errorMsg: ConversationMessage = {
        role: "assistant",
        content: detail || "Sorry, I could not retrieve information right now. Please check your internet or try again.",
        timestamp: now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
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
    if (!isLiveAgent) {
      setToast("Upload an institutional PDF document and train the agent first before publishing.");
      setTimeout(() => setToast(""), 4000);
      return;
    }
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
      ? { label: "Ready", color: "bg-emerald-100 border border-emerald-300 text-emerald-800" }
      : {
          disconnected: { label: "Voice Idle", color: "bg-stone-100 border border-stone-300 text-stone-600" },
          connecting: { label: "Connecting…", color: "bg-amber-100 border border-amber-300 text-amber-800" },
          connected: { label: "Voice Ready", color: "bg-sky-100 border border-sky-300 text-sky-800" },
          greeting: { label: "Speaking…", color: "bg-sky-100 border border-sky-300 text-sky-800" },
          listening: { label: "Listening…", color: "bg-emerald-100 border border-emerald-300 text-emerald-800" },
          processing: { label: "Thinking…", color: "bg-amber-100 border border-amber-300 text-amber-800" },
          speaking: { label: "Speaking…", color: "bg-sky-100 border border-sky-300 text-sky-800" },
          error: { label: "Voice Error", color: "bg-red-100 border border-red-300 text-red-800" },
        }[wsState] ?? { label: "Voice Idle", color: "bg-stone-100 border border-stone-300 text-stone-600" };

  const inConversation = wsState !== "disconnected" && wsState !== "error";
  const isSpeaking = wsState === "speaking" || wsState === "greeting" || activeAudio !== null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col text-stone-900" style={{ minHeight: "calc(100vh - 20px)" }}>
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-4 border-b border-[#E8E2D5]">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-black text-stone-900 tracking-tight">
              {agentName}
            </h1>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-sky-100 border border-sky-300 text-sky-800 font-mono">
              Mrs. D Telecalle<span id="telecaller-r-anchor" className="telecaller-r-target relative inline-block text-sky-600">r</span>
            </span>
            <span className={`text-xs font-bold px-3 py-0.5 rounded-full ${badge.color}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-stone-600 mt-1 font-medium">
            Admissions Telecaller for <strong className="text-stone-900">{companyName}</strong> · Grounded in uploaded institutional PDF documents
          </p>
        </div>

        {/* Language selector & actions */}
        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <div className="flex items-center gap-2 bg-white border border-[#D6CEBE] rounded-xl px-3 py-1.5 text-xs shadow-sm">
            <Globe className="w-3.5 h-3.5 text-sky-600 shrink-0" />
            <select
              value={selectedLanguage}
              onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
              className="bg-transparent text-xs font-bold text-stone-800 outline-none cursor-pointer"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang} value={lang} className="bg-white text-stone-900">
                  {LANGUAGE_NATIVE_NAMES[lang]} ({lang})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleClearConversation}
            className="p-2 rounded-xl text-stone-400 hover:text-red-600 hover:bg-stone-100 border border-transparent hover:border-[#D6CEBE] transition-colors"
            title="Clear Conversation"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {toast && (
        <div className="mb-3 text-xs text-sky-900 bg-sky-50 border border-sky-200 rounded-xl px-4 py-2.5 shadow-sm font-semibold">
          {toast}
        </div>
      )}

      {/* ── Document Training Required Banner ── */}
      {!isLiveAgent && agentStatus !== undefined && (
        <div className="mb-4 p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <div className="font-extrabold text-amber-900">Document Training Required</div>
              <div className="text-amber-800 mt-0.5 font-medium">Mrs. D has not been trained on institutional documents yet. Please upload your institution's brochure or fee PDF first to ground admissions guidance before testing or publishing.</div>
            </div>
          </div>
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs shadow-md transition-all shrink-0 cursor-pointer self-start sm:self-auto"
          >
            Upload Document & Train
          </button>
        </div>
      )}

      {/* ── Voice Assistant Visualization ── */}
      <div className="flex flex-col items-center justify-center py-2 relative">
        <div className="absolute w-64 h-64 rounded-full bg-sky-200/40 blur-3xl pointer-events-none" />
        <AgentOrb state={isSpeaking ? "speaking" : mapToOrbState(wsState)} amplitude={amplitude} />
      </div>

      {/* REAL waveforms */}
      <div className="flex justify-center h-14 mb-1">
        {isSpeaking ? (
          <RealWaveform source="playback" amplitude={playAmplitude || 0.4} active={true} height={56} color="#0284c7" />
        ) : (
          <RealWaveform source="mic" amplitude={amplitude} active={wsState === "listening"} height={56} color="#0ea5e9" />
        )}
      </div>

      {/* Audio Status & Interruption Notice */}
      <div className="text-center text-xs text-stone-600 mb-3 flex items-center justify-center gap-2 font-medium">
        {isSpeaking ? (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-sky-600 animate-ping" />
            <span className="text-sky-800 font-bold">Mrs. D is speaking — barge-in interrupts instantly</span>
            <button
              onClick={stopCurrentAudio}
              className="ml-2 inline-flex items-center gap-1 text-[11px] bg-red-100 text-red-700 border border-red-300 px-2 py-0.5 rounded-md hover:bg-red-200 font-bold"
            >
              <Square className="w-3 h-3 fill-current" /> Stop Speaking
            </button>
          </>
        ) : wsState === "listening" ? (
          <span className="text-emerald-700 font-bold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
            Listening to your question…
          </span>
        ) : (
          <span className="text-stone-500">Ask questions about admissions, courses, fees, or eligibility via voice or text below</span>
        )}
      </div>

      {/* ── Conversation Workspace / Transcript ── */}
      <div
        ref={transcriptRef}
        className="flex-1 overflow-y-auto bg-white/95 rounded-3xl p-5 mb-4 min-h-[220px] border border-[#E2D9C8] shadow-xl space-y-3 backdrop-blur-xl"
      >
        {messages.length === 0 && !partialUser && !partialAgent && !isTypingLoading && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-stone-500">
            <div className="w-12 h-12 rounded-2xl bg-sky-100 border border-sky-300 flex items-center justify-center text-sky-700 mb-3 shadow-sm">
              <Headphones className="w-6 h-6" />
            </div>
            <p className="text-base font-extrabold text-stone-900">Welcome to Admissions Support</p>
            <p className="text-xs max-w-md mt-1 text-stone-600 leading-relaxed font-medium">
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
                  className="text-xs bg-[#FAF7F2] hover:bg-sky-50 border border-[#D6CEBE] hover:border-sky-300 px-3 py-1.5 rounded-xl text-stone-800 font-bold transition-all shadow-sm"
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
                  ? "bg-gradient-to-r from-sky-600 to-blue-700 text-white rounded-br-md shadow-md"
                  : "bg-[#F8F5EE] border border-[#E2D9C8] text-stone-900 rounded-bl-md shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className={`text-xs font-extrabold ${m.role === "user" ? "text-sky-100" : "text-sky-800"}`}>
                  {m.role === "user" ? "You" : agentName}
                </span>
                <span className={`text-[10px] ${m.role === "user" ? "text-sky-200" : "text-stone-500"} font-mono`}>
                  {m.timestamp}
                </span>
              </div>

              <div className="whitespace-pre-wrap font-medium">{m.content}</div>

              {/* Provenance citations */}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-[#E2D9C8] flex flex-wrap gap-1.5">
                  {m.sources.slice(0, 2).map((s, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 text-[11px] bg-white border border-sky-300 text-sky-800 px-2.5 py-1 rounded-lg font-bold shadow-xs"
                      title={s.section}
                    >
                      <BookOpen className="w-3 h-3 text-sky-600" />
                      {s.document_name || "Document"}{s.page ? ` · Page ${s.page}` : ""}
                    </span>
                  ))}
                </div>
              )}

              {/* Play synthesized audio button */}
              {m.role === "assistant" && m.audioData && (
                <div className="mt-2.5 pt-1.5 border-t border-[#E2D9C8] flex justify-end">
                  <button
                    onClick={() => playAudioData(m.audioData!, i)}
                    className="inline-flex items-center gap-1.5 text-xs text-sky-800 hover:text-sky-900 bg-sky-100 border border-sky-300 px-2.5 py-1 rounded-lg font-bold transition-all shadow-xs"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-sky-600" />
                    <span>{playingMsgIndex === i ? "Speaking…" : "Listen Voice"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {partialUser && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm bg-sky-100 border border-sky-300 text-sky-900 italic rounded-br-md shadow-sm">
              {partialUser}…
            </div>
          </div>
        )}

        {partialAgent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm bg-[#F8F5EE] border border-[#E2D9C8] text-stone-900 rounded-bl-md shadow-sm">
              {partialAgent}
            </div>
          </div>
        )}

        {isTypingLoading && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-2.5 text-xs bg-white border border-[#E2D9C8] text-stone-600 flex items-center gap-2 shadow-sm font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" />
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
            disabled={!isLiveAgent}
            className={`flex items-center gap-2.5 font-extrabold text-sm rounded-xl px-7 py-3.5 shadow-xl transition-all ${
              isLiveAgent
                ? "bg-gradient-to-r from-sky-600 via-sky-700 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white shadow-sky-600/25 border border-sky-400/40 cursor-pointer"
                : "bg-stone-200 text-stone-500 border border-stone-300 cursor-not-allowed opacity-60 shadow-none"
            }`}
          >
            <Mic className="w-4.5 h-4.5" />
            <span>Start Voice Call</span>
          </button>
        ) : (
          <>
            <button
              onClick={toggleMic}
              className={`flex items-center gap-2 font-bold text-sm rounded-xl px-5 py-3 border transition-colors shadow-sm ${
                wsState === "listening"
                  ? "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200"
                  : "bg-white hover:bg-stone-100 text-stone-800 border-[#D6CEBE]"
              }`}
            >
              {wsState === "listening" ? <Mic className="w-4.5 h-4.5" /> : <MicOff className="w-4.5 h-4.5" />}
              <span>{wsState === "listening" ? "Mute Mic" : "Unmute Mic"}</span>
            </button>

            {isSpeaking && (
              <button
                onClick={stopCurrentAudio}
                className="flex items-center gap-2 bg-red-100 hover:bg-red-200 text-red-800 font-bold text-sm rounded-xl px-4 py-3 border border-red-300 transition-colors shadow-sm"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Stop Speaking</span>
              </button>
            )}

            <button
              onClick={restartConversation}
              className="flex items-center gap-2 bg-white hover:bg-stone-100 text-stone-800 font-bold text-sm rounded-xl px-5 py-3 border border-[#D6CEBE] transition-colors shadow-sm"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Restart Call</span>
            </button>
          </>
        )}

        <button
          onClick={handlePublish}
          disabled={publishing || !isLiveAgent}
          className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-extrabold text-sm rounded-xl px-6 py-3.5 shadow-xl shadow-emerald-600/25 border border-emerald-400/40 disabled:opacity-50 disabled:shadow-none transition-all cursor-pointer"
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
