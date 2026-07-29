import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  BarChart3, Users, PhoneCall, CheckCircle2, XCircle,
  TrendingUp, Clock, AlertTriangle, Play, Pause, StopCircle,
  Activity as ActivityIcon, Loader2
} from "lucide-react";
import {
  getCampaignStatus, getStudents, startCampaign,
  pauseCampaign, resumeCampaign, cancelCampaign, getCampaign
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
    wsService.connect({
      onActivity: (activity) => {
        setActivities((prev) => [activity, ...prev].slice(0, 50));
      },
      onStudentCalling: (student) => {
        setStudents((prev) =>
          prev.map((s) => (s.id === student.id ? { ...s, status: student.status || "calling" as const } : s))
        );
      },
      onStatusChange: (status) => {
        setWsConnected(status === "connected");
      },
    }, campaignId);
    return () => { wsService.disconnect(); };
  }, [campaignId]);

  const loadData = async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const [statusRes, studentsRes] = await Promise.all([
        getCampaignStatus(campaignId),
        getStudents(campaignId),
      ]);
      if (statusRes) setCampaign(statusRes);
      if (studentsRes) setStudents(studentsRes.students);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    if (!campaignId) return;
    try { await startCampaign(campaignId); await loadData(); }
    catch (e: any) { setError(e.message); }
  };

  const handlePause = async () => {
    if (!campaignId) return;
    try { await pauseCampaign(campaignId); await loadData(); }
    catch (e: any) { setError(e.message); }
  };

  const handleResume = async () => {
    if (!campaignId) return;
    try { await resumeCampaign(campaignId); await loadData(); }
    catch (e: any) { setError(e.message); }
  };

  const handleCancel = async () => {
    if (!campaignId) return;
    try { await cancelCampaign(campaignId); await loadData(); }
    catch (e: any) { setError(e.message); }
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
    { label: "Avg Duration", value: String(campaign?.average_duration || 0) + "s", icon: Clock, color: "from-cyan-500 to-cyan-600" },
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Campaign Dashboard</h1>
          <p className="text-sm text-dark-400">{campaign?.campaign_name} - {campaign?.institute_name}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/reports" className="btn-ghost flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Reports
          </Link>
          <div className={"flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs " + (wsConnected ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
            <div className={"w-1.5 h-1.5 rounded-full " + (wsConnected ? "bg-green-400" : "bg-red-400")} />
            {wsConnected ? "Live" : "Disconnected"}
          </div>
          <Link to="/" className="btn-ghost text-sm">&larr; Back</Link>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="glass rounded-2xl p-4 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={"w-2.5 h-2.5 rounded-full " + (
              campaign?.status === "running" ? "bg-green-400 animate-pulse" :
              campaign?.status === "paused" ? "bg-yellow-400" :
              campaign?.status === "completed" ? "bg-blue-400" : "bg-dark-400"
            )} />
            <span className="text-sm font-medium capitalize">{campaign?.status || "pending"}</span>
          </div>
          <div className="w-48 h-2 rounded-full bg-dark-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary-500 to-secondary-500 transition-all duration-500"
              style={{ width: (campaign?.progress || 0) + "%" }}
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
              <div className={"w-8 h-8 rounded-lg bg-gradient-to-br " + stat.color + " flex items-center justify-center"}>
                <stat.icon className="w-4 h-4 text-white" />
              </div>
            </div>
            <p className="text-2xl font-bold text-white">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass rounded-2xl p-4">
          <h2 className="text-lg font-semibold text-white mb-4">Students</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-dark-400 border-b border-white/5">
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-left py-2 px-2">Name</th>
                  <th className="text-left py-2 px-2">Phone</th>
                  <th className="text-left py-2 px-2">Course</th>
                  <th className="text-left py-2 px-2">Interest</th>
                  <th className="text-left py-2 px-2">Duration</th>
                </tr>
              </thead>
              <tbody>
                {students.slice(0, 20).map((student) => (
                  <tr key={student.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-2 px-2">
                      <span className={"px-2 py-0.5 rounded-full text-xs " + getStatusColor(student.status)}>
                        {student.status}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-white">{student.name}</td>
                    <td className="py-2 px-2 text-dark-300">{student.phone}</td>
                    <td className="py-2 px-2 text-dark-300">{student.preferred_course || "-"}</td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 h-1.5 rounded-full bg-dark-700 overflow-hidden">
                          <div
                            className={"h-full rounded-full " + (
                              student.interest_score >= 70 ? "bg-green-400" :
                              student.interest_score >= 40 ? "bg-yellow-400" : "bg-red-400"
                            )}
                            style={{ width: student.interest_score + "%" }}
                          />
                        </div>
                        <span className="text-xs text-dark-400">{student.interest_score}%</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-dark-300">{Math.round(student.duration)}s</td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-dark-400">
                      No students imported yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass rounded-2xl p-4 max-h-[500px] overflow-y-auto">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <ActivityIcon className="w-4 h-4 text-primary-400" />
            Activity Feed
          </h2>
          <div className="space-y-3">
            {activities.map((activity, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={"flex items-start gap-2 text-sm " + (
                  activity.type === "success" ? "text-green-400" :
                  activity.type === "error" ? "text-red-400" :
                  activity.type === "warning" ? "text-yellow-400" : "text-dark-300"
                )}
              >
                <div className={"w-1.5 h-1.5 rounded-full mt-1.5 " + (
                  activity.type === "success" ? "bg-green-400" :
                  activity.type === "error" ? "bg-red-400" :
                  activity.type === "warning" ? "bg-yellow-400" : "bg-dark-400"
                )} />
                <div>
                  <p>{activity.message}</p>
                  <p className="text-xs text-dark-500">
                    {new Date(activity.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </motion.div>
            ))}
            {activities.length === 0 && (
              <p className="text-sm text-dark-500 text-center py-8">
                No activity yet. Start the campaign to see live updates.
              </p>
            )}
          </div>
        </div>
      </div>

      {campaign?.status === "running" && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-6 right-6 glass rounded-2xl p-4 w-80 shadow-2xl border-primary-500/20"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm font-medium text-green-400">Call in Progress</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-purple-500 flex items-center justify-center">
              <PhoneCall className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">AI Calling...</p>
              <p className="text-xs text-dark-400">Campaign actively running</p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
