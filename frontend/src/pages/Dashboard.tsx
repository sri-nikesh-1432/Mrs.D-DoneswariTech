import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  BarChart3, Users, PhoneCall, CheckCircle2, XCircle,
  TrendingUp, Clock, AlertTriangle, Play, Pause, StopCircle,
  Activity, Loader2, ChevronRight, RotateCcw
} from "lucide-react";
import {
  getCampaignStatus, getStudents, startCampaign,
  pauseCampaign, resumeCampaign, cancelCampaign
} from "../services/api";
import { wsService } from "../services/websocket";
import type { Campaign, Student, Activity } from "../types";

interface Props {
  campaignId: number | null;
}

export default function Dashboard({ campaignId }: Props) {
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    if (!campaignId) {
      navigate("/");
      return;
    }
    loadData();

    // Connect WebSocket
    wsService.connect({
      onActivity: (activity) => {
        setActivities((prev) => [activity, ...prev].slice(0, 50));
      },
      onStudentCalling: (student) => {
        setStudents((prev) =>
          prev.map((s) => (s.id === student.id ? { ...s, status: "calling" as const } : s))
        );
      },
      onStatusChange: (status) => {
        setWsConnected(status === "connected");
      },
    });

    return () => {
      wsService.disconnect();
    };
  }, [campaignId]);

  const loadData = async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const [statusRes, studentsRes] = await Promise.all([
        getCampaignStatus(campaignId),
        getStudents(campaignId),
      ]);
      if (statusRes.success) setCampaign(statusRes.data);
      if (studentsRes) setStudents(studentsRes.students);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    if (!campaignId) return;
    try {
      await startCampaign(campaignId);
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handlePause = async () => {
    try {
      await pauseCampaign();
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleResume = async () => {
    try {
      await resumeCampaign();
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleCancel = async () => {
    if (!campaignId) return;
    try {
      await cancelCampaign(campaignId);
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
      </div>
    );
  }

  const statCards = [
    { label: "Total Students", value: campaign?.total_students || 0, icon: Users, color: "from-blue-500 to-blue-600" },
    { label: "Completed", value: campaign?.calls_completed || 0, icon: CheckCircle2, color: "from-green-500 to-green-600" },
    { label: "Failed", value: campaign?.calls_failed || 0, icon: XCircle, color: "from-red-500 to-red-600" },
    { label: "Interested", value: campaign?.interested || 0, icon: TrendingUp, color: "from-purple-500 to-purple-600" },
    { label: "Follow-up", value: campaign?.follow_up_required || 0, icon: AlertTriangle, color: "from-orange-500 to-orange-600" },
    { label: "Avg Duration", value: `${campaign?.average_duration || 0}s`, icon: Clock, color: "from-cyan-500 to-cyan-600" },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-green-500/20 text-green-400";
      case "calling": return "bg-blue-500/20 text-blue-400";
      case "failed": return "bg-red-500/20 text-red-400";
      case "retry": return "bg-orange-500/20 text-orange-400";
      default: return "bg-dark-500/20 text-dark-400";
    }
  };

  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Campaign Dashboard</h1>
          <p className="text-sm text-dark-400">{campaign?.campaign_name} — {campaign?.institute_name}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/reports" className="btn-ghost flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Reports
          </Link>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs ${
            wsConnected ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-green-400" : "bg-red-400"}`} />
            {wsConnected ? "Live" : "Disconnected"}
          </div>
          <Link to="/" className="btn-ghost text-sm">← Back</Link>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Campaign Controls */}
      <div className="glass rounded-2xl p-4 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${
              campaign?.status === "running" ? "bg-green-400 animate-pulse" :
              campaign?.status === "paused" ? "bg-yellow-400" :
              campaign?.status === "completed" ? "bg-blue-400" : "bg-dark-400"
            }`} />
            <span className="text-sm font-medium capitalize">{campaign?.status || "pending"}</span>
          </div>
          <div className="w-48 h-2 rounded-full bg-dark-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary-500 to-secondary-500 transition-all duration-500"
              style={{ width: `${campaign?.progress || 0}%` }}
            />
          </div>
          <span className="text-xs text-dark-400">{campaign?.progress || 0}%</span>
        </div>
        <div className="flex items-center gap-2">
          {(campaign?.status === "pending" || campaign?.status === "paused") && (
            <button onClick={handleStart} className="btn-primary text-sm py-2 px-4">
              <Play className="w-4 h-4" /> Start
            </button>
          )}
          {campaign?.status === "running" && (
            <>
              <button onClick={handlePause} className="btn-ghost border border-white/10 text-sm">
                <Pause className="w-4 h-4" /> Pause
              </button>
              <button onClick={handleCancel} className="btn-ghost border border-red-500/20 text-red-400 text-sm">
                <StopCircle className="w-4 h-4" /> Cancel
              </button>
            </>
          )}
          {campaign?.status === "paused" && (
            <button onClick={handleResume} className="btn-primary text-sm py-2 px-4">
              <Play className="w-4 h-4" /> Resume
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {statCards.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass rounded-xl p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-dark-400">{stat.label}</span>
              <div 
