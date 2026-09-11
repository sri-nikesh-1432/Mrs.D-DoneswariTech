import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Onboarding from "./pages/Onboarding";
import Agent from "./pages/Agent";
import Calls from "./pages/Calls";
import Settings from "./pages/Settings";

const PageWrap = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.25 }}
    className="h-screen w-full"
  >
    {children}
  </motion.div>
);

export default function App() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/onboarding" replace />} />

        {/* Onboarding */}
        <Route
          path="/onboarding"
          element={
            <PageWrap>
              <Onboarding />
            </PageWrap>
          }
        />

        {/* Main agent screen — primary experience */}
        <Route
          path="/agent/:agentId"
          element={
            <PageWrap>
              <Agent />
            </PageWrap>
          }
        />
        {/* Fallback without ID */}
        <Route
          path="/agent"
          element={<Navigate to="/agent/1" replace />}
        />

        {/* Calls & Leads */}
        <Route
          path="/calls"
          element={
            <PageWrap>
              <Calls />
            </PageWrap>
          }
        />

        {/* Settings */}
        <Route
          path="/settings"
          element={
            <PageWrap>
              <Settings />
            </PageWrap>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    </AnimatePresence>
  );
}
