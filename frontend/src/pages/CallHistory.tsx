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
      case "completed": return "text-[#3e9b6e]";
      case "failed": return "text-[#b03a24]";
      case "missed": return "text-[#d9822b]";
      default: return "text-[#8a7157]";
    }
  };
  
  const getSentimentColor = (sentiment: string | null) => {
    switch (sentiment) {
      case "positive": return "text-[#3e9b6e]";
      case "negative": return "text-[#b03a24]";
      case "neutral": return "text-[#8a7157]";
      default: return "text-[#9c8369]";
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
    <div className="h-screen bg-gradient-to-br from-[#fbf6ec] via-[#f5edde] to-[#fbf6ec] text-[#43301f] p-8 flex flex-col overflow-hidden">
      <div className="max-w-7xl mx-auto w-full flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-[#8a7157] hover:text-[#43301f] transition-colors text-sm"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>{t("backHome")}</span>
          </button>
          <LanguageSwitcher compact />
        </div>
        <div className="flex items-center justify-between mb-5 shrink-0">
          <div>
            <h1 className="text-3xl font-bold mb-2">{t("callHistoryTitle")}</h1>
            <p className="text-[#8a7157]">{t("callHistorySub")}</p>
          </div>
          <button className="glass-card px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-[#8f4426]/[0.06] transition-colors">
            <Download className="w-4 h-4" />
            {t("export")}
          </button>
        </div>
        
        {/* Filters */}
        <div className="glass-card rounded-2xl p-4 mb-4 flex items-center gap-4 shrink-0">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8a7157]" />
            <input
              type="text"
              placeholder={t("searchByPhone")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#8f4426]/[0.05] border border-[#8f4426]/[0.12] rounded-xl text-sm focus:outline-none focus:border-[#a85a32]/50 text-[#43301f] placeholder:text-[#9c8369]"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 bg-[#8f4426]/[0.05] border border-[#8f4426]/[0.12] rounded-xl text-sm focus:outline-none focus:border-[#a85a32]/50 text-[#43301f]"
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
                <tr className="border-b border-[#8f4426]/[0.1]">
                  <th className="text-left p-4 text-sm font-medium text-[#8a7157]">{t("caller")}</th>
                  <th className="text-left p-4 text-sm font-medium text-[#8a7157]">{t("dateTime")}</th>
                  <th className="text-left p-4 text-sm font-medium text-[#8a7157]">{t("duration")}</th>
                  <th className="text-left p-4 text-sm font-medium text-[#8a7157]">{t("status")}</th>
                  <th className="text-left p-4 text-sm font-medium text-[#8a7157]">{t("sentiment")}</th>
                  <th className="text-left p-4 text-sm font-medium text-[#8a7157]">{t("turns")}</th>
                  <th className="text-right p-4 text-sm font-medium text-[#8a7157]">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-[#8a7157]">
                      {t("loading")}
                    </td>
                  </tr>
                ) : filteredCalls.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-[#8a7157]">
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
                      className="border-b border-[#8f4426]/[0.06] hover:bg-[#8f4426]/[0.04] cursor-pointer"
                      onClick={() => {
                        setSelectedCall(call);
                        loadCallDetails(call.call_id);
                      }}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#a85a32]/15 flex items-center justify-center">
                            <User className="w-4 h-4 text-[#a85a32]" />
                          </div>
                          <div>
                            <p className="font-medium text-[#43301f]">{call.caller_name || "Unknown"}</p>
                            <p className="text-sm text-[#8a7157]">{call.caller_number}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-sm text-[#5c4632]">
                        {formatDate(call.started_at)}
                      </td>
                      <td className="p-4 text-sm text-[#5c4632]">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-[#8a7157]" />
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
                      <td className="p-4 text-sm text-[#5c4632]">
                        {call.total_turns}
                      </td>
                      <td className="p-4 text-right">
                        <ChevronRight className="w-5 h-5 text-[#8a7157] ml-auto" />
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
            className="fixed inset-0 bg-[#3e2f23]/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedCall(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="glass-card rounded-3xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-[#43301f]">{t("callDetails")}</h2>
                <button
                  onClick={() => setSelectedCall(null)}
                  className="text-[#8a7157] hover:text-[#43301f]"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-[#8f4426]/[0.04] rounded-xl">
                    <p className="text-xs text-[#8a7157] mb-1">{t("caller")}</p>
                    <p className="font-medium text-[#43301f]">{callDetails.caller_name || "Unknown"}</p>
                    <p className="text-sm text-[#8a7157]">{callDetails.caller_number}</p>
                  </div>
                  <div className="p-4 bg-[#8f4426]/[0.04] rounded-xl">
                    <p className="text-xs text-[#8a7157] mb-1">{t("duration")}</p>
                    <p className="font-medium text-[#43301f]">{formatDuration(callDetails.duration_seconds)}</p>
                  </div>
                </div>
                
                {callDetails.transcript && (
                  <div className="p-4 bg-[#8f4426]/[0.04] rounded-xl">
                    <p className="text-xs text-[#8a7157] mb-2">{t("transcript")}</p>
                    <p className="text-sm whitespace-pre-wrap text-[#43301f]">{callDetails.transcript}</p>
                  </div>
                )}
                
                {callDetails.summary && (
                  <div className="p-4 bg-[#8f4426]/[0.04] rounded-xl">
                    <p className="text-xs text-[#8a7157] mb-2">{t("summary")}</p>
                    <p className="text-sm text-[#43301f]">{callDetails.summary}</p>
                  </div>
                )}
                
                {callDetails.questions_asked && callDetails.questions_asked.length > 0 && (
                  <div className="p-4 bg-[#8f4426]/[0.04] rounded-xl">
                    <p className="text-xs text-[#8a7157] mb-2">{t("questionsAsked")}</p>
                    <ul className="text-sm space-y-1 text-[#43301f]">
                      {callDetails.questions_asked.map((q: string, i: number) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-[#a85a32]">•</span>
                          {q}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-[#8f4426]/[0.04] rounded-xl">
                    <p className="text-xs text-[#8a7157] mb-1">{t("avgRetrieval")}</p>
                    <p className="font-medium text-[#43301f]">{callDetails.avg_retrieval_time_ms?.toFixed(0) || "N/A"} ms</p>
                  </div>
                  <div className="p-4 bg-[#8f4426]/[0.04] rounded-xl">
                    <p className="text-xs text-[#8a7157] mb-1">{t("avgLlm")}</p>
                    <p className="font-medium text-[#43301f]">{callDetails.avg_llm_response_time_ms?.toFixed(0) || "N/A"} ms</p>
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