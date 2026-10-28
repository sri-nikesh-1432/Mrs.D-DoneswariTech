import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Bot, ArrowUpRight, GraduationCap, PhoneCall, Users, TrendingUp } from "lucide-react";
import { getMe, listAgents } from "../services/api";
import { StatusChip } from "./Dashboard";
import { useI18n } from "../i18n";
import CreateAgentModal from "../components/CreateAgentModal";

/**
 * HOME (spec §5 §19 §55): the main agent-management area.
 * Every number is queried from the agent's actual records — no fake values.
 * Empty state is honest: a fresh workspace shows zero agents.
 */
export default function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: 60_000 });
  const { data: agents, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: listAgents,
    refetchInterval: 15_000,
  });

  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Workspace header */}
      <div className="flex items-start justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gray-800)]">
            {t("home.welcome")}{me?.user?.full_name ? `, ${me.user.full_name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-sm text-[var(--gray-500)] mt-0.5">
            {me?.workspace?.name ?? "Doneswari Workspace"} · AI admissions telecallers
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition-colors shadow-[0_8px_24px_rgba(14,147,232,0.3)]"
        >
          <Plus className="w-4 h-4" /> {t("home.createAgent")}
        </button>
      </div>

      {/* Agents grid */}
      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-44 rounded-[var(--radius-md)]" />)}
        </div>
      ) : (agents ?? []).length === 0 ? (
        <div className="glass rounded-[var(--radius-md)] p-12 text-center border border-slate-700/50 bg-slate-900/40">
          <Bot className="w-12 h-12 text-sky-400 mx-auto mb-3" />
          <div className="text-lg font-bold text-white">{t("home.agents")}</div>
          <p className="text-sm text-slate-400 mt-1.5 max-w-sm mx-auto">
            {t("home.noAgents")}
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-6 inline-flex items-center gap-2 bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-600 hover:to-indigo-600 text-white text-sm font-bold rounded-xl px-6 py-3 shadow-[0_8px_24px_rgba(14,147,232,0.35)] transition-all"
          >
            <Plus className="w-4 h-4" /> {t("home.createAgent")}
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(agents ?? []).map((a) => (
            <Link
              key={a.id}
              to={`/agent/${a.id}/overview`}
              className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] transition-shadow group border border-slate-800/80 hover:border-sky-500/40 bg-slate-900/60"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                  {(a.agent_name || "A").slice(0, 1)}
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip status={a.status} />
                  <ArrowUpRight className="w-4 h-4 text-slate-500 group-hover:text-sky-400 transition-colors" />
                </div>
              </div>
              <div className="font-bold text-white text-base">{a.agent_name}</div>
              <div className="text-xs text-sky-400 truncate mt-0.5">{a.name}</div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1.5">
                <GraduationCap className="w-3.5 h-3.5 text-slate-500" />
                {a.knowledge_ready ? (
                  <span className="text-emerald-400 font-medium">Knowledge ready</span>
                ) : (
                  <span className="text-amber-400 font-medium">Knowledge pending</span>
                )}
              </div>

              {/* Real counts from the agent's own records */}
              <div className="grid grid-cols-3 gap-2 mt-4 pt-3.5 border-t border-slate-800 text-center">
                <MiniStat icon={Users} value={a.total_students ?? 0} label={t("home.students")} />
                <MiniStat icon={PhoneCall} value={a.calls_completed ?? 0} label={t("home.calls")} />
                <MiniStat icon={TrendingUp} value={a.interested_count ?? 0} label={t("home.interested")} />
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

function MiniStat({ icon: Icon, value, label }: { icon: React.ComponentType<{ className?: string }>; value: number; label: string }) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1 text-[13px] font-bold text-white">
        <Icon className="w-3.5 h-3.5 text-slate-500" /> {value}
      </div>
      <div className="text-[10.5px] text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}
