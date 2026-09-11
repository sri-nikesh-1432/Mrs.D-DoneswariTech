import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, Check, ChevronRight, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { onboard } from "../services/api";

// ─── Training steps (user-friendly labels only) ─────────────────
const TRAINING_STEPS = [
  { key: "reading",     label: "Reading your document..."      },
  { key: "understanding", label: "Understanding your information..." },
  { key: "organizing", label: "Organizing knowledge..."        },
  { key: "building",   label: "Building your AI agent..."      },
  { key: "preparing",  label: "Preparing voice conversations..." },
  { key: "ready",      label: "Your AI agent is ready! 🎉"     },
];

export default function Onboarding() {
  const navigate = useNavigate();

  // ─── Form state ────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [agentName, setAgentName] = useState("Mrs.D");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  // ─── Process state ─────────────────────────────────────────────
  const [phase, setPhase] = useState<"form" | "uploading" | "training" | "done">("form");
  const [uploadPct, setUploadPct] = useState(0);
  const [trainStep, setTrainStep] = useState(0);
  const [error, setError] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const trainTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── File handling ─────────────────────────────────────────────
  const handleFile = (f: File) => {
    if (f.type !== "application/pdf") { setError("Please upload a PDF file."); return; }
    if (f.size > 20 * 1024 * 1024) { setError("File must be under 20 MB."); return; }
    setFile(f);
    setError("");
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);

  // ─── Submit ────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!name.trim())       { setError("Please enter your name."); return; }
    if (!phone.trim())      { setError("Please enter your phone number."); return; }
    if (!agentName.trim())  { setError("Please enter an agent name."); return; }
    if (!file)              { setError("Please upload a PDF knowledge base."); return; }

    setError("");
    setPhase("uploading");
    setUploadPct(0);

    try {
      const result = await onboard(
        { name: name.trim(), phone_number: phone.trim(), agent_name: agentName.trim(), language: "en" },
        file,
        (pct) => setUploadPct(pct)
      );

      // Store agent id for navigation
      const id = String(result.id ?? result.agent_name ?? "1");
      setAgentId(id);

      // Transition to animated training steps
      setPhase("training");
      setTrainStep(0);
      let step = 0;
      trainTimerRef.current = setInterval(() => {
        step += 1;
        setTrainStep(step);
        if (step >= TRAINING_STEPS.length - 1) {
          clearInterval(trainTimerRef.current!);
          setPhase("done");
        }
      }, 1200);
    } catch (err: unknown) {
      setPhase("form");
      const msg = (err as { response?: { data?: { detail?: string } }; message?: string })
        ?.response?.data?.detail ?? (err as { message?: string })?.message ?? "Something went wrong.";
      setError(msg);
    }
  };

  const goToAgent = () => {
    navigate(`/agent/${agentId ?? "1"}`);
  };

  // ─── Render helpers ────────────────────────────────────────────
  const isTraining = phase === "training" || phase === "uploading";
  const isDone = phase === "done";

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: "linear-gradient(160deg, #f0f9ff 0%, #e0f2fe 50%, #f0f9ff 100%)" }}
    >
      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #7dd3fc, transparent)" }} />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #38bdf8, transparent)" }} />
        <div className="absolute top-1/3 right-1/4 w-64 h-64 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, #0ea5e9, transparent)" }} />
      </div>

      <AnimatePresence mode="wait">
        {/* ── FORM ─────────────────────────────────────────────────── */}
        {phase === "form" && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            className="w-full max-w-md mx-4"
          >
            {/* Header */}
            <div className="text-center mb-8">
              {/* Logo */}
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-md"
                style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}>
                <span className="text-white font-bold text-2xl">M</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-800 mb-1">Create your AI Calling Agent</h1>
              <p className="text-sm text-gray-500 max-w-xs mx-auto">
                Train your AI agent with your business knowledge and let it handle calls like a real counsellor.
              </p>
            </div>

            {/* Card */}
            <div
              className="rounded-3xl p-6 shadow-lg"
              style={{
                background: "rgba(255,255,255,0.85)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(186,230,253,0.6)",
              }}
            >
              <div className="space-y-4">
                {/* Name */}
                <InputField
                  label="Your Name"
                  type="text"
                  placeholder="e.g. Priya Sharma"
                  value={name}
                  onChange={setName}
                />

                {/* Phone */}
                <InputField
                  label="Phone Number"
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={setPhone}
                />

                {/* Agent Name */}
                <InputField
                  label="Agent Name"
                  type="text"
                  placeholder="e.g. Mrs.D"
                  value={agentName}
                  onChange={setAgentName}
                  hint="This will be your AI agent's identity"
                />

                {/* PDF Upload */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                    Knowledge Base (PDF)
                  </label>
                  <div
                    onClick={() => !file && fileInputRef.current?.click()}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    className={`
                      relative rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer
                      ${dragging ? "border-sky-400 bg-sky-50" : file ? "border-sky-300 bg-sky-50/50" : "border-sky-200 hover:border-sky-300 hover:bg-sky-50/50"}
                    `}
                    style={{ minHeight: 120 }}
                  >
                    {file ? (
                      <div className="p-4 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                          <FileText size={18} className="text-sky-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-700 truncate">{file.name}</p>
                          <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)} KB</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setFile(null); }}
                          className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-8 gap-2 select-none">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${dragging ? "bg-sky-200" : "bg-sky-100"}`}>
                          <Upload size={18} className="text-sky-500" />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium text-gray-600">
                            {dragging ? "Drop it here!" : "Drag & drop or click to upload"}
                          </p>
                          <p className="text-xs text-gray-400">PDF only · Max 20 MB</p>
                        </div>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                    />
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-xs text-red-500 text-center"
                  >
                    {error}
                  </motion.p>
                )}

                {/* Submit */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCreate}
                  className="w-full h-12 rounded-2xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-shadow shadow-md hover:shadow-lg"
                  style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
                >
                  Create My AI Agent
                  <ChevronRight size={16} />
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── UPLOADING ────────────────────────────────────────────── */}
        {phase === "uploading" && (
          <motion.div
            key="uploading"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="text-center px-4"
          >
            <div className="w-20 h-20 rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-lg"
              style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}>
                <Loader2 size={32} className="text-white" />
              </motion.div>
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Uploading your document...</h2>
            <div className="w-64 h-2 bg-sky-100 rounded-full mx-auto overflow-hidden">
              <motion.div
                className="h-full bg-sky-400 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${uploadPct}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">{uploadPct}%</p>
          </motion.div>
        )}

        {/* ── TRAINING ─────────────────────────────────────────────── */}
        {phase === "training" && (
          <motion.div
            key="training"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="text-center px-4 max-w-sm w-full"
          >
            {/* Animated orb */}
            <div className="relative w-28 h-28 mx-auto mb-8">
              {[0, 0.4, 0.8].map((delay) => (
                <motion.div
                  key={delay}
                  className="absolute inset-0 rounded-full"
                  style={{ border: "2px solid rgba(56,189,248,0.4)" }}
                  animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                  transition={{ duration: 2, repeat: Infinity, delay, ease: "easeOut" }}
                />
              ))}
              <div className="absolute inset-0 rounded-full flex items-center justify-center shadow-lg"
                style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}>
                <span className="text-white font-bold text-3xl">M</span>
              </div>
            </div>

            <h2 className="text-xl font-bold text-gray-800 mb-6">Building your AI agent</h2>

            {/* Steps */}
            <div className="space-y-2 text-left">
              {TRAINING_STEPS.map((step, idx) => {
                const done = idx < trainStep;
                const active = idx === trainStep;
                return (
                  <motion.div
                    key={step.key}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: idx <= trainStep ? 1 : 0.3, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
                    style={{ background: active ? "rgba(224,242,254,0.8)" : "transparent" }}
                  >
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs
                      ${done ? "bg-emerald-400" : active ? "bg-sky-400" : "bg-gray-200"}`}>
                      {done
                        ? <Check size={11} className="text-white" />
                        : active
                        ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                            <Loader2 size={11} className="text-white" />
                          </motion.div>
                        : <span className="text-gray-400">·</span>
                      }
                    </div>
                    <span className={`text-sm ${active ? "text-sky-700 font-semibold" : done ? "text-gray-400" : "text-gray-300"}`}>
                      {step.label}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ── DONE ─────────────────────────────────────────────────── */}
        {isDone && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center px-4"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 280, damping: 18 }}
              className="w-24 h-24 rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-xl"
              style={{ background: "linear-gradient(135deg, #34d399, #059669)" }}
            >
              <Check size={40} className="text-white" strokeWidth={3} />
            </motion.div>

            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {agentName} is ready! 🎉
            </h2>
            <p className="text-sm text-gray-500 mb-8 max-w-xs mx-auto">
              Your AI agent has been trained on your knowledge base. Start testing it now.
            </p>

            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              onClick={goToAgent}
              className="px-8 py-3.5 rounded-2xl text-white font-semibold text-sm shadow-lg flex items-center gap-2 mx-auto"
              style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
            >
              Open {agentName}
              <ChevronRight size={16} />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Reusable input field ──────────────────────────────────────────
function InputField({
  label, type, placeholder, value, onChange, hint,
}: {
  label: string; type: string; placeholder: string;
  value: string; onChange: (v: string) => void; hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="
          w-full h-11 px-4 rounded-xl text-sm text-gray-700 placeholder-gray-400 outline-none
          border border-sky-200 bg-white/80 transition-all
          focus:border-sky-400 focus:ring-2 focus:ring-sky-100
        "
      />
      {hint && <p className="text-[10px] text-gray-400 mt-1 ml-1">{hint}</p>}
    </div>
  );
}
