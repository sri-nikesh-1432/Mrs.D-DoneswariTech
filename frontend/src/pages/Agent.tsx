import React, { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, PhoneOff, PhoneCall, Send, Globe, Sparkles, X, Check,
  Upload, BookOpen, Mic, Users, Shield, Zap, ArrowRight,
  Loader2, TrendingUp, Clock, FileText, AlertCircle, CheckCircle2,
  ChevronRight, Play, Pause, SkipBack, SkipForward, Volume2, TreePine,
  MessageSquare, Settings, Database, Layers, Brain, Sparkles as SparklesIcon,
  Wand2, Target, Award, Compass, MapPin, Building2, Users2, GraduationCap,
  Landmark, ShieldCheck, University, Hotel, Bus, Calendar,
  Circle, CircleDot, ArrowRightLeft, RefreshCw, Edit3, FileCheck,
  Route, Navigation, School, Award as AwardIcon
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
import {
  getInstitute, publishAgent, startTestCall, getTestCallStatus,
  sendTextMessage, getKnowledgeStatus, uploadAgentDocument,
  saveAgentChanges,
} from "../services/api";
import type {
  VoiceState, ConversationMessage, CallerMemory, AgentStatus,
  KnowledgeStatus as KnowledgeStatusType, OnboardPayload,
} from "../types";

type KnowledgeStatus = KnowledgeStatusType;

// ─── Real training pipeline stages (mirror backend ingestion state) ─────────
type TrainingStage =
  | "uploading"
  | "extracting"
  | "cleaning"
  | "chunking"
  | "embedding"
  | "indexing"
  | "profiling"
  | "evaluating"
  | "configuring"
  | "ready"
  | "failed";

interface TrainingProgress {
  stage: TrainingStage;
  label: string;
  detail?: string;
  completed: boolean;
}

const TRAINING_STAGES: { key: TrainingStage; label: string }[] = [
  { key: "uploading",    label: "Uploading document" },
  { key: "extracting",   label: "Extracting document text" },
  { key: "cleaning",     label: "Cleaning & structuring" },
  { key: "chunking",     label: "Creating knowledge chunks" },
  { key: "embedding",    label: "Generating embeddings" },
  { key: "indexing",     label: "Building knowledge index" },
  { key: "profiling",    label: "Creating institution profile" },
  { key: "evaluating",   label: "Knowledge evaluation" },
  { key: "configuring",  label: "Configuring agent" },
  { key: "ready",        label: "Institution trained & ready" },
];

const STAGE_DETAILS: Record<TrainingStage, string> = {
  uploading:    "Uploading your file…",
  extracting:   "Reading pages and preserving tables, fees and dates",
  cleaning:     "Removing headers, footers and noise",
  chunking:     "Splitting into meaning-preserving knowledge chunks",
  embedding:    "Creating multilingual vector embeddings",
  indexing:     "Building the FAISS vector index",
  profiling:    "Compiling the institution profile",
  evaluating:   "Testing retrieval & grounding",
  configuring:  "Applying conversation + objection + lead rules",
  ready:        "Agent is trained and ready to converse",
  failed:       "A stage failed. Review the error below.",
};

// ─── Phase ───────────────────────────────────────────────────────────────────
type Phase =
  | "idle"      // upload card
  | "training"  // real progress (backend-driven)
  | "ready"     // agent ready
  | "error"     // real failure
  | "testing";  // live test console

interface KnowledgeStats {
  chunks: number;
  pages: number;
  institution_name?: string;
  document_name?: string;
  agent_id?: number;
  word_count?: number;
  characters?: number;
  status: KnowledgeStatus;
  progress?: number;
  message?: string;
}

// ─── Status chip ─────────────────────────────────────────────────────────────
interface StatusChipProps {
  status: AgentStatus | TrainingStage | VoiceState | string;
  variant?: "agent" | "training" | "system";
}
function StatusChip({ status, variant = "agent" }: StatusChipProps) {
  const isTraining = variant === "training";
  let label = String(status);
  let color = "text-gray-500";
  let bg = "bg-gray-100 border-gray-200";
  let dot = "bg-gray-400";
  if (isTraining) {
    switch (label) {
      case "ready":
        color = "text-emerald-600"; bg = "bg-emerald-50 border-emerald-200"; dot = "bg-emerald-500";
        break;
      case "failed":
        color = "text-red-600"; bg = "bg-red-50 border-red-200"; dot = "bg-red-500";
        break;
      case "uploading":
      case "extracting":
      case "cleaning":
      case "chunking":
      case "embedding":
      case "indexing":
      case "profiling":
      case "evaluating":
      case "configuring":
        color = "text-sky-600"; bg = "bg-sky-50 border-sky-200"; dot = "bg-sky-500";
        break;
      default:
        color = "text-amber-600"; bg = "bg-amber-50 border-amber-200"; dot = "bg-amber-500";
    }
  } else {
    switch (label) {
      case "ready":
        color = "text-emerald-600"; bg = "bg-emerald-50 border-emerald-200"; dot = "bg-emerald-500";
        break;
      case "published":
        color = "text-violet-600"; bg = "bg-violet-50 border-violet-200"; dot = "bg-violet-500";
        break;
      case "processing":
      case "training":
        color = "text-sky-600"; bg = "bg-sky-50 border-sky-200"; dot = "bg-sky-500";
        break;
      case "draft":
      case "waiting":
      case "failed":
      case "error":
        color = "text-red-500"; bg = "bg-red-50 border-red-200"; dot = "bg-red-400";
        break;
      case "uploaded":
      case "extracting":
      case "chunking":
      case "embedding":
      case "indexing":
      case "configuring":
        color = "text-amber-600"; bg = "bg-amber-50 border-amber-200"; dot = "bg-amber-400";
        break;
      case "idle":
      case "disconnected":
        color = "text-gray-400"; bg = "bg-gray-50 border-gray-200"; dot = "bg-gray-300";
        break;
      case "connecting":
      case "listening":
      case "speaking":
        color = "text-sky-600"; bg = "bg-sky-50 border-sky-200"; dot = "bg-sky-400";
        break;
      case "greeting":
      case "calling":
        color = "text-indigo-600"; bg = "bg-indigo-50 border-indigo-200"; dot = "bg-indigo-400";
        break;
      case "testing":
        color = "text-violet-600"; bg = "bg-violet-50 border-violet-200"; dot = "bg-violet-400";
        break;
      case "ready":
        color = "text-emerald-600"; bg = "bg-emerald-50 border-emerald-200"; dot = "bg-emerald-500";
        break;
      default:
        color = "text-gray-500"; bg = "bg-gray-100 border-gray-200"; dot = "bg-gray-300";
    }
  }

  return (
    <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${bg} ${color}`}>
      <motion.span
        className={`w-1.5 h-1.5 rounded-full bg-current ${dot}`}
        animate={label === "listening" || label === "speaking" || label === "ready" || label === "uploading" || label === "extracting" || label === "chunking" || label === "embedding" || label === "indexing" || label === "profiling" || label === "evaluating" || label === "configuring" ? { scale: [1, 1.4, 1] } : {}}
        transition={{ duration: 0.8, repeat: Infinity }}
      />
      {label}
    </span>
  );
}

// ─── Mini stat ───────────────────────────────────────────────────────────────
function MiniStat({ icon: Icon, value, label, sub }: { icon: React.ComponentType<{ className?: string }>; value: React.ReactNode; label: string; sub?: string }) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1 text-[14px] font-bold text-[var(--gray-800)]">
        <Icon className="w-3 h-3 text-[var(--gray-400)]" /> {value}
      </div>
      <div className="text-[10.5px] text-[var(--gray-500)] mt-0.5 leading-tight">
        {label}
        {sub ? <span className="ml-1">{sub}</span> : null}
      </div>
    </div>
  );
}

// ─── Info card ───────────────────────────────────────────────────────────────
function InfoCard({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      {icon ? <div className="w-7 h-7 rounded-lg bg-[var(--sky-50)] flex items-center justify-center shrink-0">{icon}</div> : <div className="w-7 h-7 rounded-lg bg-sky-50 flex items-center justify-center shrink-0"><Sparkles size={12} className="text-sky-500" /></div>}
      <div>
        <div className="text-[12px] font-semibold text-[var(--gray-700)] mb-0.5">{title}</div>
        <div className="text-[13px] text-[var(--gray-600)] leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

// ─── Loading screen ──────────────────────────────────────────────────────────
function LoadingScreen({ message = "Loading your agent..." }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-screen" style={{ background: "linear-gradient(160deg, #f0f9ff, #e0f2fe)" }}>
      <div className="text-center">
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [1, 0.7, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
        >
          <span className="text-white font-bold text-2xl">D</span>
        </motion.div>
        <p className="text-sm text-gray-500">{message}</p>
        <motion.div
          animate={{ y: [0, 4, 0] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          className="mt-2 text-xs text-gray-400"
        >
          <Loader2 className="w-3 h-3 animate-spin mx-auto" />
        </motion.div>
      </div>
    </div>
  );
}

// ─── Agent landing page ──────────────────────────────────────────────────────
export default function Agent() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();

  // Agent meta
  const [agentName, setAgentName] = useState("");
  const [instituteName, setInstituteName] = useState("");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("ready");
  const [agentKnowledgeStatus, setAgentKnowledgeStatus] = useState<any>("ready");
  const [loading, setLoading] = useState(true);

  // Voice & conversation
  const [wsState, setWsState] = useState<VoiceWSState>("disconnected");
  const [amplitude, setAmplitude] = useState(0);
  const [playAmplitude, setPlayAmplitude] = useState(0);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [partialUser, setPartialUser] = useState("");
  const [partialAgent, setPartialAgent] = useState("");
  const [sessionIdRef] = useState(() => `session_${Date.now()}`);

  // Memory & lead
  const [memory, setMemory] = useState<CallerMemory>({});
  const [interestScore, setInterestScore] = useState<number | undefined>();
  const [conversionScore, setConversionScore] = useState<number | undefined>();
  const [leadIntent, setLeadIntent] = useState<"HOT" | "WARM" | "COLD" | "">("");

  // Training state
  const [trainingPhase, setTrainingPhase] = useState<Phase>("idle");
  const [trainingStage, setTrainingStage] = useState<TrainingStage>("uploading");
  const [trainingProgress, setTrainingProgress] = useState<TrainingProgress | null>(null);
  const [trainingStats, setTrainingStats] = useState<KnowledgeStats | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [trainingError, setTrainingError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Test call modal
  const [showCallModal, setShowCallModal] = useState(false);
  const [callPhone, setCallPhone] = useState("");
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "calling_status" | "called" | "failed">("idle");
  const [callError, setCallError] = useState("");
  const [providerStatus, setProviderStatus] = useState("");
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [publishToast, setPublishToast] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [callTimer, setCallTimer] = useState(0);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timing
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const [retrievalMs, setRetrievalMs] = useState<number | null>(null);

  const visualState: VoiceState = {
    disconnected: "idle", connecting: "connecting", connected: "idle",
    greeting: "greeting", listening: "listening", processing: "thinking",
    speaking: "speaking", error: "error",
  }[wsState as unknown as VoiceWSState] as VoiceState;
  const isMicActive = wsState === "listening";
  const safeWsState: VoiceState = isMicActive ? "listening" : wsState as VoiceState;

  // ── Load agent info ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!agentId) return;
    getInstitute(agentId)
      .then((profile) => {
        setAgentName(profile.agent_name || profile.name || "");
        setInstituteName(profile.name || "");
        setAgentStatus(profile.status === "ready" || profile.status === "published" || profile.status === "draft" || profile.status === "processing" || profile.status === "training" || profile.status === "testing" || profile.status === "paused" ? profile.status as AgentStatus : "ready");
        setAgentKnowledgeStatus(profile.knowledge_status as KnowledgeStatus || "ready");
      })
      .catch(() => {
        setAgentName("");
        setAgentStatus("ready");
      })
      .finally(() => setLoading(false));
  }, [agentId]);

  // ── Connect WebSocket ─────────────────────────────────────────────────────
  const connectWS = useCallback(() => {
    if (!agentId) return;
    voiceWS.connect(agentId, {
      onStateChange: (s) => setWsState(s),
      onAmplitude: (a) => setAmplitude(a),
      onTranscriptPartial: (t) => setPartialUser(t),
      onTranscriptFinal: (t) => {
        setPartialUser("");
        setMessages((prev) => [...prev, { role: "user", content: t, timestamp: now() }]);
      },
      onAgentPartial: (t) => setPartialAgent(t),
      onAgentFinal: (t) => {
        setPartialAgent("");
        setMessages((prev) => [...prev, { role: "assistant", content: t, timestamp: now() }]);
      },
      onPlaybackAmplitude: (a) => setPlayAmplitude(a),
      onMemoryUpdate: (m) => setMemory((prev) => ({ ...prev, ...m })),
      onLeadScoreUpdate: (s) => {
        setInterestScore(s.interest);
        setConversionScore(s.conversion);
        setLeadIntent(s.intent as "HOT" | "WARM" | "COLD" | "");
      },
      onError: (msg) => console.warn("[VoiceWS]", msg),
    });
  }, [agentId]);

  useEffect(() => () => voiceWS.disconnect(), []);

  const handleMicStart = async () => await voiceWS.startMic();
  const handleMicStop = () => voiceWS.stopMic();

  // ── Text message (REST fallback if WS not connected) ─────────────────────
  const handleSendText = async (text: string) => {
    if (!agentId) return;
    setMessages((prev) => [...prev, { role: "user", content: text, timestamp: now() }]);

    if (wsState !== "disconnected" && wsState !== "error") {
      voiceWS.sendText(text);
      return;
    }

    try {
      const res = await sendTextMessage(agentId, text, sessionIdRef);
      setMessages((prev) => [...prev, { role: "assistant", content: res.response, timestamp: now() }]);
      if (res.memory) setMemory((prev) => ({ ...prev, ...res.memory }));
    } catch (err: unknown) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "Couldn't process that message. Please try again.",
        timestamp: now(),
      }]);
    }
  };

  // ── Start Call (orb click) ────────────────────────────────────────────────
  const handleOrbClick = () => {
    if (wsState === "disconnected" || wsState === "error") {
      connectWS();
      void handleMicStart();
    } else if (isMicActive) {
      handleMicStop();
    } else {
      handleMicStart();
    }
  };

  // ── Publish ──────────────────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!agentId) return;
    try {
      await publishAgent(agentId);
      setAgentStatus("published");
      setPublishToast(true);
      setTimeout(() => setPublishToast(false), 4000);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPublishError(typeof detail === "string" ? detail : "Publish failed — upload and process a knowledge document first.");
      setTimeout(() => setPublishError(""), 6000);
    }
  };

  // ── Test call ─────────────────────────────────────────────────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeCallIdRef = useRef<string | null>(null);
  useEffect(() => { activeCallIdRef.current = activeCallId; }, [activeCallId]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); if (callTimerRef.current) clearInterval(callTimerRef.current); }, []);

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
            if (st.call_status !== "completed") setCallError(`Call ended: ${st.call_status}`);
          } else if (["in-progress", "answered"].includes(st.call_status)) {
            setCallStatus("called");
          }
        } catch { /* transient */ }
      }, 2500);
    } catch (err: unknown) {
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
  const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // ── Training pipeline (backend-driven progress) ──────────────────────────
  const handleFile = useCallback((f: File) => {
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx", "txt"].includes(ext ?? "")) {
      setTrainingError("Please upload a PDF, DOCX, or TXT file.");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setTrainingError("File must be under 50 MB.");
      return;
    }
    setTrainingError("");
    setFile(f);
    setTrainingPhase("training");
    setTrainingStage("uploading");
    setTrainingProgress({ stage: "uploading", label: "Uploading document", detail: "Uploading your file…", completed: false });
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const dt = e.dataTransfer;
    if (dt.files && dt.files[0]) handleFile(dt.files[0]);
  }, [handleFile]);

  const uploadPromiseRef = useRef<Promise<any> | null>(null);

  const trainAgent = useCallback(async () => {
    if (!file || !agentId) return;
    setTrainingError("");
    setTrainingPhase("training");
    setTrainingStage("uploading");
    setTrainingProgress({ stage: "uploading", label: "Uploading document", detail: "Uploading your file…", completed: false });
    setTrainingStats({ chunks: 0, pages: 0, status: "processing", progress: 0, message: "Uploading document" });

    try {
      const fd = new FormData();
      fd.append("file", file);
      uploadPromiseRef.current = uploadAgentDocument(agentId, file, (pct) => {
        setTrainingProgress({ stage: "uploading", label: "Uploading document", detail: `Uploading… ${pct}%`, completed: false });
      });

      let attempts = 0;
      const poll = async () => {
        while (attempts < 600) {
          attempts += 1;
          try {
            const status = await getKnowledgeStatus(agentId);
            setAgentKnowledgeStatus(status.status as KnowledgeStatus);
            if (status.status === "error" || status.status === "failed") {
              setTrainingStage("failed");
              setTrainingProgress({ stage: "failed", label: "Training failed", detail: status.message || "A stage failed. Review the error below.", completed: false });
              setTrainingError(status.message || "Training failed at " + status.stage);
              setTrainingStats({ chunks: 0, pages: 0, status: "error", message: status.message });
              return;
            }
            const stage = status.stage as TrainingStage;
            if (STAGE_DETAILS[stage]) {
              setTrainingStage(stage);
              setTrainingProgress({
                stage,
                label: STAGE_DETAILS[stage as TrainingStage].split("•")[0].trim(),
                detail: status.message || STAGE_DETAILS[stage as TrainingStage],
                completed: stage === "ready",
              });
              setTrainingStats({
                chunks: status.chunks ?? 0,
                pages: status.page_count ?? 0,
                status: status.status as KnowledgeStatus,
                progress: status.chunks ? 100 : 0,
                message: status.message,
              });
            }
            if (stage === "ready" && status.chunks) {
              setTrainingStats({ chunks: status.chunks ?? 0, pages: status.page_count ?? 0, status: "ready" as KnowledgeStatus, progress: 100, message: status.message });
              setTrainingStage("ready");
              setTrainingProgress({ stage: "ready", label: "Institution trained & ready", detail: "Your agent is ready to converse", completed: true });
              setTrainingPhase("ready");
              return;
            }
          } catch (e) {
            // transient
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        setTrainingStage("failed");
        setTrainingPhase("error");
        setTrainingError("Training timed out — please try again.");
        setTrainingProgress({ stage: "failed", label: "Training failed", detail: "Training timed out", completed: false });
      };
      void poll();
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? "Training failed";
      setTrainingError(msg);
      setTrainingPhase("error");
      setTrainingStage("failed");
      setTrainingProgress({ stage: "failed", label: "Training failed", detail: msg, completed: false });
      setTrainingStats({ chunks: 0, pages: 0, status: "error", message: msg });
    }
  }, [file, agentId]);

  const resetTraining = useCallback(() => {
    setTrainingPhase("idle");
    setFile(null);
    setTrainingStage("uploading");
    setTrainingProgress(null);
    setTrainingStats(null);
    setTrainingError("");
    setDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── Keyboard shortcut / drop zone ─────────────────────────────────────────
  useEffect(() => {
    const onGlobalDrop = (e: Event) => {
      if ((e as DragEvent).dataTransfer?.files?.[0]) handleFile((e as DragEvent).dataTransfer!.files![0]);
    };
    const onGlobalDragOver = (e: Event) => e.preventDefault();
    window.addEventListener("dragover", onGlobalDragOver);
    window.addEventListener("drop", onGlobalDrop);
    return () => {
      window.removeEventListener("dragover", onGlobalDragOver);
      window.removeEventListener("drop", onGlobalDrop);
    };
  }, [handleFile]);

  if (loading) return <LoadingScreen />;

  // ── Distribution visual ───────────────────────────────────────────────────
  const langItems = [["English", "en"], ["Telugu", "te"], ["Hindi", "hi"], ["Tamil", "ta"], ["Kannada", "kn"], ["Malayalam", "ml"]];
  const voiceItems = [
    { label: "English", voice: "en-IN-NeerjaExpressiveNeural" },
    { label: "Telugu", voice: "te-IN-ShrutiNeural" },
    { label: "Hindi", voice: "hi-IN-SwaraNeural" },
  ];

  return (
    <div className="flex flex-col h-screen" style={{ background: "linear-gradient(160deg, #f0f9ff 0%, #e0f2fe 40%, #f0f9ff 100%)" }}>
      {/* Top bar */}
      <TopBar agentId={agentId} agentName={agentName} status={agentStatus} />

      {/* Main content: 3-column layout */}
      <div className="flex flex-1 min-h-0 gap-0 relative">
        {/* ═══ CENTER: Voice + Conversation ═══ */}
        <main className="flex-1 flex flex-col min-w-0 relative">
          {/* Voice area */}
          <div className="flex flex-col items-center justify-center pt-6 pb-3 gap-4">
            <div className="relative cursor-pointer" onClick={handleOrbClick}>
              <AgentOrb state={visualState as VoiceState} amplitude={amplitude} size={180} />
              {wsState === "disconnected" && (
                <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-xs text-sky-500 font-medium whitespace-nowrap">
                  Click to start voice
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <StatusChip status={wsState === "disconnected" ? "idle" : wsState as VoiceState} variant="agent" />
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/70 border border-sky-100 text-xs text-gray-500">
                <Globe size={11} />
                <span>Auto-detect</span>
              </div>
            </div>

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
            <TextInput
              voiceState={visualState}
              onSendText={handleSendText}
              onMicStart={handleMicStart}
              onMicStop={handleMicStop}
            /> <div className="flex items-center justify-between gap-2">
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => setShowCallModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-sky-200 text-sky-600 hover:bg-sky-50 transition-colors shadow-sm"
              >
                <PhoneCall size={13} /> Test Call
              </motion.button>
              {agentStatus !== "published" ? (
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={handlePublish}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold text-white shadow-md"
                  style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
                >
                  <Sparkles size={12} /> Publish Agent
                </motion.button>
              ) : (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
                </span>
              )}
            </div>
          </div>
        </main>

        {/* ═══ RIGHT: Training ═══ */}
        <aside
          className="hidden xl:flex flex-col"
          style={{ width: 280, borderLeft: "1px solid rgba(186,230,253,0.4)", background: "rgba(240,249,255,0.5)" }}
        >
          <div className="flex-1 p-4 min-h-0 overflow-y-auto">
            <div className="flex items-center gap-2 mb-3">
              <Upload className="w-4 h-4 text-sky-500" />
              <h3 className="font-semibold text-sm text-gray-700">Train Agent</h3>
            </div>

            {trainingPhase === "idle" && (
              <div className="space-y-3">
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-colors ${
                    dragOver ? "border-sky-400 bg-sky-50" : "border-gray-200 hover:border-sky-300 hover:bg-sky-50/50"
                  }`}
                >
                  <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                  {file ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileText className="w-5 h-5 text-sky-500" />
                      <div className="text-left">
                        <div className="text-xs font-medium text-gray-700">{file.name}</div>
                        <div className="text-[11px] text-gray-400">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-6 h-6 mx-auto mb-2 text-gray-300" />
                      <p className="text-sm text-gray-500">Drop institution document here, or browse</p>
                      <p className="text-[11px] text-gray-400">PDF · DOCX · TXT · Max 50 MB</p>
                    </>
                  )}
                </div>
                {trainingError && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{trainingError}</div>
                )}
                <button
                  onClick={trainAgent}
                  disabled={!file}
                  className="w-full flex items-center justify-center gap-2 bg-black hover:bg-gray-800 disabled:bg-gray-300 text-white font-semibold text-sm rounded-xl py-2.5 transition-colors disabled:cursor-not-allowed"
                >
                  <Zap className="w-4 h-4" /> Train Agent
                </button>
                <p className="text-[11px] text-gray-400 text-center">Based on the master specification: real PDF upload → extraction → cleaning → chunking → embeddings → FAISS → profile → evaluation → ready</p>
              </div>
            )}

            {trainingPhase === "training" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="w-4 h-4 text-sky-500 animate-spin" />
                  <h4 className="text-sm font-semibold text-gray-700">Training your agent</h4>
                </div>
                <div className="space-y-2">
                  {TRAINING_STAGES.map((s, i) => {
                    const isDone = trainingProgress?.stage && trainingProgress.stage === s.key && trainingProgress.completed;
                    const isActive = trainingStage === s.key;
                    return (
                      <div key={s.key} className={`flex items-center gap-2.5 transition-opacity ${isDone ? "opacity-100" : "opacity-40"}`}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${isDone ? "bg-emerald-500" : isActive ? "bg-sky-500" : "bg-gray-200"}`}>
                          {isDone ? <CheckCircle2 className="w-3 h-3 text-white" /> : isActive ? <Loader2 className="w-2.5 h-2.5 text-white animate-spin" /> : <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />}
                        </div>
                        <span className={`text-xs font-medium ${isDone ? "text-emerald-700" : isActive ? "text-sky-600" : "text-gray-400"}`}>{s.label}</span>
                      </div>
                    );
                  })}
                </div>
                {trainingProgress && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1">
                      <span>{stageLabel(trainingProgress.stage)}</span>
                      <span>{(trainingStats?.progress ?? 0).toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-sky-400 to-emerald-400 rounded-full"
                        animate={{ width: `${(trainingStats?.progress ?? 0).toFixed(0)}%` }}
                      />
                    </div>
                    {trainingProgress.detail && (
                      <p className="text-[11px] text-gray-400 mt-1.5">{trainingProgress.detail}</p>
                    )}
                  </div>
                )}
                {trainingStats && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="bg-white rounded-xl border border-gray-100 p-2 text-center">
                      <div className="text-lg font-bold text-gray-700">{trainingStats.chunks?.toLocaleString()}</div>
                      <div className="text-[10px] text-gray-400">Knowledge chunks</div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-100 p-2 text-center">
                      <div className="text-lg font-bold text-gray-700">{trainingStats.pages ?? 0}</div>
                      <div className="text-[10px] text-gray-400">Pages</div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-100 p-2 text-center">
                      <div className="text-lg font-bold text-gray-700">{trainingStats.word_count ?? 0}</div>
                      <div className="text-[10px] text-gray-400">Words</div>
                    </div>
                  </div>
                )}
                {trainingError && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{trainingError}</div>
                )}
                {trainingProgress?.stage === "failed" && (
                  <button
                    onClick={resetTraining}
                    className="text-xs text-sky-600 hover:text-sky-700 underline underline-offset-2"
                  >
                    Retry training
                  </button>
                )}
              </div>
            )}

            {trainingPhase === "ready" && trainingStats && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" />
                  <h4 className="text-sm font-semibold text-gray-700">Agent is ready</h4>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <InfoCard title="Knowledge chunks" icon={<Layers className="w-3.5 h-3.5 text-sky-500" />}>
                    <div className="text-lg font-bold text-gray-800">{trainingStats.chunks?.toLocaleString()}</div>
                    <div className="text-[11px] text-gray-400">Knowledge chunks indexed</div>
                  </InfoCard>
                  <InfoCard title="Pages" icon={<FileText className="w-3.5 h-3.5 text-sky-500" />}>
                    <div className="text-lg font-bold text-gray-800">{trainingStats.pages ?? 0}</div>
                    <div className="text-[11px] text-gray-400">Document pages</div>
                  </InfoCard>
                  {trainingStats.word_count && (
                    <InfoCard title="Words extracted" icon={<Text className="w-3.5 h-3.5 text-sky-500" />}>
                      <div className="text-lg font-bold text-gray-800">{trainingStats.word_count.toLocaleString()}</div>
                      <div className="text-[11px] text-gray-400">Extracted from document</div>
                    </InfoCard>
                  )}
                  <InfoCard title="Status" icon={<Zap className="w-3.5 h-3.5 text-sky-500" />}>
                    <div className="text-lg font-bold text-emerald-600">Ready</div>
                    <div className="text-[11px] text-gray-400">Training complete</div>
                  </InfoCard>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { resetTraining(); navigate(`/agent/${agentId}/overview`); }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-black hover:bg-gray-800 text-white"
                  >
                    <Route className="w-4 h-4" /> Train another
                  </button>
                  <button
                    onClick={() => navigate(`/agent/${agentId}/overview`)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200"
                  >
                    <ArrowRight className="w-4 h-4" /> Go to agent
                  </button>
                </div>
              </div>
            )}

            {trainingPhase === "error" && (
              <div className="text-center space-y-2">
                <AlertCircle className="w-6 h-6 text-red-500 mx-auto" />
                <p className="text-sm text-red-600 font-medium">Training failed</p>
                <p className="text-xs text-gray-400">{trainingError}</p>
                <button
                  onClick={resetTraining}
                  className="text-xs text-sky-600 hover:text-sky-700 underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            )}

            {/* Voice configuration */}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <h5 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Voice configuration</h5>
              <div className="space-y-2">
                {voiceItems.map((v) => (
                  <label key={v.voice} className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-sky-50/50 cursor-pointer">
                    <Circle className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    <div className="text-xs text-gray-700">{v.label}</div>
                    <Radio className="w-3 h-3 text-sky-500 shrink-0" />
                  </label>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-gray-400">
                <Globe className="w-3 h-3 inline mr-1" /> Multi-language: English · Telugu · Hindi
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Listening popup */}
      <ListeningPopup visible={isMicActive} state={visualState} amplitude={amplitude} partialText={partialUser} />

      {/* Test call modal + publish toast (placeholders — leave as-is) */}
      <AnimatePresence>
        {showCallModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) handleEndCall(); }}>
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="w-80 rounded-3xl p-6 shadow-2xl" style={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(186,230,253,0.6)" }}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold text-gray-800 text-base">Test Call</h3>
                <button onClick={handleEndCall} className="text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>
              {callStatus === "idle" && (
                <>
                  <p className="text-xs text-gray-500 mb-3">Enter a phone number. The agent will call and conduct a real conversation.</p>
                  <input type="tel" placeholder="+91 98765 43210" value={callPhone} onChange={(e) => setCallPhone(e.target.value)} className="w-full h-11 px-4 rounded-xl border border-sky-200 text-sm text-gray-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 mb-4" />
                  <motion.button whileTap={{ scale: 0.97 }} onClick={handleTestCall} disabled={!callPhone.trim()} className="w-full h-11 rounded-xl text-white font-semibold text-sm disabled:opacity-40" style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}>
                    <Phone size={14} className="inline mr-2" /> Call Now
                  </motion.button>
                </>
              )}
              {callStatus === "calling" && <div className="text-center py-4"><div className="w-14 h-14 rounded-full mx-auto mb-3" style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}><Phone className="w-6 h-6 text-white mx-auto" /></div><p className="text-sm font-semibold text-gray-700">Calling {callPhone}...</p></div>}
              {callStatus === "calling_status" && <div className="text-center py-4"><div className="w-14 h-14 rounded-full mx-auto mb-3 bg-sky-100"><Phone className="w-6 h-6 text-sky-500 mx-auto" /></div><p className="text-sm font-semibold text-gray-700">{providerStatus || "Ringing"}…</p></div>}
              {callStatus === "called" && <div className="text-center py-2"><div className="w-14 h-14 rounded-full mx-auto mb-3 bg-emerald-100"><Phone className="w-6 h-6 text-emerald-500 mx-auto" /></div><p className="text-sm font-bold text-gray-800 mb-1">Call answered</p><p className="text-2xl font-mono font-bold text-sky-600 mb-4">{fmtTimer(callTimer)}</p><motion.button whileTap={{ scale: 0.97 }} onClick={handleEndCall} className="w-full h-11 rounded-xl text-white font-semibold text-sm bg-red-500 hover:bg-red-600 flex items-center justify-center gap-2"><PhoneOff size={14} /> End Call</motion.button></div>}
              {callStatus === "failed" && <div className="text-center py-4"><div className="w-14 h-14 rounded-full mx-auto mb-3 bg-red-100"><X size={22} className="text-red-500 mx-auto" /></div><p className="text-sm font-bold text-gray-800 mb-1">Call failed</p><p className="text-xs text-red-600 mt-1 px-2">{callError}</p><button onClick={() => { setCallStatus("idle"); setCallError(""); }} className="mt-4 w-full h-11 rounded-xl text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200">Try again</button></div>}
            </motion.div>
          </motion.div>
        )}
        {publishToast && <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200"><Check size={16} className="text-emerald-500" /> Agent published and is now live!</motion.div>}
        {publishError && <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold text-red-700 bg-red-50 border border-red-200"><X size={16} className="text-red-500" /> {publishError}</motion.div>}
      </AnimatePresence>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function stageLabel(stage: TrainingStage): string {
  return STAGE_DETAILS[stage] || stage;
}

// ─── Icons used but not imported ───────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Radio = (props: React.SVGProps<SVGCircleElement>) => <circle cx="10" cy="10" r="6" {...props} />;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Text = (props: React.SVGProps<SVGTextElement>) => <text x="10" y="14" fontSize="10" {...props} />;
