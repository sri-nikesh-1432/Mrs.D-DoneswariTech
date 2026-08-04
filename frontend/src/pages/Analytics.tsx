import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Phone,
  Clock,
  TrendingUp,
  BarChart3,
  Activity,
  MessageSquare,
  BookOpen,
  Zap,
  CheckCircle,
  XCircle,
  Calendar,
} from "lucide-react";
import { getAnalytics } from "../services/api";

export default function Analytics() {
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState("7d");
  
  const instituteId = "default"; // This would come from context/state
  
  useEffect(() => {
    loadAnalytics();
  }, [timeRange]);
  
  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const data = await getAnalytics(instituteId);
      setAnalytics(data);
    } catch (e) {
      console.error("Error loading analytics:", e);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-8 flex items-center justify-center">
        <div className="text-slate-400">Loading analytics...</div>
      </div>
    );
  }
  
  const stats = [
    {
      label: "Total Calls",
      value: analytics?.total_calls || 0,
      icon: Phone,
      color: "from-purple-500/20 to-blue-500/20",
      iconColor: "text-purple-400",
    },
    {
      label: "Today's Calls",
      value: analytics?.today_calls || 0,
      icon: Calendar,
      color: "from-green-500/20 to-emerald-500/20",
      iconColor: "text-green-400",
    },
    {
      label: "Completed",
      value: analytics?.completed_calls || 0,
      icon: CheckCircle,
      color: "from-blue-500/20 to-cyan-500/20",
      iconColor: "text-blue-400",
    },
    {
      label: "Missed",
      value: analytics?.missed_calls || 0,
      icon: XCircle,
      color: "from-red-500/20 to-orange-500/20",
      iconColor: "text-red-400",
    },
  ];
  
  const performanceMetrics = [
    {
      label: "Avg Duration",
      value: `${analytics?.avg_duration_seconds?.toFixed(0) || 0}s`,
      icon: Clock,
      color: "from-purple-500/20 to-blue-500/20",
    },
    {
      label: "Avg Retrieval Time",
      value: `${analytics?.avg_retrieval_time_ms?.toFixed(0) || 0}ms`,
      icon: Zap,
      color: "from-yellow-500/20 to-orange-500/20",
    },
    {
      label: "Avg LLM Response",
      value: `${analytics?.avg_llm_response_time_ms?.toFixed(0) || 0}ms`,
      icon: MessageSquare,
      color: "from-blue-500/20 to-cyan-500/20",
    },
    {
      label: "Avg STT Time",
      value: `${analytics?.avg_stt_time_ms?.toFixed(0) || 0}ms`,
      icon: Activity,
      color: "from-green-500/20 to-emerald-500/20",
    },
  ];
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Analytics Dashboard</h1>
            <p className="text-slate-400">Monitor call performance and insights</p>
          </div>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-500/50"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </div>
        
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="glass-card rounded-2xl p-6"
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                  <stat.icon className={`w-6 h-6 ${stat.iconColor}`} />
                </div>
                <div>
                  <p className="text-sm text-slate-400 mb-1">{stat.label}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
        
        {/* Performance Metrics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="glass-card rounded-2xl p-6 mb-8"
        >
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            Performance Metrics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {performanceMetrics.map((metric, index) => (
              <div key={metric.label} className="p-4 bg-white/5 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <metric.icon className="w-4 h-4 text-slate-400" />
                  <p className="text-xs text-slate-400">{metric.label}</p>
                </div>
                <p className="text-xl font-bold">{metric.value}</p>
              </div>
            ))}
          </div>
        </motion.div>
        
        {/* Knowledge Analytics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="glass-card rounded-2xl p-6"
          >
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-purple-400" />
              Knowledge Usage
            </h2>
            <div className="space-y-4">
              <div className="p-4 bg-white/5 rounded-xl">
                <p className="text-xs text-slate-400 mb-1">Knowledge Coverage</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-blue-500"
                      style={{ width: `${analytics?.knowledge_coverage || 0}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium">{analytics?.knowledge_coverage?.toFixed(1) || 0}%</span>
                </div>
              </div>
              
              {analytics?.top_retrieved_chunks && analytics.top_retrieved_chunks.length > 0 && (
                <div className="p-4 bg-white/5 rounded-xl">
                  <p className="text-xs text-slate-400 mb-2">Top Retrieved Chunks</p>
                  <div className="space-y-2">
                    {analytics.top_retrieved_chunks.slice(0, 5).map((chunk: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-slate-300 truncate">Chunk {chunk.chunk_id || i + 1}</span>
                        <span className="text-purple-400 font-medium">{chunk.count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="glass-card rounded-2xl p-6"
          >
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-green-400" />
              Most Asked Questions
            </h2>
            <div className="space-y-3">
              {analytics?.most_asked_questions && analytics.most_asked_questions.length > 0 ? (
                analytics.most_asked_questions.slice(0, 5).map((q: any, i: number) => (
                  <div key={i} className="p-3 bg-white/5 rounded-xl">
                    <p className="text-sm text-slate-300 mb-1">{q.question}</p>
                    <p className="text-xs text-purple-400 font-medium">{q.count} times</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">No questions data available</p>
              )}
            </div>
          </motion.div>
        </div>
        
        {/* Peak Hours */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="glass-card rounded-2xl p-6"
        >
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-400" />
            Peak Calling Hours
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            {Array.from({ length: 24 }, (_, i) => {
              const hourData = analytics?.peak_hours?.find((h: any) => h.hour === i);
              const count = hourData?.count || 0;
              const maxCount = Math.max(...(analytics?.peak_hours?.map((h: any) => h.count) || [1]));
              const height = count > 0 ? Math.max(10, (count / maxCount) * 100) : 5;
              
              return (
                <div key={i} className="flex flex-col items-center gap-2">
                  <div className="w-full h-32 bg-white/5 rounded-lg relative overflow-hidden">
                    <div
                      className="absolute bottom-0 w-full bg-gradient-to-t from-purple-500 to-blue-500 transition-all"
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-400">{i}:00</p>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
