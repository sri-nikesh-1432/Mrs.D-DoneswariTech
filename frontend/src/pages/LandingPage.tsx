import React, { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Upload,
  CheckCircle2,
  Loader2,
  Phone,
  BookOpen,
  Activity,
  BarChart3,
  History,
  Settings,
  Sparkles,
  FileText,
  X,
  Terminal,
  ArrowRight,
  Zap,
} from "lucide-react";
import { uploadKnowledge, getKnowledgeStatus } from "../services/api";
import AICallSimulator from "../components/AICallSimulator";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useTranslation } from "../i18n";

/* ─── Types ─────────────────────────────────── */
type KnowledgeStep =
  | "uploading"
  | "extracting"
  | "cleaning"
  | "chunking"
  | "embedding"
  | "ready"
  | "error";

const KNOWLEDGE_STEPS: KnowledgeStep[] = [
  "uploading",
  "extracting",
  "cleaning",
  "chunking",
  "embedding",
  "ready",
];

/* ─── Component ─────────────────────────────── */
export default function LandingPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [instituteId, setInstituteId] = useState<number | null>(null);
  const [instituteName, setInstituteName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  // Knowledge upload
  const [knowledgeFile, setKnowledgeFile] = useState<File | null>(null);
  const [knowledgeStep, setKnowledgeStep] = useState<KnowledgeStep | null>(null);
  const [knowledgeError, setKnowledgeError] = useState("");

  // Status
  const [knowledgeStatus, setKnowledgeStatus] = useState("not_uploaded");
  const [knowledgeDetails, setKnowledgeDetails] = useState<{
    document_name?: string;
    chunks_count?: number;
    institute_name?: string;
  } | null>(null);
  const [activeCalls, setActiveCalls] = useState(0);

  // Admin/Dev mode for testing console
  const [showCallSimulator, setShowCallSimulator] = useState(false);

  const knowledgeReady = knowledgeStep === "ready";

  /* ─── Knowledge Upload ────────────────────── */
  const handleKnowledgeUpload = useCallback(
    async (file: File) => {
      setKnowledgeError("");
      setKnowledgeFile(file);
      setKnowledgeStep("uploading");

      try {
        const result = await uploadKnowledge(file, instituteId || undefined);
        if (result.institute_id) {
          setInstituteId(result.institute_id);
        }
        setKnowledgeDetails((prev) => ({
          ...prev,
          document_name: file.name,
          institute_name: result.institute_name,
        }));
        setKnowledgeStep("extracting");

        // Poll for status
        let attempts = 0;
        const check = setInterval(async () => {
          attempts++;
          try {
            const status = await getKnowledgeStatus(result.institute_id);

            if (status.status === "processing") {
              setKnowledgeStep("extracting");
            } else if (status.status === "chunking") {
              setKnowledgeStep("chunking");
            } else if (status.status === "embedding") {
              setKnowledgeStep("embedding");
            } else if (status.status === "ready") {
              setKnowledgeStep("ready");
              setKnowledgeStatus("ready");
              setKnowledgeDetails((prev) => ({
                ...prev,
                chunks_count: status.chunks_count,
                document_name: status.document_name || prev?.document_name,
              }));
              clearInterval(check);
            } else if (status.status === "error") {
              setKnowledgeError(status.error_message || "Processing failed");
              setKnowledgeStatus("error");
              setKnowledgeStep("error");
              clearInterval(check);
            }
          } catch (e) {
            console.error("Status check failed:", e);
          }

          if (attempts > 40) {
            setKnowledgeError("Processing timed out");
            setKnowledgeStep("error");
            clearInterval(check);
          }
        }, 1500);
      } catch (e: any) {
        setKnowledgeError(e.message);
        setKnowledgeStep("error");
      }
    },
    [instituteId]
  );

  /* ─── Poll Status ────────────────────────── */
  useEffect(() => {
    if (!instituteId) return;

    const pollStatus = async () => {
      try {
        // Poll institute status
      } catch (e) {
        console.error("Status poll error:", e);
      }
    };

    const interval = setInterval(pollStatus, 5000);
    return () => clearInterval(interval);
  }, [instituteId]);

  return (
    <div className="h-screen bg-[#08080c] text-white overflow-hidden flex flex-col">
      {/* Subtle background gradient — ElevenLabs-style ambient light */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.06)_0%,transparent_70%)]" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[300px] bg-[radial-gradient(ellipse_at_center,rgba(129,140,248,0.04)_0%,transparent_70%)]" />
      </div>

      {/* Header */}
      <header className="relative z-10 shrink-0 h-14 px-6 border-b border-white/[0.04] bg-[#08080c]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-white">
                Mrs.D
              </h1>
              <p className="text-[11px] text-white/30 leading-none">AI Voice Receptionist</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs">
              <div className={`w-1.5 h-1.5 rounded-full ${knowledgeStatus === "ready" ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className="text-white/30">{knowledgeStatus}</span>
            </div>

            <LanguageSwitcher compact />

            <button
              onClick={() => setShowCallSimulator(!showCallSimulator)}
              disabled={!knowledgeReady}
              className="h-8 px-3 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition-all flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed border border-white/[0.04]"
            >
              <Sparkles className="w-3 h-3" />
              {showCallSimulator ? "Close" : t("voiceAgent")}
            </button>

            <button
              onClick={() => navigate("/testing-console")}
              className="h-8 px-3 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition-all flex items-center gap-1.5 border border-white/[0.04]"
            >
              <Terminal className="w-3 h-3" />
              {t("testingConsole")}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 min-h-0 overflow-y-auto w-full max-w-6xl mx-auto px-6 py-8">
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">

          {/* Knowledge Upload Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-1"
          >
            <div className="glass-card-static p-5">
              <div className="flex items-center gap-2.5 mb-5">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">{t("instituteKnowledge")}</h2>
                  <p className="text-[11px] text-white/30">{t("uploadDoc")}</p>
                </div>
              </div>

              {!knowledgeFile ? (
                <div
                  className="drop-zone cursor-pointer"
                  onClick={() => document.getElementById("knowledgeInput")?.click()}
                >
                  <input
                    id="knowledgeInput"
                    type="file"
                    accept=".pdf,.docx,.txt,.csv"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleKnowledgeUpload(e.target.files[0])}
                  />
                  <Upload className="w-6 h-6 mx-auto mb-2 text-white/20" />
                  <p className="text-xs text-white/40 mb-0.5">
                    {t("dragDrop")} <span className="text-indigo-400">{t("browse")}</span>
                  </p>
                  <p className="text-[10px] text-white/20">{t("maxFileSize")}</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between p-2.5 bg-white/[0.03] rounded-xl border border-white/[0.04]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span className="text-xs truncate">{knowledgeFile.name}</span>
                    </div>
                    <button
                      onClick={() => {
                        setKnowledgeFile(null);
                        setKnowledgeStep(null);
                        setKnowledgeError("");
                        setKnowledgeStatus("not_uploaded");
                        setKnowledgeDetails(null);
                      }}
                      className="text-white/20 hover:text-white/50 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {knowledgeStep && (
                    <div className="space-y-1.5">
                      {KNOWLEDGE_STEPS.map((step, i) => {
                        const currentIdx = KNOWLEDGE_STEPS.indexOf(knowledgeStep || "uploading");
                        const stepIdx = KNOWLEDGE_STEPS.indexOf(step);
                        const isDone = stepIdx < currentIdx;
                        const isActive = stepIdx === currentIdx;
                        const isPending = stepIdx > currentIdx;

                        return (
                          <motion.div
                            key={step}
                            initial={{ opacity: 0, x: -4 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.06 }}
                            className="flex items-center gap-2.5"
                            style={{ opacity: isPending ? 0.2 : 1 }}
                          >
                            <div
                              className="w-5 h-5 rounded-full flex items-center justify-center"
                              style={{
                                background: isDone
                                  ? "rgba(74,222,128,0.1)"
                                  : isActive
                                  ? "rgba(129,140,248,0.1)"
                                  : "rgba(255,255,255,0.03)",
                              }}
                            >
                              {isDone ? (
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              ) : isActive ? (
                                <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />
                              ) : (
                                <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                              )}
                            </div>
                            <span
                              className="text-xs"
                              style={{
                                color: isDone
                                  ? "#4ade80"
                                  : isActive
                                  ? "#818cf8"
                                  : "rgba(255,255,255,0.2)",
                                fontWeight: isActive ? 500 : 400,
                              }}
                            >
                              {step.charAt(0).toUpperCase() + step.slice(1)}
                            </span>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}

                  {knowledgeError && (
                    <div className="p-2.5 bg-red-500/5 border border-red-500/10 rounded-xl">
                      <p className="text-xs text-red-400">{knowledgeError}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Knowledge Status Panel */}
            {knowledgeDetails && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="mt-4 glass-card-static p-5"
              >
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Activity className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">{t("knowledgeStatus")}</h2>
                    <p className="text-[11px] text-white/30">Current active knowledge base</p>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2.5 bg-white/[0.03] rounded-xl">
                    <span className="text-white/30">{t("currentInstitute")}</span>
                    <span className="font-medium">{knowledgeDetails.institute_name || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 bg-white/[0.03] rounded-xl">
                    <span className="text-white/30">{t("document")}</span>
                    <span className="font-medium truncate max-w-[55%]">{knowledgeDetails.document_name || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 bg-white/[0.03] rounded-xl">
                    <span className="text-white/30">{t("embeddingStatus")}</span>
                    <span className={`font-medium flex items-center gap-2 ${
                      knowledgeStatus === "ready" ? "text-emerald-400" :
                      knowledgeStatus === "error" ? "text-red-400" : "text-amber-400"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        knowledgeStatus === "ready" ? "bg-emerald-400" :
                        knowledgeStatus === "error" ? "bg-red-400" : "bg-amber-400 animate-pulse"
                      }`} />
                      {knowledgeStatus}
                    </span>
                  </div>
                  {typeof knowledgeDetails.chunks_count === "number" && (
                    <div className="flex items-center justify-between p-2.5 bg-white/[0.03] rounded-xl">
                      <span className="text-white/30">{t("chunksIndexed")}</span>
                      <span className="font-medium text-indigo-400">{knowledgeDetails.chunks_count}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </motion.div>

          {/* Right Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* AI Call Simulator Card */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="glass-card-static p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 flex items-center justify-center border border-indigo-500/10">
                    <Phone className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">{t("aiCallSimulator")}</h2>
                    <p className="text-xs text-white/30">Test voice interactions before deployment</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.04]">
                    <p className="text-[10px] text-white/25 uppercase tracking-wider mb-1">{t("status")}</p>
                    <p className="text-sm font-medium text-indigo-300">
                      {knowledgeReady ? t("readyToCall") : t("uploadFirst")}
                    </p>
                  </div>

                  <button
                    onClick={() => setShowCallSimulator(!showCallSimulator)}
                    disabled={!knowledgeReady}
                    className="btn-glow w-full disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      <Phone className="w-4 h-4" />
                      {showCallSimulator ? t("endCall") : t("startCall")}
                      <ArrowRight className="w-4 h-4 ml-auto" />
                    </span>
                  </button>

                  <p className="text-[11px] text-white/20 text-center">
                    Simulates real phone calls with voice recognition and AI responses
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Quick Actions */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button
                  onClick={() => navigate("/call-history")}
                  className="glass-card-static p-4 hover:bg-white/[0.04] transition-colors text-left group"
                >
                  <History className="w-4 h-4 text-indigo-400/60 mb-2.5 group-hover:text-indigo-400 transition-colors" />
                  <p className="text-xs font-medium">{t("callHistory")}</p>
                  <p className="text-[10px] text-white/25 mt-0.5">{t("viewAllCalls")}</p>
                </button>
                <button
                  onClick={() => navigate("/analytics")}
                  className="glass-card-static p-4 hover:bg-white/[0.04] transition-colors text-left group"
                >
                  <BarChart3 className="w-4 h-4 text-blue-400/60 mb-2.5 group-hover:text-blue-400 transition-colors" />
                  <p className="text-xs font-medium">{t("analytics")}</p>
                  <p className="text-[10px] text-white/25 mt-0.5">{t("viewInsights")}</p>
                </button>
                <button className="glass-card-static p-4 hover:bg-white/[0.04] transition-colors text-left group">
                  <Activity className="w-4 h-4 text-emerald-400/60 mb-2.5 group-hover:text-emerald-400 transition-colors" />
                  <p className="text-xs font-medium">{t("liveCalls")}</p>
                  <p className="text-[10px] text-white/25 mt-0.5">{t("monitorActive")}</p>
                </button>
                <button className="glass-card-static p-4 hover:bg-white/[0.04] transition-colors text-left group">
                  <Settings className="w-4 h-4 text-white/20 mb-2.5 group-hover:text-white/40 transition-colors" />
                  <p className="text-xs font-medium">{t("settings")}</p>
                  <p className="text-[10px] text-white/25 mt-0.5">{t("configure")}</p>
                </button>
              </div>
            </motion.div>
          </div>

          {/* AI Voice Agent */}
          <AnimatePresence>
            {showCallSimulator && (
              <AICallSimulator
                instituteId={instituteId || 1}
                onClose={() => setShowCallSimulator(false)}
              />
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
