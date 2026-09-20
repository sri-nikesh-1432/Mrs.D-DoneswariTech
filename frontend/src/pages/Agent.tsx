import React, { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, PhoneOff, PhoneCall, Send, Globe, Sparkles, X, Check
} from "lucide-react";

import AgentOrb from "../components/AgentOrb";
import RealWaveform from "../components/RealWaveform";
import ListeningPopup from "../components/ListeningPopup";
import MemoryPanel from "../components/MemoryPanel";
import ConversationView from "../components/ConversationView";
import TextInput from "../components/TextInput";
import TopBar from "../components/TopBar";

import { voiceWS } from "../services/voiceWebSocket";
import type { VoiceWSState } from "../services/voiceWebSocket";
import { getInstitute, publishAgent, startTestCall, getTestCallStatus, sendTextMessage } from "../services/api";
import type { VoiceState, ConversationMessage, CallerMemory, AgentStatus } from "../types";

// ─── Map WS state → visual state ─────────────────────────────────
const STATE_MAP: Record<VoiceWSState, VoiceState> = {
  disconnected: "idle",
  connecting:   "connecting",
  connected:    "idle",
  greeting:     "greeting",
  listening:    "listening",
  processing:   "thinking",
  speaking:     "speaking",
  error:        "error",
};

export default function Agent() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();

  // ─── Agent meta ─────────────────────────────────────────────────
  const [agentName, setAgentName] = useState("");
  const [instituteName, setInstituteName] = useState("");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("ready");
  const [loading, setLoading] = useState(true);

  // ─── Voice & conversation state ─────────────────────────────────
  const [wsState, setWsState] = useState<VoiceWSState>("disconnected");
  const [amplitude, setAmplitude] = useState(0);        // REAL mic level
  const [playAmplitude, setPlayAmplitude] = useState(0); // REAL agent audio level
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [partialUser, setPartialUser] = useState("");
  const [partialAgent, setPartialAgent] = useState("");

  // ─── Memory & lead ──────────────────────────────────────────────
  const [memory, setMemory] = useState<CallerMemory>({});
  const [interestScore, setInterestScore] = useState<number | undefined>();
  const [conversionScore, setConversionScore] = useState<number | undefined>();
  const [leadIntent, setLeadIntent] = useState<"HOT" | "WARM" | "COLD" | "">("");

  // ─── Session ID for REST chat fallback ──────────────────────────
  const sessionIdRef = useRef(`session_${Date.now()}`);

  // ─── Test call modal ────────────────────────────────────────────
  const [showCallModal, setShowCallModal] = useState(false);
  const [callPhone, setCallPhone] = useState("");
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "calling_status" | "called" | "failed">("idle");
  const [callError, setCallError] = useState("");
  const [providerStatus, setProviderStatus] = useState<string>("");
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  // ─── Publish toast ──────────────────────────────────────────────
  const [publishToast, setPublishToast] = useState(false);
  const [publishError, setPublishError] = useState("");

  // ─── Timer for call duration (real elapsed seconds once answered) ──
  const [callTimer, setCallTimer] = useState(0);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const visualState: VoiceState = STATE_MAP[wsState] ?? "idle";
  const isMicActive = wsState === "listening";
  const isInCall = wsState === "connected" || wsState === "greeting" || wsState === "speaking" || wsState === "processing" || wsState === "listening";

  // ─── Load agent info ────────────────────────────────────────────
  useEffect(() => {
    if (!agentId) return;
    getInstitute(agentId)
      .then((profile) => {
        setAgentName(profile.agent_name || profile.name || "");
        setInstituteName(profile.name || "");
        setAgentStatus(profile.status || "ready");
      })
      .catch(() => {
        setAgentName("");
        setAgentStatus("ready");
      })
      .finally(() => setLoading(false));
  }, [agentId]);

  // ─── Connect WebSocket ──────────────────────────────────────────
  const connectWS = useCallback(() => {
    if (!agentId) return;
    voiceWS.connect(agentId, {
      onStateChange:       (s) => setWsState(s),
      onAmplitude:         (a) => setAmplitude(a),
      onTranscriptPartial: (t) => setPartialUser(t),
      onTranscriptFinal:   (t) => {
        setPartialUser("");
        setMessages((prev) => [
          ...prev,
          { role: "user", content: t, timestamp: now() },
        ]);
      },
      onAgentPartial:      (t) => setPartialAgent(t),
      onAgentFinal:        (t) => {
        setPartialAgent("");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: t, timestamp: now() },
        ]);
      },
      onPlaybackAmplitude: (a) => setPlayAmplitude(a),
      onMemoryUpdate:      (m) => setMemory((prev) => ({ ...prev, ...m })),
      onLeadScoreUpdate:   (s) => {
        setInterestScore(s.interest);
        setConversionScore(s.conversion);
        setLeadIntent(s.intent as "HOT" | "WARM" | "COLD" | "");
      },
      onError:             (msg) => console.warn("[VoiceWS]", msg),
    });
  }, [agentId]);

  // IMPORTANT: We do NOT connect on mount. Connecting on mount made the page
  // greet the moment it loaded while the mic was still off — the agent talked
  // but never listened until a second click. The socket is opened by the first
  // orb click together with the mic. Cleanup still tears down on unmount.
  useEffect(() => {
    return () => voiceWS.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Mic handlers ───────────────────────────────────────────────
  const handleMicStart = async () => {
    await voiceWS.startMic();
  };

  const handleMicStop = () => {
    voiceWS.stopMic();
  };

  // ─── Text message (REST fallback if WS not connected) ────────────
  const handleSendText = async (text: string) => {
    if (!agentId) return;

    setMessages((prev) => [...prev, { role: "user", content: text, timestamp: now() }]);

    if (wsState !== "disconnected" && wsState !== "error") {
      voiceWS.sendText(text);
      return;
    }

    // REST fallback
    try {
      const res = await sendTextMessage(agentId, text, sessionIdRef.current);
      setMessages((prev) => [...prev, { role: "assistant", content: res.response, timestamp: now() }]);
      if (res.memory) setMemory((prev) => ({ ...prev, ...res.memory }));
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I encountered an error. Please try again.", timestamp: now() },
      ]);
    }
  };

  // ─── Start Call (orb click) ──────────────────────────────────────
  // The FIRST click both connects the voice socket AND starts the mic in the
  // SAME user gesture. Previously the first click only connected (so the
  // agent greeted while the mic stayed off) and a second click was needed to
  // listen — users saw the agent "speaking but not hearing" them.
  const handleOrbClick = () => {
    if (wsState === "disconnected" || wsState === "error") {
      connectWS();
      void handleMicStart(); // waits for the socket to open internally
    } else if (isMicActive) {
      handleMicStop();
    } else {
      handleMicStart();
    }
  };

  // ─── Publish ────────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!agentId) return;
    try {
      await publishAgent(agentId);
      setAgentStatus("published");
      setPublishToast(true);
      setTimeout(() => setPublishToast(false), 3000);
    } catch (err: unknown) {
      // REAL error only — never fake a published status (spec §14).
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPublishError(typeof detail === "string" ? detail : "Publish failed — upload and process a knowledge document first.");
      setTimeout(() => setPublishError(""), 5000);
    }
  };

  // ─── Test call ──────────────────────────────────────────────────
  // REAL telephony: the call is placed through the provider and its status
  // is polled from REAL call events. No simulated "Connected" state — if
  // the call fails, the modal shows the actual error (spec §14 §34).
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeCallIdRef = useRef<string | null>(null);
  useEffect(() => { activeCallIdRef.current = activeCallId; }, [activeCallId]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Duration timer runs only while the call is REALly in progress.
  useEffect(() => {
    if (callStatus === "called") {
      setCallTimer(0);
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      callTimerRef.current = setInterval(() => setCallTimer((t) => t + 1), 1000);
    }
  }, [callStatus]);

  const handleTestCall = async () => {
    if (!callPhone.trim() || !agentId) return;
    setCallError("");
    setCallStatus("calling");
    try {
      const res = await startTestCall(agentId, callPhone.trim());
      setActiveCallId(res.call_id);
      setCallStatus("calling_status");
      // Poll REAL provider events for the true call status.
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        if (!activeCallIdRef.current) return;
        try {
          const st = await getTestCallStatus(agentId, activeCallIdRef.current);
          setProviderStatus(st.provider_status || st.call_status);
          if (["completed", "failed", "no-answer", "busy", "canceled"].includes(st.call_status)) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setCallStatus(st.call_status === "completed" ? "called" : "failed");
            if (st.call_status !== "completed") {
              setCallError(`Call ended: ${st.call_status}`);
            }
          } else if (["in-progress", "answered"].includes(st.call_status)) {
            setCallStatus("called");
          }
        } catch { /* transient — keep polling */ }
      }, 2500);
    } catch (err: unknown) {
      // Show the REAL error — never simulate a successful call.
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setCallError(typeof detail === "string" ? detail : "Call failed — telephony may not be configured (set TWILIO_* env vars).");
      setCallStatus("failed");
    }
  };

  const handleEndCall = () => {
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setCallStatus("idle");
    setCallTimer(0);
    setCallError("");
    setProviderStatus("");
    setActiveCallId(null);
    setShowCallModal(false);
    setCallPhone("");
  };

  const fmtTimer = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  if (loading) return <LoadingScreen />;

  return (
    <div className="flex flex-col h-screen" style={{ background: "linear-gradient(160deg, #f0f9ff 0%, #e0f2fe 40%, #f0f9ff 100%)" }}>
      {/* Top bar */}
      <TopBar agentId={agentId} agentName={agentName} status={agentStatus} />

      {/* Main content: 3-column layout */}
      <div className="flex flex-1 min-h-0 gap-0 relative">

        {/* ── CENTER: Voice + Conversation ─────────────────────────── */}
        <main className="flex-1 flex flex-col min-w-0 relative">

          {/* Voice area */}
          <div className="flex flex-col items-center justify-center pt-6 pb-3 gap-4">
            {/* Orb – clickable */}
            <div className="relative cursor-pointer" onClick={handleOrbClick}>
              <AgentOrb state={visualState} amplitude={amplitude} size={180} />
              {/* Tooltip hint */}
              {wsState === "disconnected" && (
                <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-xs text-sky-500 font-medium whitespace-nowrap">
                  Click to start voice
                </div>
              )}
            </div>

            {/* Status row */}
            <div className="flex items-center gap-3">
              <StatusChip state={wsState} />

              {/* Language indicator */}
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/70 border border-sky-100 text-xs text-gray-500">
                <Globe size={11} />
                <span>Auto-detect</span>
              </div>
            </div>

            {/* REAL waveform strip — actual audio energy, flat when silent */}
            <div className="w-full max-w-sm px-4">
              {wsState === "speaking" || wsState === "greeting" ? (
                <RealWaveform source="playback" amplitude={playAmplitude} active={playAmplitude > 0.01} height={36} barCount={32} color="#8b5cf6" />
              ) : (
                <RealWaveform source="mic" amplitude={amplitude} active={wsState === "listening"} height={36} barCount={32} color="#0ea5e9" />
              )}
            </div>
          </div>

          {/* Conversation view */}
          <div className="flex-1 min-h-0 mx-4 rounded-2xl overflow-hidden" style={{
            background: "rgba(255,255,255,0.55)",
            border: "1px solid rgba(186,230,253,0.4)",
            backdropFilter: "blur(12px)",
          }}>
            <ConversationView
              messages={messages}
              agentName={agentName}
              partialAgent={partialAgent}
              partialUser={partialUser}
            />
          </div>

          {/* Bottom controls */}
          <div className="px-4 py-3 space-y-2">
            {/* Text input */}
            <TextInput
              voiceState={visualState}
              onSendText={handleSendText}
              onMicStart={handleMicStart}
              onMicStop={handleMicStop}
            />

            {/* Action buttons row */}
            <div className="flex items-center justify-between gap-2">
              {/* Test Call button */}
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowCallModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-sky-200 text-sky-600 hover:bg-sky-50 transition-colors shadow-sm"
              >
                <PhoneCall size={13} />
                Test Call
              </motion.button>

              {/* Publish / Live badge */}
              {agentStatus !== "published" ? (
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handlePublish}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold text-white shadow-md"
                  style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
                >
                  <Sparkles size={12} />
                  Publish Agent
                </motion.button>
              ) : (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              )}
            </div>
          </div>
        </main>

        {/* ── RIGHT: Memory panel ───────────────────────────────────── */}
        <aside
          className="hidden lg:flex flex-col"
          style={{ width: 240, borderLeft: "1px solid rgba(186,230,253,0.4)", background: "rgba(240,249,255,0.5)" }}
        >
          <div className="flex-1 p-3 min-h-0">
            <MemoryPanel
              memory={memory}
              interestScore={interestScore}
              conversionLikelihood={conversionScore}
              leadIntent={leadIntent}
            />
          </div>
        </aside>
      </div>

      {/* Listening popup */}
      <ListeningPopup
        visible={isMicActive}
        state={visualState}
        amplitude={amplitude}
        partialText={partialUser}
      />

      {/* ── Test Call Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showCallModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) handleEndCall(); }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-80 rounded-3xl p-6 shadow-2xl"
              style={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(186,230,253,0.6)" }}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold text-gray-800 text-base">Test Call</h3>
                <button onClick={handleEndCall} className="text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>

              {callStatus === "idle" && (
                <>
                  <p className="text-xs text-gray-500 mb-3">
                    Enter a phone number. {agentName} will call and conduct a real conversation.
                  </p>
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={callPhone}
                    onChange={(e) => setCallPhone(e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-sky-200 text-sm text-gray-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 mb-4"
                  />
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleTestCall}
                    disabled={!callPhone.trim()}
                    className="w-full h-11 rounded-xl text-white font-semibold text-sm disabled:opacity-40"
                    style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
                  >
                    <Phone size={14} className="inline mr-2" />
                    Call Now
                  </motion.button>
                </>
              )}

              {callStatus === "calling" && (
                <div className="text-center py-4">
                  <motion.div
                    animate={{ scale: [1, 1.15, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
                  >
                    <Phone size={22} className="text-white" />
                  </motion.div>
                  <p className="text-sm font-semibold text-gray-700">Calling {callPhone}...</p>
                  <p className="text-xs text-gray-400 mt-1">Connecting to {agentName}</p>
                </div>
              )}

              {callStatus === "calling_status" && (
                <div className="text-center py-4">
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                    className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center bg-sky-100"
                  >
                    <Phone size={22} className="text-sky-500" />
                  </motion.div>
                  <p className="text-sm font-semibold text-gray-700">{providerStatus || "Ringing"}…</p>
                  <p className="text-xs text-gray-400 mt-1">Live provider status — no simulation</p>
                </div>
              )}

              {callStatus === "called" && (
                <div className="text-center py-2">
                  <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center bg-emerald-100">
                    <Phone size={22} className="text-emerald-500" />
                  </div>
                  <p className="text-sm font-bold text-gray-800 mb-1">Call answered</p>
                  <p className="text-2xl font-mono font-bold text-sky-600 mb-4">{fmtTimer(callTimer)}</p>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleEndCall}
                    className="w-full h-11 rounded-xl text-white font-semibold text-sm bg-red-500 hover:bg-red-600 flex items-center justify-center gap-2"
                  >
                    <PhoneOff size={14} />
                    End Call
                  </motion.button>
                </div>
              )}

              {callStatus === "failed" && (
                <div className="text-center py-4">
                  <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center bg-red-100">
                    <X size={22} className="text-red-500" />
                  </div>
                  <p className="text-sm font-bold text-gray-800 mb-1">Call failed</p>
                  <p className="text-xs text-red-600 mt-1 px-2">{callError}</p>
                  <button
                    onClick={() => { setCallStatus("idle"); setCallError(""); }}
                    className="mt-4 w-full h-11 rounded-xl text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200"
                  >
                    Try again
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Publish toast / error */}
      <AnimatePresence>
        {publishToast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200"
          >
            <Check size={16} className="text-emerald-500" />
            Agent published and is now live!
          </motion.div>
        )}
        {publishError && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold text-red-700 bg-red-50 border border-red-200"
          >
            <X size={16} className="text-red-500" />
            {publishError}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Status chip ──────────────────────────────────────────────────
function StatusChip({ state }: { state: VoiceWSState }) {
  const config: Record<VoiceWSState, { label: string; color: string; bg: string }> = {
    disconnected: { label: "Idle",        color: "text-gray-500",   bg: "bg-gray-100 border-gray-200" },
    connecting:   { label: "Connecting",  color: "text-sky-600",    bg: "bg-sky-50 border-sky-200" },
    connected:    { label: "Ready",       color: "text-sky-600",    bg: "bg-sky-50 border-sky-200" },
    greeting:     { label: "Greeting",    color: "text-indigo-600", bg: "bg-indigo-50 border-indigo-200" },
    listening:    { label: "Listening",   color: "text-sky-700",    bg: "bg-sky-100 border-sky-300" },
    processing:   { label: "Thinking",    color: "text-amber-600",  bg: "bg-amber-50 border-amber-200" },
    speaking:     { label: "Speaking",    color: "text-emerald-600",bg: "bg-emerald-50 border-emerald-200" },
    error:        { label: "Error",       color: "text-red-500",    bg: "bg-red-50 border-red-200" },
  };
  const c = config[state];
  return (
    <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${c.bg} ${c.color}`}>
      <motion.span
        className="w-1.5 h-1.5 rounded-full bg-current"
        animate={state === "listening" || state === "speaking" ? { scale: [1, 1.5, 1] } : {}}
        transition={{ duration: 0.8, repeat: Infinity }}
      />
      {c.label}
    </span>
  );
}

// ─── Loading screen ───────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen" style={{ background: "linear-gradient(160deg, #f0f9ff, #e0f2fe)" }}>
      <div className="text-center">
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [1, 0.7, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
        >
          <span className="text-white font-bold text-2xl">M</span>
        </motion.div>
        <p className="text-sm text-gray-500">Loading your agent...</p>
      </div>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────
function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
