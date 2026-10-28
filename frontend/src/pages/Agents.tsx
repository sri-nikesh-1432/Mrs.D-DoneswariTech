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
          <h1 className="text-2xl font-bold text-[var(--gray-800)]">Agents</h1>
          <p className="text-sm text-[var(--gray-500)] mt-0.5">Create and manage your AI telecalling agents</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition-colors shadow-[0_8px_24px_rgba(14,147,232,0.3)]"
        >
          <Plus className="w-4 h-4" /> Create Agent
        </button>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-44 rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : (agents ?? []).length === 0 ? (
        <div className="glass rounded-[var(--radius-md)] p-12 text-center border border-slate-700/50 bg-slate-900/40">
          <div className="w-16 h-16 rounded-2xl bg-sky-500/20 text-sky-400 border border-sky-400/30 flex items-center justify-center mx-auto mb-4">
            <Bot className="w-8 h-8" />
          </div>
          <div className="text-lg font-bold text-white">No agents yet</div>
          <p className="text-sm text-slate-400 mt-1.5 max-w-sm mx-auto">
            Create your first admissions telecaller by providing an agent name, institution name, and uploading the syllabus or fee structure document.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-6 inline-flex items-center gap-2 bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-600 hover:to-indigo-600 text-white text-sm font-bold rounded-xl px-6 py-3 shadow-[0_8px_24px_rgba(14,147,232,0.35)] transition-all"
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
              className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] transition-shadow border border-slate-800/80 hover:border-sky-500/40 bg-slate-900/60"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                  {(a.agent_name || "A").slice(0, 1)}
                </div>
                <StatusChip status={a.status} />
              </div>
              <div className="font-bold text-white text-base">{a.agent_name}</div>
              <div className="text-xs text-sky-400 truncate mt-0.5">{a.name}</div>
              <div className="text-[12px] text-slate-400 mt-1 truncate">{a.calling_purpose}</div>
              <div className="flex gap-4 mt-4 pt-3 border-t border-slate-800 text-[12px] text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5 text-slate-500" /> {a.total_students ?? 0} students
                </span>
                <span className="flex items-center gap-1.5">
                  <FileUp className="w-3.5 h-3.5 text-slate-500" />
                  {a.knowledge_ready ? (
                    <span className="text-emerald-400 font-medium">Knowledge ready</span>
                  ) : (
                    <span className="text-amber-400 font-medium">Training needed</span>
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
