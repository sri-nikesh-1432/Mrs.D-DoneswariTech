import React from "react";
import { Routes, Route, Navigate, useLocation, Outlet } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Sidebar from "./components/Sidebar";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Agents from "./pages/Agents";
import AgentOverview from "./pages/AgentOverview";
import AgentTest from "./pages/AgentTest";
import Students from "./pages/Students";
import Campaign from "./pages/Campaign";
import AgentAnalytics from "./pages/AgentAnalytics";
import Calls from "./pages/Calls";
import Settings from "./pages/Settings";
import TrainLanding from "./pages/TrainLanding";

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

function AppLayout() {
  return (
    <div className="flex min-h-screen bg-app">
      <Sidebar />
      <main className="flex-1 min-w-0 relative z-10">
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
        {/* Public train landing — the entry point per spec */}
        <Route path="/" element={<PageWrap><TrainLanding /></PageWrap>} />

        {/* App shell */}
        <Route element={<AppLayout />}>
          <Route path="/home" element={<PageWrap><Home /></PageWrap>} />
          <Route path="/dashboard" element={<PageWrap><Dashboard /></PageWrap>} />
          <Route path="/agents" element={<PageWrap><Agents /></PageWrap>} />
          <Route path="/agents/new" element={<PageWrap><Agents /></PageWrap>} />

          <Route path="/agent/:agentId/overview" element={<PageWrap><AgentOverview /></PageWrap>} />
          <Route path="/agent/:agentId/test" element={<PageWrap><AgentTest /></PageWrap>} />
          <Route path="/agent/:agentId/students" element={<PageWrap><Students /></PageWrap>} />
          <Route path="/agent/:agentId/campaign" element={<PageWrap><Campaign /></PageWrap>} />
          <Route path="/agent/:agentId/analytics" element={<PageWrap><AgentAnalytics /></PageWrap>} />

          <Route path="/calls" element={<PageWrap><Calls /></PageWrap>} />
          <Route path="/settings" element={<PageWrap><Settings /></PageWrap>} />
        </Route>

        {/* Redirects */}
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/signup" element={<Navigate to="/" replace />} />
        <Route path="/onboarding" element={<Navigate to="/home" replace />} />
        <Route path="/agent" element={<Navigate to="/agents" replace />} />
        <Route path="/agent/:agentId" element={<Navigate to="overview" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  );
}
