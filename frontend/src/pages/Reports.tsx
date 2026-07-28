import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  BarChart3, Download, FileText, PieChart, TrendingUp,
  Users, PhoneCall, Loader2, AlertCircle
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart as RePieChart, Pie, Cell,
  LineChart, Line, Legend
} from "recharts";
import { getCampaignSummary, getExportPdfUrl } from "../services/api";
import type { CampaignStats } from "../types";

interface Props {
  campaignId: number | null;
}

const COLORS = ["#4F46E5", "#06B6D4", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];

export default function Reports({ campaignId }: Props) {
  const navigate = useNavigate();
  const [data, setData] = useState<CampaignStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!campaignId) {
      navigate("/");
      return;
    }
    loadData();
  }, [campaignId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await getCampaignSummary(campaignId!);
      if (res.success) setData(res.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass rounded-2xl p-8 text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-red-400 mb-4">{error}</p>
          <Link to="/dashboard" className="btn-primary inline-flex">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const stats = data?.stats;
  const analytics = data?.analytics;

  // Chart Data
  const sentimentData = analytics?.sentiment_distribution
    ? Object.entries(analytics.sentiment_distribution).map(([name, value]) => ({ name, value }))
    : [];
  const interestData = analytics?.interest_levels
    ? Object.entries(analytics.interest_levels).map(([name, value]) => ({ name, value }))
    : [];
  const courseData = analytics?.course_distribution
    ? Object.entries(analytics.course_distribution).slice(0, 8).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Campaign Reports</h1>
          <p className="text-sm text-dark-400">{stats?.campaign_name} — Analytics & Insights</p>
        </div>
        <div className="flex items-center gap-3">
          {campaignId && (
            <a
              href={getExportPdfUrl(campaignId)}
              className="btn-primary text-sm flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export PDF
            </a>
          )}
          <Link to="/dashboard" className="btn-ghost text-sm">← Dashboard</Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Students", value: stats?.total_students || 0, icon: Users, color: "from-blue-500" },
          { label: "Completed", value: stats?.calls_completed || 0, icon: PhoneCall, color: "from-green-500" },
          { label: "Completion Rate", value: `${analytics?.completion_rate || 0}%`, icon: TrendingUp, color: "from-purple-500" },
          { label: "Interest Rate", value: `${analytics?.interest_rate || 0}%`, icon: FileText, color: "from-cyan-500" },
        ].map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass rounded-xl p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-dark-400">{card.label}</span>
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${card.color} to-purple-600 flex items-center justify-center`}>
                <card.icon className="w-4 h-4 text-white" />
              </div>
            </div>
            <p className="text-2xl font-bold text-white">{card.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Sentiment Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary-400" />
            Sentiment Distribution
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={sentimentData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} />
              <Tooltip
                contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                labelStyle={{ color: "#f1f5f9" }}
              />
              <Bar dataKey="value" fill="#4F46E5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Interest Levels */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass rounded-2xl p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-secondary-400" />
            Interest Levels
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <RePieChart>
              <Pie
                data={interestData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={5}
                dataKey="value"
              >
                {interestData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
              />
              <Legend />
            </RePieChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Course Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass rounded-2xl p-6 md:col-span-2"
        >
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-purple-400" />
            Course Interest Distribution
          </h3>
          {courseData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={courseData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" stroke="#64748b" fontSize={12} />
                <YAxis dataKey="name" type="category" stroke="#64748b" fontSize={12} width={150} />
                <Tooltip
                  contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                />
  
