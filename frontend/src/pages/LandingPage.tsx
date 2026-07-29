import React, { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  FileText,
  Users,
  Play,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronRight,
  Sparkles,
  Globe,
  Mic,
  BookOpen,
  Database,
  GraduationCap,
  FileSpreadsheet,
  X,
  ArrowRight,
  Phone,
} from "lucide-react";
import {
  uploadKnowledge,
  uploadStudents,
  createCampaign,
  getKnowledgeStatus,
  startCampaign,
} from "../services/api";

/* ─── Types ─────────────────────────────────── */
interface Props {
  onCampaignCreated: (id: number) => void;
}

type KnowledgeStep =
  | "uploading"
  | "extracting"
  | "cleaning"
  | "chunking"
  | "embedding"
  | "ready";

const KNOWLEDGE_STEPS: KnowledgeStep[] = [
  "uploading",
  "extracting",
  "cleaning",
  "chunking",
  "embedding",
  "ready",
];

const STEP_LABELS: Record<KnowledgeStep, string> = {
  uploading: "Uploading document…",
  extracting: "Extracting text…",
  cleaning: "Cleaning content…",
  chunking: "Chunking into segments…",
  embedding: "Generating embeddings…",
  ready: "Knowledge base ready!",
};

/* ─── Animations ────────────────────────────── */
const fadeUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: [0.175, 0.885, 0.32, 1] },
};

const fadeUpDelayed = (delay: number) => ({
  ...fadeUp,
  transition: { ...fadeUp.transition, delay },
});

const stagger = {
  animate: {
    transition: { staggerChildren: 0.08, delayChildren: 0.2 },
  },
};

/* ─── Main Component ────────────────────────── */
export default function LandingPage({ onCampaignCreated }: Props) {
  const navigate = useNavigate();

  /* Campaign form */
  const [campaignName, setCampaignName] = useState("");
  const [instituteName, setInstituteName] = useState("");
  const [language, setLanguage] = useState("english");
  const [voice, setVoice] = useState("en-IN-NeerjaNeural");

  /* Knowledge */
  const [knowledgeFile, setKnowledgeFile] = useState<File | null>(null);
  const [knowledgeStep, setKnowledgeStep] = useState<KnowledgeStep | null>(null);
  const [knowledgeError, setKnowledgeError] = useState("");

  /* Students */
  const [studentFile, setStudentFile] = useState<File | null>(null);
  const [studentStats, setStudentStats] = useState<{
    total: number;
    duplicates: number;
    invalid: number;
  } | null>(null);
  const [studentUploading, setStudentUploading] = useState(false);
  const [studentError, setStudentError] = useState("");

  /* Campaign */
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const knowledgeReady = knowledgeStep === "ready";
  const studentsReady = studentStats !== null && !studentUploading && !studentError;
  const canStart =
    knowledgeReady && studentsReady && campaignName.trim().length > 0 && instituteName.trim().length > 0;

  /* ── Knowledge Upload ────────────────────── */
  const handleKnowledgeUpload = useCallback(
    async (file: File) => {
      setKnowledgeError("");
      setKnowledgeFile(file);
      setKnowledgeStep("uploading");

      let cid = campaignId;
      if (!cid) {
        try {
          const res = await createCampaign({
            campaign_name: campaignName || "New Campaign",
            institute_name: instituteName || "New Institute",
          });
          if (res.campaign_id) {
            cid = res.campaign_id;
            setCampaignId(cid);
            onCampaignCreated(cid);
          }
        } catch (e: any) {
          setKnowledgeError(e.message);
          setKnowledgeStep(null);
          return;
        }
      }

      try {
        await uploadKnowledge(file, cid!);
      } catch (e: any) {
        setKnowledgeError(e.message);
        setKnowledgeStep(null);
        return;
      }

      /* Animate through processing steps */
      for (const step of ["extracting", "cleaning", "chunking", "embedding"] as KnowledgeStep[]) {
        await new Promise((r) => setTimeout(r, 700));
        setKnowledgeStep(step);
      }

      /* Poll for readiness */
      let attempts = 0;
      const check = setInterval(async () => {
        attempts++;
        try {
          const status = await getKnowledgeStatus(cid!);
          if (status.status === "ready") {
            setKnowledgeStep("ready");
            clearInterval(check);
          }
        } catch {}
        if (attempts > 20) {
          setKnowledgeStep("ready");
          clearInterval(check);
        }
      }, 1500);
    },
    [campaignId, campaignName, instituteName, onCampaignCreated]
  );

  /* ── Student Upload ──────────────────────── */
  const handleStudentUpload = useCallback(
    async (file: File) => {
      if (!campaignId) {
        setStudentError("Upload institute knowledge first.");
        return;
      }
      setStudentError("");
      setStudentFile(file);
      setStudentUploading(true);

      try {
        const result = await uploadStudents(file, campaignId);
        setStudentStats({
          total: result.total_students || result.imported || 0,
          duplicates: result.duplicates_removed || 0,
          invalid: 0,
        });
      } catch (e: any) {
        setStudentError(e.message);
      } finally {
        setStudentUploading(false);
      }
    },
    [campaignId]
  );

  /* ── Start Campaign ──────────────────────── */
  const handleStartCampaign = async () => {
    if (!campaignId || !canStart) return;
    setIsStarting(true);
    try {
      await startCampaign(campaignId);
      navigate("/dashboard");
    } catch (e: any) {
      setKnowledgeError(e.message);
    } finally {
      setIsStarting(false);
    }
  };

  /* ── Render ──────────────────────────────── */

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* ═══ BACKGROUND LAYERS ═══ */}
      <div className="bg-premium">
        <div className="bg-premium-overlay" />
        <div className="bg-premium-gradient" />
      </div>

      {/* Floating orbs */}
      <div className="orb w-[600px] h-[600px] bg-primary-500/6 top-[-10%] left-[-5%] animate-[orbFloat_20s_ease-in-out_infinite]" />
      <div className="orb w-[400px] h-[400px] bg-secondary-500/5 bottom-[-5%] right-[-5%] animate-[orbFloat_25s_ease-in-out_infinite_3s]" />
      <div className="orb w-[300px] h-[300px] bg-purple-500/5 top-[40%] right-[10%] animate-[orbFloat_18s_ease-in-out_infinite_6s]" />

      {/* ═══ CONTENT ═══ */}
      <div className="relative z-10 flex flex-col min-h-screen page-padding" style={{ padding: "48px 64px" }}>
        {/* ── FLOATING HEADER ── */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="glass-nav mx-auto w-full"
          style={{
            maxWidth: 1320,
            height: 72,
            borderRadius: 20,
            padding: "0 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                boxShadow: "0 0 20px rgba(99,102,241,0.3)",
              }}
            >
              <span className="text-white font-bold text-sm">D</span>
            </div>
            <div className="hidden sm:block">
              <span className="text-white font-semibold text-base">Mrs. D</span>
              <span className="text-dark-400 text-xs ml-2 font-medium">
                AI Admission Campaign Platform
              </span>
            </div>
          </div>

          <div className="flex items-center gap-5 nav-right">
            <div className="flex items-center gap-1.5">
              <span className={`status-dot ${knowledgeReady ? "green" : knowledgeStep ? "blue" : "gray"}`} />
              <span className="text-xs font-medium text-dark-300">
                {knowledgeReady ? "Knowledge Ready" : knowledgeStep ? "Processing…" : "Awaiting Knowledge"}
              </span>
            </div>
            <div className="w-px h-5 bg-white/5" />
            <div className="flex items-center gap-1.5">
              <span className={`status-dot ${studentsReady ? "green" : studentUploading ? "blue" : "gray"}`} />
              <span className="text-xs font-medium text-dark-300">
                {studentsReady
                  ? `${studentStats!.total} Students`
                  : studentUploading
                  ? "Importing…"
                  : "No Students"}
              </span>
            </div>
          </div>
        </motion.header>

        {/* ── MAIN SCROLLABLE CONTENT ── */}
        <main
          className="flex-1 mx-auto w-full flex flex-col items-center"
          style={{ maxWidth: 1320 }}
        >
          {/* ═══ HERO SECTION ═══ */}
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            className="flex flex-col items-center justify-center text-center"
            style={{
              minHeight: "calc(30vh + 40px)",
              paddingTop: 48,
              paddingBottom: 40,
            }}
          >
            {/* Glowing Logo */}
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, ease: [0.175, 0.885, 0.32, 1] }}
              className="relative mb-6"
              style={{ width: 110, height: 110 }}
            >
              <div className="logo-glow-ring" />
              <div className="logo-glow-ring" />
              <div className="logo-glow-ring" />
              <div
                className="w-[110px] h-[110px] rounded-full flex items-center justify-center glow-pulse"
                style={{
                  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #22d3ee 100%)",
                  boxShadow: "0 0 40px rgba(99,102,241,0.3), 0 0 80px rgba(99,102,241,0.1)",
                }}
              >
                <span className="text-white font-bold" style={{ fontSize: 44 }}>
                  D
                </span>
              </div>
            </motion.div>

            {/* Title */}
            <motion.h1
              {...fadeUp}
              className="text-glow-white font-bold tracking-tight hero-title"
              style={{ fontSize: 64, lineHeight: 1.1, marginBottom: 12 }}
            >
              Mrs. D
            </motion.h1>

            {/* Subtitle */}
            <motion.p
              {...fadeUpDelayed(0.1)}
              className="font-semibold text-glow-accent hero-subtitle"
              style={{ fontSize: 22, marginBottom: 16, letterSpacing: "-0.01em" }}
            >
              AI Admission Campaign Platform
            </motion.p>

            {/* Description */}
            <motion.p
              {...fadeUpDelayed(0.2)}
              className="text-dark-300 font-normal hero-desc"
              style={{
                fontSize: 16,
                lineHeight: 1.7,
                maxWidth: 700,
              }}
            >
              Automate admissions with an intelligent AI counselor that represents your institute,
              engages prospective students, answers questions, and helps generate qualified leads.
            </motion.p>

            {/* Feature chips */}
            <motion.div
              {...fadeUpDelayed(0.3)}
              className="flex items-center gap-3 mt-6 flex-wrap justify-center"
            >
              {["Multilingual", "RAG Powered", "Live Dashboard", "PDF Reports"].map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.5)",
                  }}
                >
                  <Sparkles className="w-3 h-3 text-primary-400" />
                  {f}
                </span>
              ))}
            </motion.div>
          </motion.section>

          {/* ═══ UPLOAD CARDS SECTION ═══ */}
          <motion.section
            initial="initial"
            animate="animate"
            variants={stagger}
            className="w-full flex justify-center"
            style={{ marginBottom: 32 }}
          >
            <div
              className="upload-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 40,
                maxWidth: 1080,
                width: "100%",
              }}
            >
              {/* ── KNOWLEDGE CARD ── */}
              <motion.div variants={fadeUp} className="upload-card" style={{ width: 520 }}>
                <div className="glass-card" style={{ height: 360, padding: 32, display: "flex", flexDirection: "column" }}>
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{
                        background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))",
                      }}
                    >
                      <BookOpen className="w-5 h-5 text-primary-400" />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold" style={{ fontSize: 17 }}>
                        Institute Knowledge
                      </h3>
                      <p className="text-dark-400 text-xs">PDF · DOCX · TXT · CSV</p>
                    </div>
                  </div>

                  {/* Drop zone or steps */}
                  {!knowledgeFile ? (
                    <div
                      className="drop-zone flex-1 flex flex-col items-center justify-center"
                      onClick={() => document.getElementById("knowledgeInput")?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files[0];
                        if (f) handleKnowledgeUpload(f);
                      }}
                    >
                      <input
                        id="knowledgeInput"
                        type="file"
                        accept=".pdf,.docx,.txt,.csv"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleKnowledgeUpload(e.target.files[0])}
                      />
                      <div
                        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3"
                        style={{ background: "rgba(99,102,241,0.1)" }}
                      >
                        <Upload className="w-7 h-7 text-primary-400" />
                      </div>
                      <p className="text-sm font-medium text-dark-300 mb-1">
                        Drag & drop or <span style={{ color: "#818cf8" }}>browse</span>
                      </p>
                      <p className="text-xs text-dark-500">Maximum file size: 50 MB</p>
                    </div>
                  ) : (
                    /* Processing steps */
                    <div className="flex-1 flex flex-col justify-center gap-2.5">
                      {KNOWLEDGE_STEPS.map((step, i) => {
                        const currentIdx = KNOWLEDGE_STEPS.indexOf(knowledgeStep || "uploading");
                        const stepIdx = KNOWLEDGE_STEPS.indexOf(step);
                        const isDone = stepIdx < currentIdx;
                        const isActive = stepIdx === currentIdx;
                        const isPending = stepIdx > currentIdx;

                        return (
                          <motion.div
                            key={step}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.08 }}
                            className="flex items-center gap-3"
                            style={{
                              opacity: isPending ? 0.25 : 1,
                            }}
                          >
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center"
                              style={{
                                background: isDone
                                  ? "rgba(74,222,128,0.15)"
                                  : isActive
                                  ? "rgba(99,102,241,0.15)"
                                  : "rgba(255,255,255,0.04)",
                              }}
                            >
                              {isDone ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                              ) : isActive ? (
                                <Loader2 className="w-3.5 h-3.5 text-primary-400 animate-spin" />
                              ) : (
                                <div className="w-2 h-2 rounded-full bg-white/20" />
                              )}
                            </div>
                            <span
                              className="text-sm"
                              style={{
                                color: isDone
                                  ? "#4ade80"
                                  : isActive
                                  ? "#818cf8"
                                  : "rgba(255,255,255,0.3)",
                                fontWeight: isActive ? 500 : 400,
                              }}
                            >
                              {STEP_LABELS[step]}
                            </span>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}

                  {/* Error */}
                  {knowledgeError && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-red-400">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {knowledgeError}
                    </div>
                  )}
                </div>
              </motion.div>

              {/* ── STUDENT CARD ── */}
              <motion.div variants={fadeUp} className="upload-card" style={{ width: 520 }}>
                <div className="glass-card" style={{ height: 360, padding: 32, display: "flex", flexDirection: "column" }}>
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{
                        background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(99,102,241,0.2))",
                      }}
                    >
                      <Users className="w-5 h-5 text-secondary-400" />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold" style={{ fontSize: 17 }}>
                        Student List
                      </h3>
                      <p className="text-dark-400 text-xs">Excel · CSV (Name, Phone required)</p>
                    </div>
                  </div>

                  {!studentFile ? (
                    <div
                      className="drop-zone flex-1 flex flex-col items-center justify-center"
                      onClick={() => document.getElementById("studentInput")?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files[0];
                        if (f) handleStudentUpload(f);
                      }}
                    >
                      <input
                        id="studentInput"
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleStudentUpload(e.target.files[0])}
                      />
                      <div
                        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3"
                        style={{ background: "rgba(6,182,212,0.1)" }}
                      >
                        <FileSpreadsheet className="w-7 h-7 text-secondary-400" />
                      </div>
                      <p className="text-sm font-medium text-dark-300 mb-1">
                        Drag & drop or <span style={{ color: "#22d3ee" }}>browse</span>
                      </p>
                      <p className="text-xs text-dark-500">Supported: .xlsx, .xls, .csv</p>
                    </div>
                  ) : studentUploading ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3">
                      <Loader2 className="w-8 h-8 text-secondary-400 animate-spin" />
                      <p className="text-sm text-dark-300">Importing students…</p>
                      <p className="text-xs text-dark-500">Validating phone numbers & removing duplicates</p>
                    </div>
                  ) : studentStats ? (
                    <div className="flex-1 flex flex-col justify-center gap-4">
                      <div className="flex items-center justify-center">
                        <div
                          className="w-20 h-20 rounded-full flex items-center justify-center"
                          style={{ background: "rgba(74,222,128,0.1)" }}
                        >
                          <GraduationCap className="w-8 h-8 text-green-400" />
                        </div>
                      </div>
                      <div className="text-center">
                        <p className="text-3xl font-bold text-white">{studentStats.total}</p>
                        <p className="text-sm text-dark-300">Students Imported</p>
                      </div>
                      <div className="flex items-center justify-center gap-4 text-xs">
                        {studentStats.duplicates > 0 && (
                          <span className="text-orange-400">{studentStats.duplicates} duplicates skipped</span>
                        )}
                        {studentStats.invalid > 0 && (
                          <span className="text-red-400">{studentStats.invalid} invalid numbers</span>
                        )}
                        {studentStats.duplicates === 0 && studentStats.invalid === 0 && (
                          <span className="text-green-400">All records valid ✓</span>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {studentError && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-red-400">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {studentError}
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          </motion.section>

          {/* ═══ CAMPAIGN CARD ═══ */}
          <motion.section
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5, ease: [0.175, 0.885, 0.32, 1] }}
            className="campaign-card"
            style={{ width: 850, maxWidth: "100%", marginBottom: 48 }}
          >
            <div className="glass-card-static" style={{ padding: 32 }}>
              <div className="flex items-center gap-3 mb-6">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, rgba(139,92,246,0.2), rgba(99,102,241,0.2))",
                  }}
                >
                  <Play className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold" style={{ fontSize: 17 }}>
                    Campaign Configuration
                  </h3>
                  <p className="text-dark-400 text-xs">Configure your admission campaign details</p>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                  marginBottom: 20,
                }}
              >
                <div>
                  <label className="block text-xs font-medium text-dark-300 mb-1.5">Campaign Name</label>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="e.g., Summer Admission Drive 2026"
                    className="glass-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-dark-300 mb-1.5">Institute Name</label>
                  <input
                    type="text"
                    value={instituteName}
                    onChange={(e) => setInstituteName(e.target.value)}
                    placeholder="e.g., ABC Engineering College"
                    className="glass-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-dark-300 mb-1.5">
                    <Globe className="w-3 h-3 inline mr-1" />
                    Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="glass-select"
                  >
                    <option value="english">English</option>
                    <option value="hindi">हिंदी (Hindi)</option>
                    <option value="telugu">తెలుగు (Telugu)</option>
                    <option value="tamil">தமிழ் (Tamil)</option>
                    <option value="bengali">বাংলা (Bengali)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-dark-300 mb-1.5">
                    <Mic className="w-3 h-3 inline mr-1" />
                    Voice
                  </label>
                  <select
                    value={voice}
                    onChange={(e) => setVoice(e.target.value)}
                    className="glass-select"
                  >
                    <option value="en-IN-NeerjaNeural">Neerja (Indian Female)</option>
                    <option value="en-US-JennyNeural">Jenny (US Female)</option>
                    <option value="en-GB-SoniaNeural">Sonia (UK Female)</option>
                    <option value="hi-IN-SwaraNeural">Swara (Hindi Female)</option>
                  </select>
                </div>
              </div>

              {/* Readiness indicators */}
              <div className="flex items-center gap-4 mb-5 flex-wrap" style={{ fontSize: 12 }}>
                <div className="flex items-center gap-1.5">
                  <span className={`status-dot ${knowledgeReady ? "green" : "gray"}`} />
                  <span className="text-dark-400">
                    {knowledgeReady ? "Knowledge Ready" : "Knowledge Required"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`status-dot ${studentsReady ? "green" : "gray"}`} />
                  <span className="text-dark-400">
                    {studentsReady ? `${studentStats!.total} Students` : "Students Required"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`status-dot ${campaignName && instituteName ? "green" : "gray"}`} />
                  <span className="text-dark-400">
                    {campaignName && instituteName ? "Configured" : "Fill Details"}
                  </span>
                </div>
              </div>

              {/* Start button */}
              <div className="flex justify-center">
                <button
                  onClick={handleStartCampaign}
                  disabled={!canStart || isStarting}
                  className="btn-glow"
                  style={{ width: 350, height: 60, fontSize: 18 }}
                >
                  {isStarting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Starting…
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5" />
                      Start Campaign
                    </>
                  )}
                </button>
              </div>

              {!canStart && !isStarting && (
                <p className="text-center text-xs text-dark-500 mt-3">
                  {!knowledgeReady && "Upload institute knowledge and wait for it to be ready. "}
                  {!studentsReady && "Upload student list. "}
                  {!campaignName && "Enter campaign name. "}
                  {!instituteName && "Enter institute name. "}
                  {canStart && "Ready to launch!"}
                </p>
              )}
            </div>
          </motion.section>
        </main>

        {/* ═══ FOOTER ═══ */}
        <footer
          className="mx-auto w-full text-center py-6"
          style={{ maxWidth: 1320 }}
        >
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => navigate("/single-call")}
              className="text-xs text-dark-400 hover:text-white transition-colors flex items-center gap-2"
            >
              <Phone className="w-4 h-4" />
              Single Student Call
            </button>
            <span className="text-dark-600">|</span>
            <p className="text-xs text-dark-500">
              Powered by AI · Mrs. D — AI Admission Campaign Platform
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
