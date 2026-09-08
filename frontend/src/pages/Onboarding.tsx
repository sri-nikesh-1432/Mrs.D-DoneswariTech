import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { onboard } from "../services/api";
import { useNavigate } from "react-router-dom";

const STEPS = [
  { key: "reading", label: "Reading your document..." },
  { key: "understanding", label: "Understanding your information..." },
  { key: "organizing", label: "Organizing knowledge..." },
  { key: "building", label: "Building your AI agent..." },
  { key: "preparing", label: "Preparing voice conversations..." },
  { key: "ready", label: "Your AI agent is ready." },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [agentName, setAgentName] = useState("Mrs.D");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [agentCreated, setAgentCreated] = useState(false);
  const [trainingStep, setTrainingStep] = useState(0);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trainingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const kickoff = () => {
    setError("");
    setTrainingStep(0);
    setAgentCreated(false);
    if (trainingRef.current) clearInterval(trainingRef.current);
    trainingRef.current = setInterval(() => {
      setTrainingStep((s) => {
        if (s >= STEPS.length - 1) {
          if (trainingRef.current) clearInterval(trainingRef.current);
          return s;
        }
        return s + 1;
      });
    }, 1100);
  };

  const handleCreate = async () => {
    if (!name.trim() || !phone.trim() || !agentName.trim() || !file) {
      setError("Please fill in all fields and upload a PDF.");
      return;
    }
    setUploading(true);
    try {
      // 1. Create institute + 2. upload/process PDF in one shot.
      const result = await onboard(
        {
          name: name.trim(),
          phone_number: phone.trim(),
          language: "en",
          voice: "en-IN-NeerjaNeural",
        },
        file
      );
      setUploading(false);
      kickoff();
      // After training animation completes, route to the Agent page with the
      // real institute_id so the WS connects to the correct tenant.
      setAgentCreated(true);
      // Store the route target so "Open Mrs.D" navigates with the real id.
      sessionStorage.setItem("mrsd_onboarding_institute_id", result.institute_id);
    } catch (e: any) {
      setUploading(false);
      setError(e?.message || "Something went wrong. Try again.");
    }
  };

  const fileName = file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)` : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 via-white to-neutral-100 px-6 py-10 flex flex-col items-center justify-center">
      <div className="w-full max-w-xl">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center shadow-md">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-2xl font-display text-neutral-900 tracking-tight">Mrs.D</span>
        </div>
        <p className="text-sm text-neutral-600 font-medium mb-8">AI Voice Receptionist</p>

        <AnimatePresence mode="wait">
          {!agentCreated ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="glass-card p-8 space-y-6"
            >
              <div>
                <h1 className="text-3xl font-display text-neutral-900">Create your AI calling agent</h1>
                <p className="text-sm text-neutral-600 mt-2">Train your AI agent with your own business knowledge and let it handle calls like a real counsellor.</p>
              </div>

              {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-200">{error}</div>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium text-neutral-800 mb-1.5 block">Your Name</label>
                  <input
                    className="glass-input"
                    placeholder="e.g. Mr. Sharma"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium text-neutral-800 mb-1.5 block">Phone Number</label>
                  <input
                    className="glass-input"
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium text-neutral-800 mb-1.5 block">Agent Name</label>
                  <div className="flex items-center gap-2">
                    <input
                      className="glass-input"
                      placeholder="e.g. Mrs.D"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                    />
                    <span className="text-xs text-neutral-500">It's permanently associated with your account.</span>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium text-neutral-800 mb-1.5 block">Knowledge Base</label>
                  <div
                    className={`drop-zone ${dragging ? "border-neutral-500 bg-neutral-50" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      const f = e.dataTransfer.files[0];
                      if (f && f.type === "application/pdf") setFile(f);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f && f.type === "application/pdf") setFile(f);
                      }}
                    />
                    {fileName ? (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-neutral-800 truncate max-w-full">{fileName}</p>
                        <button
                          type="button"
                          className="text-xs text-neutral-500 hover:text-neutral-700 underline"
                          onClick={(e) => { e.stopPropagation(); setFile(null); }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm text-neutral-600">Upload your institution or business information</p>
                        <p className="text-xs text-neutral-400 mt-1 font-medium">PDF</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button
                className="btn-glow w-full text-base"
                onClick={handleCreate}
                disabled={uploading}
              >
                {uploading ? "Creating agent…" : "Create My AI Agent"}
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="training"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="glass-card p-10 text-center"
            >
              <div className="w-20 h-20 rounded-full bg-neutral-100 mx-auto mb-5 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full border-2 border-neutral-400 border-t-transparent animate-spin" />
              </div>
              <h2 className="text-2xl font-display text-neutral-900">{STEPS[trainingStep].label}</h2>
              <div className="mt-6 space-y-2">
                {STEPS.map((s, i) => (
                  <div
                    key={s.key}
                    className={`step-item flex items-center gap-2 text-sm ${i === trainingStep ? "text-neutral-800 font-medium" : "text-neutral-400"}`}
                  >
                    <div className={`w-5 h-5 rounded-full flex-shrink-0 ${i === trainingStep ? "bg-neutral-500" : "bg-neutral-100"}`} />
                    {s.label}
                  </div>
                ))}
              </div>
              {trainingStep === STEPS.length - 1 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6"
                >
                  <button
                    className="btn-glow px-8 py-3"
                    onClick={() => {
                      const id = sessionStorage.getItem("mrsd_onboarding_institute_id") || "1";
                      setAgentCreated(false);
                      setTrainingStep(0);
                      sessionStorage.removeItem("mrsd_onboarding_institute_id");
                      navigate(`/agent/${id}`);
                    }}
                  >
                    Open Mrs.D
                  </button>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
