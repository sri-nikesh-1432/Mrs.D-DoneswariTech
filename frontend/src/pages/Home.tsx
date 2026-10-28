import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Bot, ArrowUpRight, GraduationCap, PhoneCall, Users, TrendingUp } from "lucide-react";
import { getMe, listAgents } from "../services/api";
import { StatusChip } from "./Dashboard";
import { useI18n } from "../i18n";
import CreateAgentModal from "../components/CreateAgentModal";

/**
 * HOME: the main agent-management area.
 * Warm beige canvas · Crisp black typography · Sky UI accents.
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
          <h1 className="text-2xl font-black text-stone-900 tracking-tight">
            {t("home.welcome")}{me?.user?.full_name ? `, ${me.user.full_name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-sm text-stone-600 mt-0.5 font-medium">
            {me?.workspace?.name ?? "Doneswari Workspace"} · AI admissions telecallers
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-xl px-4 py-2.5 transition-all shadow-md shadow-sky-600/25"
        >
          <Plus className="w-4 h-4" /> {t("home.createAgent")}
        </button>
      </div>

      {/* Agents grid */}
      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-44 rounded-2xl" />)}
        </div>
      ) : (agents ?? []).length === 0 ? (
        <div className="bg-white/95 rounded-3xl p-12 text-center border border-[#E2D9C8] shadow-md backdrop-blur-xl">
          <div className="w-16 h-16 rounded-2xl bg-sky-100 text-sky-700 border border-sky-300 flex items-center justify-center mx-auto mb-4 shadow-sm">
            <Bot className="w-8 h-8" />
          </div>
          <div className="text-lg font-extrabold text-stone-900">{t("home.agents")}</div>
          <p className="text-sm text-stone-600 mt-1.5 max-w-sm mx-auto font-medium">
            {t("home.noAgents")}
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-6 inline-flex items-center gap-2 bg-gradient-to-r from-sky-600 via-sky-700 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white text-sm font-extrabold rounded-xl px-6 py-3 shadow-lg shadow-sky-600/25 transition-all"
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
              className="bg-white/95 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group border border-[#E2D9C8] hover:border-sky-400"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 flex items-center justify-center text-white font-black text-sm shadow-sm">
                  {(a.agent_name || "A").slice(0, 1)}
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip status={a.status} />
                  <ArrowUpRight className="w-4 h-4 text-stone-400 group-hover:text-sky-600 transition-colors" />
                </div>
              </div>
              <div className="font-extrabold text-stone-900 text-base group-hover:text-sky-700 transition-colors">{a.agent_name}</div>
              <div className="text-xs font-semibold text-sky-700 truncate mt-0.5">{a.name}</div>
              <div className="flex items-center gap-1.5 text-xs text-stone-600 mt-1.5 font-medium">
                <GraduationCap className="w-3.5 h-3.5 text-stone-400" />
                {a.knowledge_ready ? (
                  <span className="text-emerald-700 font-bold">Knowledge ready</span>
                ) : (
                  <span className="text-amber-700 font-bold">Knowledge pending</span>
                )}
              </div>

              {/* Real counts from the agent's own records */}
              <div className="grid grid-cols-3 gap-2 mt-4 pt-3.5 border-t border-[#E8E2D5] text-center">
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
      <div className="text-xs font-black text-stone-900 flex items-center justify-center gap-1">
        <Icon className="w-3 h-3 text-stone-400" />
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] text-stone-500 font-medium truncate mt-0.5">{label}</div>
    </div>
  );
}
