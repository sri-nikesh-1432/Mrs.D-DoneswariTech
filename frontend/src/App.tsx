import React from "react";
import { Routes, Route, Navigate, useLocation, Outlet } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import Sidebar from "./components/Sidebar";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import Agents from "./pages/Agents";
import AgentOverview from "./pages/AgentOverview";
import AgentTest from "./pages/AgentTest";
import Students from "./pages/Students";
import Campaign from "./pages/Campaign";
import AgentAnalytics from "./pages/AgentAnalytics";
import Calls from "./pages/Calls";
import Settings from "./pages/Settings";
import { getMe } from "./services/api";

const PageWrap = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.2 }}
    className="min-h-screen w-full"
  >
    {children}
  </motion.div>
);

// ─── Authenticated SaaS layout with persistent sidebar ─────────────
function AppLayout() {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: 60_000 });

  return (
    <div className="flex min-h-screen bg-sky-gradient">
      <Sidebar
        workspaceName={me?.workspace?.name}
        userName={me?.user?.full_name}
      />
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* Auth */}
        <Route path="/login" element={<PageWrap><Login /></PageWrap>} />
        <Route path="/signup" element={<PageWrap><Signup /></PageWrap>} />

        {/* Authenticated SaaS shell */}
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<PageWrap><Dashboard /></PageWrap>} />
          <Route path="/agents" element={<PageWrap><Agents /></PageWrap>} />

          {/* Agent-scoped pages */}
          <Route path="/agent/:agentId/overview" element={<PageWrap><AgentOverview /></PageWrap>} />
          <Route path="/agent/:agentId/test" element={<PageWrap><AgentTest /></PageWrap>} />
          <Route path="/agent/:agentId/students" element={<PageWrap><Students /></PageWrap>} />
          <Route path="/agent/:agentId/campaign" element={<PageWrap><Campaign /></PageWrap>} />
          <Route path="/agent/:agentId/analytics" element={<PageWrap><AgentAnalytics /></PageWrap>} />

          {/* Legacy full-page views */}
          <Route path="/calls" element={<PageWrap><Calls /></PageWrap>} />
          <Route path="/settings" element={<PageWrap><Settings /></PageWrap>} />
        </Route>

        {/* Redirects */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/onboarding" element={<Navigate to="/dashboard" replace />} />
        <Route path="/agent" element={<Navigate to="/agents" replace />} />
        <Route path="/agent/:agentId" element={<Navigate to="overview" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AnimatePresence>
  );
}
