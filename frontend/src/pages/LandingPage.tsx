import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Upload, FileText, Users, Play, CheckCircle2,
  Loader2, AlertCircle
} from "lucide-react";
import {
  uploadKnowledge, uploadStudents, createCampaign, getKnowledgeStatus, startCampaign
} from "../services/api";

interface Props {
  onCampaignCreated: (id: number) => void;
}

export default function LandingPage({ onCampaignCreated }: Props) {
  const navigate = useNavigate();
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [instituteName, setInstituteName] = useState("");
  const [knowledgeStatus, setKnowledgeStatus] = useState<
    "idle" | "uploading" | "processing" | "ready" | "error"
  >("idle");
  const [studentStatus, setStudentStatus] = useState<
    "idle" | "uploading" | "ready" | "error"
  >("idle");
  const [error, setError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [studentMessage, setStudentMessage] = useState("");

  const canStart = knowledgeStatus === "ready" && studentStatus === "ready" && campaignName && instituteName;

  const handleKnowledgeUpload = useCallback(async (file: File) => {
    setError("");
    setKnowledgeMessage("");

    if (!campaignId) {
      try {
        const res = await createCampaign({
          campaign_name: campaignName || "New Campaign",
          institute_name: instituteName || "New Institute",
        });
        if (res.data?.id) {
          setCampaignId(res.data.id);
          onCampaignCreated(res.data.id);
          await uploadKnowledgeWithId(file, res.data.id);
        }
      } catch (e: any) {
        setError(e.message);
        setKnowledgeStatus("error");
      }
    } else {
      await uploadKnowledgeWithId(file, campaignId);
    }
  }, [campaignId, campaignName, instituteName, onCampaignCreated]);

  const uploadKnowledgeWithId = async (file: File, cId: number) => {
    setKnowledgeStatus("uploading");
    try {
      await uploadKnowledge(file, cId);
      setKnowledgeStatus("processing");
      setKnowledgeMessage("Processing document...");
      let attempts = 0;
      const check = setInterval(async () => {
        attempts++;
        try {
          const status = await getKnowledgeStatus();
          if (status.ready) {
            setKnowledgeStatus("ready");
            setKnowledgeMessage("Knowledge base ready!");
            clearInterval(check);
          }
        } catch {}
        if (attempts > 30) {
          setKnowledgeStatus("ready");
          setKnowledgeMessage("Knowledge base ready!");
          clearInterval(check);
        }
      }, 2000);
    } catch (e: any) {
      setKnowledgeStatus("error");
      setKnowledgeMessage(e.message);
    }
  };

  const handleStudentUpload = useCallback(async (file: File) => {
    if (!campaignId) {
      setError("Please upload institute knowledge first");
      return;
    }
    setStudentStatus("uploading");
    setError("");
    try {
      const result = await uploadStudents(file, campaignId);
      setStudentStatus("ready");
      setStudentMessage("Imported " + (result.imported || 0) + " students");
    } catch (e: any) {
      setStudentStatus("error");
      setStudentMessage(e.message);
    }
  }, [campaignId]);

  const handleStartCampaign = async () => {
    if (!campaignId || !canStart) return;
    setIsStarting(true);
    try {
      await startCampaign(campaignId);
      navigate("/dashboard");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-8 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center">
            <span className="text-white font-bold text-sm">D</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Mrs. D</h1>
            <p className="text-xs text-dark-400">AI Admission Campaign Platform</p>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 max-w-5xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary-500 via-purple-500 to-secondary-500 flex items-center justify-center shadow-2xl shadow-primary-500/30"
          >
            <span className="text-3xl font-bold text-white">D</span>
          </motion.div>
          <h1 className="text-4xl md:text-5xl font-display font-bold text-gradient mb-3">
            Mrs. D
          </h1>
          <p className="text-lg text-dark-300 max-w-2xl mx-auto">
            Automate admissions with an intelligent AI counselor that represents your institute,
            engages prospective students, answers questions, and helps generate qualified leads.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass rounded-2xl p-6 mb-8 w-full max-w-2xl"
        >
          <h2 className="text-lg font-semibold text-white mb-4">Campaign Configuration</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-dark-300 mb-1">Campaign Name</label>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="e.g., Summer Admission Drive 2026"
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-dark-500 focus:outline-none focus:border-primary-500/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-dark-300 mb-1">Institute Name</label>
              <input
                type="text"
                value={instituteName}
                onChange={(e) => setInstituteName(e.target.value)}
                placeholder="e.g., ABC Engineering College"
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-dark-500 focus:outline-none focus:border-primary-500/50 transition-colors"
              />
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl mb-8">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="glass rounded-2xl p-6 hover:border-primary-500/20 transition-all"
          >
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-primary-400" />
              <h3 className="font-semibold">Upload Institute Knowledge</h3>
            </div>
            <p className="text-sm text-dark-400 mb-4">
              Upload PDF, DOCX, TXT, or CSV files with institute information
            </p>
            <div
              className="border-2 border-dashed border-white/10 rounded-xl p-6 text-center hover:border-primary-500/30 transition-all cursor-pointer"
              onClick={() => document.getElementById("knowledgeInput")?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleKnowledgeUpload(file);
              }}
            >
              <input
                id="knowledgeInput"
                type="file"
                accept=".pdf,.docx,.txt,.csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleKnowledgeUpload(e.target.files[0])}
              />
              {knowledgeStatus === "idle" && (
                <div>
                  <Upload className="w-8 h-8 text-dark-400 mx-auto mb-2" />
                  <p className="text-sm text-dark-400">Drag and drop or <span className="text-primary-400">browse</span></p>
                  <p className="text-xs text-dark-500 mt-1">PDF, DOCX, TXT, CSV</p>
                </div>
              )}
              {knowledgeStatus === "uploading" && (
                <div>
                  <Loader2 className="w-8 h-8 text-primary-400 mx-auto mb-2 animate-spin" />
                  <p className="text-sm text-dark-300">Uploading...</p>
                </div>
              )}
              {knowledgeStatus === "processing" && (
                <div>
                  <Loader2 className="w-8 h-8 text-secondary-400 mx-auto mb-2 animate-spin" />
                  <p className="text-sm text-dark-300">Processing...</p>
                </div>
              )}
              {knowledgeStatus === "ready" && (
                <div>
                  <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
                  <p className="text-sm text-green-400">{knowledgeMessage || "Ready!"}</p>
                </div>
              )}
              {knowledgeStatus === "error" && (
                <div>
                  <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                  <p className="text-sm text-red-400">{knowledgeMessage || "Upload failed"}</p>
                </div>
              )}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="glass rounded-2xl p-6 hover:border-secondary-500/20 transition-all"
          >
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-secondary-400" />
              <h3 className="font-semibold">Upload Student List</h3>
            </div>
            <p className="text-sm text-dark-400 mb-4">
              Upload Excel or CSV with student details (name, phone required)
            </p>
            <div
              className="border-2 border-dashed border-white/10 rounded-xl p-6 text-center hover:border-secondary-500/30 transition-all cursor-pointer"
              onClick={() => document.getElementById("studentInput")?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleStudentUpload(file);
              }}
            >
              <input
                id="studentInput"
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleStudentUpload(e.target.files[0])}
              />
              {studentStatus === "idle" && (
                <div>
                  <Upload className="w-8 h-8 text-dark-400 mx-auto mb-2" />
                  <p className="text-sm text-dark-400">Drag and drop or <span className="text-secondary-400">browse</span></p>
                  <p className="text-xs text-dark-500 mt-1">Excel, CSV</p>
                </div>
              )}
              {studentStatus === "uploading" && (
                <div>
                  <Loader2 className="w-8 h-8 text-secondary-400 mx-auto mb-2 animate-spin" />
                  <p className="text-sm text-dark-300">Importing...</p>
                </div>
              )}
              {studentStatus === "ready" && (
                <div>
                  <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
                  <p className="text-sm text-green-400">{studentMessage}</p>
                </div>
              )}
              {studentStatus === "error" && (
                <div>
                  <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                  <p className="text-sm text-red-400">{studentMessage}</p>
                </div>
              )}
            </div>
          </motion.div>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4"
          >
            <AlertCircle className="w-4 h-4" />
            {error}
          </motion.div>
        )}

        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          disabled={!canStart || isStarting}
          onClick={handleStartCampaign}
          className="btn-primary text-lg px-10 py-4 flex items-center gap-3"
        >
          {isStarting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Play className="w-5 h-5" />
          )}
          {isStarting ? "Starting..." : "Start Campaign"}
        </motion.button>

        <div className="flex items-center gap-6 mt-6 text-xs text-dark-400">
          <div className="flex items-center gap-1.5">
            <div className={"w-2 h-2 rounded-full " + (
              knowledgeStatus === "ready" ? "bg-green-400" :
              knowledgeStatus === "error" ? "bg-red-400" :
              knowledgeStatus === "idle" ? "bg-dark-500" : "bg-primary-400 animate-pulse"
            )} />
            Knowledge
          </div>
          <div className="flex items-center gap-1.5">
            <div className={"w-2 h-2 rounded-full " + (
              studentStatus === "ready" ? "bg-green-400" :
              studentStatus === "error" ? "bg-red-400" :
              studentStatus === "idle" ? "bg-dark-500" : "bg-secondary-400 animate-pulse"
            )} />
            Students
          </div>
          <div className="flex items-center gap-1.5">
            <div className={"w-2 h-2 rounded-full " + (canStart ? "bg-green-400" : "bg-dark-500")} />
            Ready
          </div>
        </div>
      </main>
    </div>
  );
}
