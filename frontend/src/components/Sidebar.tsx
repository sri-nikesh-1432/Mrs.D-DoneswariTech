import React from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import {
  LayoutDashboard, Bot, BookOpen, Users, PhoneCall, BarChart3, Settings,
  LogOut, ChevronDown,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { listAgents, logout } from "../services/api";
import { useI18n } from "../i18n";

interface SidebarProps {
  workspaceName?: string;
  userName?: string;
  onLogout?: () => void;
}

const NAV_AGENT = [
  { to: "overview", label: "Overview", icon: Bot },
  { to: "test", label: "Voice Test", icon: PhoneCall },
  { to: "students", label: "Students", icon: Users },
  { to: "campaign", label: "Start Calls", icon: PhoneCall },
  { to: "analytics", label: "Analytics", icon: BarChart3 },
];

export default function Sidebar({ workspaceName, userName, onLogout }: SidebarProps) {
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();
  const { t } = useI18n();

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: listAgents,
    staleTime: 30_000,
  });

  const activeAgent = agents?.find((a) => String(a.id) === agentId);

  const handleLogout = async () => {
    await logout();
    onLogout?.();
    navigate("/login");
  };

  return (
    <aside className="w-60 shrink-0 h-screen sticky top-0 flex flex-col bg-white border-r border-[var(--gray-200)]">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-[var(--gray-100)]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--sky-400)] to-[var(--sky-600)] flex items-center justify-center text-white font-bold text-sm shadow-[var(--shadow-md)]">
            D
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[15px] text-[var(--gray-800)] leading-tight">Doneswari AI</div>
            <div className="text-[11px] text-[var(--gray-500)] truncate">{workspaceName || "Workspace"}</div>
          </div>
        </div>
      </div>

      {/* Global nav */}
      <nav className="px-3 pt-4 space-y-0.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-400)] px-3 pb-1.5">{t("nav.platform")}</div>
        <SideLink to="/home" icon={LayoutDashboard} label={t("nav.home")} end />
        <SideLink to="/dashboard" icon={LayoutDashboard} label={t("nav.dashboard")} end />
        <SideLink to="/agents" icon={Bot} label={t("nav.agents")} end />
        <SideLink to="/settings" icon={Settings} label={t("nav.settings")} end />
      </nav>

      {/* Agent-scoped nav */}
      {agentId && (
        <nav className="px-3 pt-5 pb-2 border-t border-[var(--gray-100)] mt-2 space-y-0.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-400)] px-3 pb-1.5">
            Agent{activeAgent ? ` · ${activeAgent.agent_name}` : ""}
          </div>
          {NAV_AGENT.map((item) => (
            <SideLink
              key={item.to}
              to={`/agent/${agentId}/${item.to}`}
              icon={item.icon}
              label={t(`nav.${item.to === "overview" ? "overview" : item.to === "test" ? "voiceTest" : item.to === "students" ? "students" : item.to === "campaign" ? "startCalls" : "analytics"}` as never)}
            />
          ))}
        </nav>
      )}

      {/* Agent switcher */}
      {agents && agents.length > 0 && (
        <div className="px-3 mt-2">
          <div className="relative">
            <select
              value={agentId ?? ""}
              onChange={(e) => navigate(`/agent/${e.target.value}/overview`)}
              className="w-full appearance-none bg-[var(--gray-50)] border border-[var(--gray-200)] rounded-lg px-3 py-2 pr-8 text-[13px] text-[var(--gray-700)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sky-400)] cursor-pointer"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.agent_name} — {a.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--gray-400)] pointer-events-none" />
          </div>
        </div>
      )}

      <div className="flex-1" />

      {/* User footer */}
      <div className="p-3 border-t border-[var(--gray-100)]">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="w-8 h-8 rounded-full bg-[var(--sky-100)] text-[var(--sky-700)] flex items-center justify-center text-xs font-semibold">
            {(userName || "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-[var(--gray-700)] truncate">{userName || "User"}</div>
          </div>
          <button
            onClick={handleLogout}
            title={t("nav.logout")}
            className="p-1.5 rounded-lg text-[var(--gray-400)] hover:text-[var(--gray-600)] hover:bg-[var(--gray-100)] transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function SideLink({
  to, icon: Icon, label, end,
}: { to: string; icon: React.ComponentType<{ className?: string }>; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors ${
          isActive
            ? "bg-[var(--sky-50)] text-[var(--sky-700)]"
            : "text-[var(--gray-600)] hover:bg-[var(--gray-50)] hover:text-[var(--gray-800)]"
        }`
      }
    >
      <Icon className="w-[17px] h-[17px]" />
      {label}
    </NavLink>
  );
}
