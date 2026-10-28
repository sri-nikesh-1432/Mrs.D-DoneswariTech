import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Bot, FileUp, Sparkles, PhoneCall, ShieldCheck } from "lucide-react";
import { listAgents } from "../services/api";
import { StatusChip } from "./Dashboard";
import CreateAgentModal from "../components/CreateAgentModal";

export default function Agents() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: agents, isLoading } = useQuery({ queryKey: ["agents"], queryFn: listAgents });

  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-black text-stone-900">Admissions Agents</h1>
          <p className="text-sm text-stone-600 mt-0.5 font-medium">Create and manage your AI telecalling agents</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-xl px-4 py-2.5 transition-all shadow-md shadow-sky-600/25"
        >
          <Plus className="w-4 h-4" /> Create Agent
        </button>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-44 rounded-2xl" />
          ))}
        </div>
      ) : (agents ?? []).length === 0 ? (
        <div className="bg-white/95 rounded-3xl p-12 text-center border border-[#E2D9C8] shadow-md backdrop-blur-xl">
          <div className="w-16 h-16 rounded-2xl bg-sky-100 text-sky-700 border border-sky-300 flex items-center justify-center mx-auto mb-4 shadow-sm">
            <Bot className="w-8 h-8" />
          </div>
          <div className="text-lg font-extrabold text-stone-900">No agents yet</div>
          <p className="text-sm text-stone-600 mt-1.5 max-w-sm mx-auto font-medium">
            Create your first admissions telecaller by providing an agent name, institution name, and uploading the syllabus or fee structure document.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-6 inline-flex items-center gap-2 bg-gradient-to-r from-sky-600 via-sky-700 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white text-sm font-extrabold rounded-xl px-6 py-3 shadow-lg shadow-sky-600/25 transition-all"
          >
            <Plus className="w-4 h-4" /> Create New Agent
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(agents ?? []).map((a) => (
            <Link
              key={a.id}
              to={`/agent/${a.id}/overview`}
              className="bg-white/95 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all border border-[#E2D9C8] hover:border-sky-400 group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 flex items-center justify-center text-white font-black text-sm shadow-sm">
                  {(a.agent_name || "A").slice(0, 1)}
                </div>
                <StatusChip status={a.status} />
              </div>
              <div className="font-extrabold text-stone-900 text-base group-hover:text-sky-700 transition-colors">{a.agent_name}</div>
              <div className="text-xs font-semibold text-sky-700 truncate mt-0.5">{a.name}</div>
              <div className="text-[12px] text-stone-600 mt-1 truncate font-medium">{a.calling_purpose}</div>
              <div className="flex gap-4 mt-4 pt-3 border-t border-[#E8E2D5] text-[12px] text-stone-500 font-medium">
                <span className="flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5 text-stone-400" /> {a.total_students ?? 0} students
                </span>
                <span className="flex items-center gap-1.5">
                  <FileUp className="w-3.5 h-3.5 text-stone-400" />
                  {a.knowledge_ready ? (
                    <span className="text-emerald-700 font-bold">Knowledge ready</span>
                  ) : (
                    <span className="text-amber-700 font-bold">Training needed</span>
                  )}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* 2-Step Agent Creation & PDF Training Modal */}
      <CreateAgentModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["agents"] });
        }}
      />
    </div>
  );
}
