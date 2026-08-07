import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Phone,
  Clock,
  Calendar,
  User,
  CheckCircle,
  XCircle,
  Play,
  ChevronRight,
  Search,
  Filter,
  Download,
  ArrowLeft,
} from "lucide-react";
import { getCallHistory, getCallDetails, getSimulatorCalls } from "../services/api";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useTranslation } from "../i18n";

interface Call {
  call_id: string;
  caller_number: string;
  caller_name: string | null;
  call_status: string;
  started_at: string;
  duration_seconds: number;
  sentiment: string | null;
  total_turns: number;
}

export default function CallHistory() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [callDetails, setCallDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  
  const instituteId = 1; // Default institute ID for simulator
  
  useEffect(() => {
    loadCalls();
  }, []);
  
  const loadCalls = async () => {
    try {
      setLoading(true);
      const data = await getSimulatorCalls(instituteId);
      setCalls(data.calls || []);
    } catch (e) {
      console.error("Error loading calls:", e);
    } finally {
      setLoading(false);
    }
  };
  
  const loadCallDetails = async (callId: string) => {
    try {
      const details = await getCallDetails(callId);
      setCallDetails(details);
    } catch (e) {
      console.error("Error loading call details:", e);
    }
  };
  
  const filteredCalls = calls.filter(call => {
    const matchesSearch = 
      call.caller_number.includes(searchQuery) ||
      (call.caller_name && call.caller_name.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = statusFilter === "all" || call.call_status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "text-green-400";
      case "failed": return "text-red-400";
      case "missed": return "text-orange-400";
      default: return "text-slate-400";
    }
  };
  
  const getSentimentColor = (sentiment: string | null) => {
    switch (sentiment) {
      case "positive": return "text-green-400";
      case "negative": return "text-red-400";
      case "neutral": return "text-slate-400";
      default: return "text-slate-500";
    }
  };
  
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  };
  
  return (
    <div className="h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-8 flex flex-col overflow-hidden">
      <div className="max-w-7xl mx-auto w-full flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>{t("backHome")}</span>
          </button>
          <LanguageSwitcher compact />
        </div>
        <div className="flex items-center justify-between mb-5 shrink-0">
          <div>
            <h1 className="text-3xl font-bold mb-2">{t("callHistoryTitle")}</h1>
            <p className="text-slate-400">{t("callHistorySub")}</p>
          </div>
          <button className="glass-card px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-white/10 transition-colors">
            <Download className="w-4 h-4" />
            {t("export")}
          </button>
        </div>
        
        {/* Filters */}
        <div className="glass-card rounded-2xl p-4 mb-4 flex items-center gap-4 shrink-0">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t("searchByPhone")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-500/50"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-500/50"
          >
            <option value="all">{t("allStatus")}</option>
            <option value="completed">{t("completed")}</option>
            <option value="missed">{t("missed")}</option>
            <option value="failed">{t("failed")}</option>
          </select>
        </div>
        
        {/* Calls Table */}
        <div className="glass-card-static overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left p-4 text-sm font-medium text-slate-400">{t("caller")}</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">{t("dateTime")}</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">{t("duration")}</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">{t("status")}</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">{t("sentiment")}</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">{t("turns")}</th>
                  <th className="text-right p-4 text-sm font-medium text-slate-400">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      {t("loading")}
                    </td>
                  </tr>
                ) : filteredCalls.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      {t("noCalls")}
                    </td>
                  </tr>
                ) : (
                  filteredCalls.map((call, index) => (
                    <motion.tr
                      key={call.call_id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                      onClick={() => {
                        setSelectedCall(call);
                        loadCallDetails(call.call_id);
                      }}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                            <User className="w-4 h-4 text-purple-400" />
                          </div>
                          <div>
                            <p className="font-medium">{call.caller_name || "Unknown"}</p>
                            <p className="text-sm text-slate-400">{call.caller_number}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-sm text-slate-300">
                        {formatDate(call.started_at)}
                      </td>
                      <td className="p-4 text-sm text-slate-300">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-slate-400" />
                          {formatDuration(call.duration_seconds)}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`text-sm font-medium ${getStatusColor(call.call_status)}`}>
                          {call.call_status}
                        </span>
                      </td>
                      <td className="p-4">
                        {call.sentiment && (
                          <span className={`text-sm font-medium ${getSentimentColor(call.sentiment)}`}>
                            {call.sentiment}
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-sm text-slate-300">
                        {call.total_turns}
                      </td>
                      <td className="p-4 text-right">
                        <ChevronRight className="w-5 h-5 text-slate-400 ml-auto" />
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        
        {/* Call Details Modal */}
        {selectedCall && callDetails && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedCall(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="glass-card rounded-3xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">{t("callDetails")}</h2>
                <button
                  onClick={() => setSelectedCall(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white/5 rounded-xl">
                    <p className="text-xs text-slate-400 mb-1">{t("caller")}</p>
                    <p className="font-medium">{callDetails.caller_name || "Unknown"}</p>
                    <p className="text-sm text-slate-400">{callDetails.caller_number}</p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-xl">
                    <p className="text-xs text-slate-400 mb-1">{t("duration")}</p>
                    <p className="font-medium">{formatDuration(callDetails.duration_seconds)}</p>
                  </div>
                </div>
                
                {callDetails.transcript && (
                  <div className="p-4 bg-white/5 rounded-xl">
                    <p className="text-xs text-slate-400 mb-2">{t("transcript")}</p>
                    <p className="text-sm whitespace-pre-wrap">{callDetails.transcript}</p>
                  </div>
                )}
                
                {callDetails.summary && (
                  <div className="p-4 bg-white/5 rounded-xl">
                    <p className="text-xs text-slate-400 mb-2">{t("summary")}</p>
                    <p className="text-sm">{callDetails.summary}</p>
                  </div>
                )}
                
                {callDetails.questions_asked && callDetails.questions_asked.length > 0 && (
                  <div className="p-4 bg-white/5 rounded-xl">
                    <p className="text-xs text-slate-400 mb-2">{t("questionsAsked")}</p>
                    <ul className="text-sm space-y-1">
                      {callDetails.questions_asked.map((q: string, i: number) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-purple-400">•</span>
                          {q}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white/5 rounded-xl">
                    <p className="text-xs text-slate-400 mb-1">{t("avgRetrieval")}</p>
                    <p className="font-medium">{callDetails.avg_retrieval_time_ms?.toFixed(0) || "N/A"} ms</p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-xl">
                    <p className="text-xs text-slate-400 mb-1">{t("avgLlm")}</p>
                    <p className="font-medium">{callDetails.avg_llm_response_time_ms?.toFixed(0) || "N/A"} ms</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
