import React, { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Mic, MicOff, RotateCcw, Rocket, Loader2 } from "lucide-react";
import AgentOrb from "../components/AgentOrb";
import RealWaveform from "../components/RealWaveform";
import TextInput from "../components/TextInput";
import { voiceWS } from "../services/voiceWebSocket";
import type { VoiceWSState } from "../services/voiceWebSocket";
import { publishAgent, getAgent } from "../services/api";
import LatencyPanel from "../components/LatencyPanel";
import { useI18n } from "../i18n";
import type { ConversationMessage } from "../types";

const STATE_MAP: Record<VoiceWSState, { label: string; color: string }> = {
  disconnected: { label: "Offline", color: "bg-[var(--gray-100)] text-[var(--gray-600)]" },
  connecting: { label: "Connecting…", color: "bg-amber-50 text-amber-700" },
  connected: { label: "Ready", color: "bg-[var(--sky-50)] text-[var(--sky-700)]" },
  greeting: { label: "Speaking…", color: "bg-violet-50 text-violet-700" },
  listening: { label: "Listening…", color: "bg-emerald-50 text-emerald-700" },
  processing: { label: "Thinking…", color: "bg-amber-50 text-amber-700" },
  speaking: { label: "Speaking…", color: "bg-violet-50 text-violet-700" },
  error: { label: "Error", color: "bg-red-50 text-red-700" },
};

export default function AgentTest() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [wsState, setWsState] = useState<VoiceWSState>("disconnected");
  const [amplitude, setAmplitude] = useState(0);      // REAL mic level
  const [playAmplitude, setPlayAmplitude] = useState(0); // REAL agent audio level
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [partialUser, setPartialUser] = useState("");
  const [partialAgent, setPartialAgent] = useState("");
  const [agentName, setAgentName] = useState("Aadhya");
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState("");
  const [lastLatency, setLastLatency] = useState<number | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(`session_${Date.now()}`);

  // Load agent name
  useEffect(() => {
    if (!agentId) return;
    getAgent(agentId)
      .then((a) => setAgentName(a.agent_name || "Aadhya"))
      .catch(() => setAgentName("Aadhya"));
  }, [agentId]);

  // Connect WS on mount, disconnect on unmount
  useEffect(() => {
    if (!agentId) return;
    connect();
    return () => voiceWS.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Autoscroll transcript
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, partialUser, partialAgent]);

  const connect = useCallback(() => {
    if (!agentId) return;
    voiceWS.connect(agentId, {
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
    setMessages([]);
    connect();
    await voiceWS.startMic();
  };

  const restartConversation = () => {
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

  const handlePublish = async () => {
    if (!agentId) return;
    setPublishing(true);
    try {
      const res = await publishAgent(agentId);
      setToast(res.message);
      setTimeout(() => navigate(`/agent/${agentId}/students`), 1200);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setToast(detail || "Publish failed — upload a knowledge document first");
      setTimeout(() => setToast(""), 4000);
    } finally {
      setPublishing(false);
    }
  };

  const badge = STATE_MAP[wsState] ?? STATE_MAP.disconnected;
  const inConversation = wsState !== "disconnected" && wsState !== "error";

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col" style={{ height: "calc(100vh - 1px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--gray-800)]">{t("test.title")} — {agentName}</h1>
          <p className="text-[13px] text-[var(--gray-500)] mt-0.5">Speak naturally; barge-in interrupts the agent instantly</p>
        </div>
        <span className={`text-[12px] font-semibold px-3 py-1 rounded-full ${badge.color}`}>{badge.label}</span>
      </div>

      {toast && (
        <div className="mb-4 text-sm text-[var(--sky-800)] bg-[var(--sky-50)] border border-[var(--sky-200)] rounded-lg px-4 py-2.5">{toast}</div>
      )}

      {/* Orb */}
      <div className="flex justify-center py-4">
        <AgentOrb state={mapToOrbState(wsState)} amplitude={amplitude} />
      </div>

      {/* REAL waveforms (spec §33 §34 §59): driven by actual audio —
          user's mic while listening, agent's output while speaking.
          No fake animation: silence is flat. */}
      <div className="flex justify-center h-16 mb-2">
        {wsState === "speaking" || wsState === "greeting" ? (
          <RealWaveform source="playback" amplitude={playAmplitude} active={playAmplitude > 0.01} height={64} color="#8b5cf6" />
        ) : (
          <RealWaveform source="mic" amplitude={amplitude} active={wsState === "listening"} height={64} color="#0ea5e9" />
        )}
      </div>
      {/* Two-state label (spec §34) */}
      <div className="text-center text-[11.5px] text-[var(--gray-400)] mb-3">
        {wsState === "speaking" || wsState === "greeting"
          ? `${t("test.aiSpeaking")} — interruption works: just start talking`
          : wsState === "listening" ? `${t("test.userSpeaking")} — live waveform` : t("test.listening")}
      </div>

      {/* Transcript */}
      <div ref={transcriptRef} className="flex-1 overflow-y-auto glass rounded-[var(--radius-md)] p-4 shadow-[var(--shadow-sm)] mb-4 min-h-[180px]">
        {messages.length === 0 && !partialUser && !partialAgent && (
          <div className="h-full flex items-center justify-center text-[13px] text-[var(--gray-400)]">
            Start the conversation and speak — live transcript appears here
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed ${
                m.role === "user"
                  ? "bg-[var(--sky-500)] text-white rounded-br-md"
                  : "bg-white border border-[var(--gray-200)] text-[var(--gray-800)] rounded-bl-md"
              }`}
            >
              <div className={`text-[10.5px] font-semibold mb-0.5 ${m.role === "user" ? "text-sky-100" : "text-[var(--sky-600)]"}`}>
                {m.role === "user" ? "You" : agentName}
              </div>
              {m.content}
            </div>
          </div>
        ))}
        {partialUser && (
          <div className="mb-3 flex justify-end">
            <div className="max-w-[78%] rounded-2xl px-3.5 py-2 text-[13.5px] bg-[var(--sky-100)] text-[var(--sky-800)] italic rounded-br-md">
              {partialUser}…
            </div>
          </div>
        )}
        {partialAgent && (
          <div className="mb-3 flex justify-start">
            <div className="max-w-[78%] rounded-2xl px-3.5 py-2 text-[13.5px] bg-white border border-[var(--gray-200)] text-[var(--gray-800)] rounded-bl-md">
              {partialAgent}
            </div>
          </div>
        )}
      </div>

      {/* Text input fallback */}
      <div className="mb-4">
        <TextInput
          voiceState={mapToOrbState(wsState)}
          onSendText={(text) => voiceWS.sendText(text)}
          onMicStart={() => voiceWS.startMic()}
          onMicStop={() => voiceWS.stopMic()}
          disabled={!inConversation}
        />
      </div>

      {/* Internal latency view — REAL measured per-turn values (spec §60) */}
      {agentId && <LatencyPanel agentId={agentId} />}

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 pb-2">
        {!inConversation ? (
          <button
            onClick={startConversation}
            className="flex items-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white font-semibold text-sm rounded-full px-6 py-3 shadow-[var(--shadow-md)]"
          >
            <Mic className="w-4.5 h-4.5" /> {t("test.start")}
          </button>
        ) : (
          <>
            <button
              onClick={toggleMic}
              className={`flex items-center gap-2 font-semibold text-sm rounded-full px-5 py-3 shadow-[var(--shadow-sm)] border transition-colors ${
                wsState === "listening"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                  : "bg-white text-[var(--gray-600)] border-[var(--gray-200)] hover:bg-[var(--gray-50)]"
              }`}
            >
              {wsState === "listening" ? <Mic className="w-4.5 h-4.5" /> : <MicOff className="w-4.5 h-4.5" />}
              {wsState === "listening" ? t("test.micOn") : t("test.micOff")}
            </button>
            <button
              onClick={restartConversation}
              className="flex items-center gap-2 bg-white text-[var(--gray-600)] border border-[var(--gray-200)] hover:bg-[var(--gray-50)] font-semibold text-sm rounded-full px-5 py-3"
            >
              <RotateCcw className="w-4 h-4" /> {t("test.restart")}
            </button>
          </>
        )}

        <button
          onClick={handlePublish}
          disabled={publishing}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-full px-6 py-3 shadow-[var(--shadow-md)] disabled:opacity-60"
        >
          {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4.5 h-4.5" />}
          {t("test.publish")}
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
