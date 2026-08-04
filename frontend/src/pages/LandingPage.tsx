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
  Code,
  Terminal,
} from "lucide-react";
import { uploadKnowledge, getKnowledgeStatus } from "../services/api";
import AICallSimulator from "../components/AICallSimulator";

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
  const [instituteId, setInstituteId] = useState<number | null>(null);
  const [instituteName, setInstituteName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  
  // Knowledge upload
  const [knowledgeFile, setKnowledgeFile] = useState<File | null>(null);
  const [knowledgeStep, setKnowledgeStep] = useState<KnowledgeStep | null>(null);
  const [knowledgeError, setKnowledgeError] = useState("");
  
  // Status
  const [knowledgeStatus, setKnowledgeStatus] = useState("not_uploaded");
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
              clearInterval(check);
            } else if (status.status === "error") {
              setKnowledgeError(status.error_message || "Processing failed");
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
        // This would call the receptionist API
      } catch (e) {
        console.error("Status poll error:", e);
      }
    };
    
    const interval = setInterval(pollStatus, 5000);
    return () => clearInterval(interval);
  }, [instituteId]);
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white overflow-hidden">
      {/* Background particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
      </div>
      
      {/* Header */}
      <header className="relative z-10 p-8 border-b border-white/5 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                Mrs.D
              </h1>
              <p className="text-sm text-slate-400">AI Voice Receptionist</p>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${knowledgeStatus === "ready" ? "bg-green-400" : "bg-yellow-400"}`} />
              <span className="text-slate-400">Knowledge: {knowledgeStatus}</span>
            </div>
            
            <button
              onClick={() => setShowCallSimulator(!showCallSimulator)}
              disabled={!knowledgeReady}
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs hover:bg-white/10 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              title="AI Voice Agent"
            >
              <Sparkles className="w-3 h-3" />
              {showCallSimulator ? "Close" : "Voice Agent"}
            </button>
            
            <button
              onClick={() => navigate("/testing-console")}
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs hover:bg-white/10 transition-colors flex items-center gap-2"
              title="Testing Console"
            >
              <Terminal className="w-3 h-3" />
              Testing Console
            </button>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="relative z-10 max-w-7xl mx-auto p-8">
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
          
          {/* Knowledge Upload Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="lg:col-span-1"
          >
            <div className="glass-card rounded-3xl p-6 border border-white/10 backdrop-blur-xl bg-white/5">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Institute Knowledge</h2>
                  <p className="text-xs text-slate-400">PDF · DOCX · TXT · CSV</p>
                </div>
              </div>
              
              {!knowledgeFile ? (
                <div
                  className="border-2 border-dashed border-white/10 rounded-2xl p-8 text-center cursor-pointer hover:border-purple-500/50 transition-colors"
                  onClick={() => document.getElementById("knowledgeInput")?.click()}
                >
                  <input
                    id="knowledgeInput"
                    type="file"
                    accept=".pdf,.docx,.txt,.csv"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleKnowledgeUpload(e.target.files[0])}
                  />
                  <Upload className="w-8 h-8 mx-auto mb-3 text-slate-400" />
                  <p className="text-sm text-slate-300 mb-1">
                    Drag & drop or <span className="text-purple-400">browse</span>
                  </p>
                  <p className="text-xs text-slate-500">Max file size: 50 MB</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-purple-400" />
                      <span className="text-sm truncate">{knowledgeFile.name}</span>
                    </div>
                    <button
                      onClick={() => {
                        setKnowledgeFile(null);
                        setKnowledgeStep(null);
                        setKnowledgeError("");
                      }}
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  
                  {knowledgeStep && (
                    <div className="space-y-2">
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
                            style={{ opacity: isPending ? 0.25 : 1 }}
                          >
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center"
                              style={{
                                background: isDone
                                  ? "rgba(74,222,128,0.15)"
                                  : isActive
                                  ? "rgba(139,92,246,0.15)"
                                  : "rgba(255,255,255,0.04)",
                              }}
                            >
                              {isDone ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                              ) : isActive ? (
                                <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin" />
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
                                  ? "#8b5cf6"
                                  : "rgba(255,255,255,0.3)",
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
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                      <p className="text-sm text-red-400">{knowledgeError}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
          
          {/* Status Cards */}
          <div className="lg:col-span-2 space-y-6">
            {/* AI Call Simulator Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <div className="glass-card rounded-3xl p-6 border border-white/10 backdrop-blur-xl bg-gradient-to-br from-purple-500/10 to-blue-500/10">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                    <Phone className="w-5 h-5 text-green-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">AI Call Simulator</h2>
                    <p className="text-xs text-slate-400">Test voice interactions before deployment</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-xl border border-purple-500/20">
                    <p className="text-xs text-slate-400 mb-1">Status</p>
                    <p className="font-medium text-purple-300">
                      {knowledgeReady ? "Ready to Call" : "Upload Knowledge First"}
                    </p>
                  </div>
                  
                  <button
                    onClick={() => setShowCallSimulator(!showCallSimulator)}
                    disabled={!knowledgeReady}
                    className="w-full py-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Phone className="w-4 h-4" />
                    {showCallSimulator ? "End Call" : "Start AI Call"}
                  </button>
                  
                  <p className="text-xs text-slate-500 text-center">
                    Simulates real phone calls with voice recognition and AI responses
                  </p>
                </div>
              </div>
            </motion.div>
            
            {/* Quick Actions */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <button 
                  onClick={() => navigate("/call-history")}
                  className="glass-card rounded-2xl p-4 border border-white/10 backdrop-blur-xl bg-white/5 hover:bg-white/10 transition-colors text-left"
                >
                  <History className="w-5 h-5 text-purple-400 mb-2" />
                  <p className="text-sm font-medium">Call History</p>
                  <p className="text-xs text-slate-400">View all calls</p>
                </button>
                <button 
                  onClick={() => navigate("/analytics")}
                  className="glass-card rounded-2xl p-4 border border-white/10 backdrop-blur-xl bg-white/5 hover:bg-white/10 transition-colors text-left"
                >
                  <BarChart3 className="w-5 h-5 text-blue-400 mb-2" />
                  <p className="text-sm font-medium">Analytics</p>
                  <p className="text-xs text-slate-400">View insights</p>
                </button>
                <button className="glass-card rounded-2xl p-4 border border-white/10 backdrop-blur-xl bg-white/5 hover:bg-white/10 transition-colors text-left">
                  <Activity className="w-5 h-5 text-green-400 mb-2" />
                  <p className="text-sm font-medium">Live Calls</p>
                  <p className="text-xs text-slate-400">Monitor active</p>
                </button>
                <button className="glass-card rounded-2xl p-4 border border-white/10 backdrop-blur-xl bg-white/5 hover:bg-white/10 transition-colors text-left">
                  <Settings className="w-5 h-5 text-slate-400 mb-2" />
                  <p className="text-sm font-medium">Settings</p>
                  <p className="text-xs text-slate-400">Configure</p>
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
