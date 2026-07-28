import React, { useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import LandingPage from "./pages/LandingPage";
import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";

function App() {
  const location = useLocation();
  const [campaignId, setCampaignId] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-dark-950 relative overflow-hidden">
      {/* Ambient Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-primary-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-secondary-500/5 rounded-full blur-[120px]" />
        <div className="absolute top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] w-[40%] h-[40%] bg-purple-500/3 rounded-full blur-[100px]" />
      </div>

      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route
            path="/"
            element={
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <LandingPage onCampaignCreated={setCampaignId} />
              </motion.div>
            }
          />
          <Route
            path="/dashboard"
            element={
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Dashboard campaignId={campaignId} />
              </motion.div>
            }
          />
          <Route
            path="/reports"
            element={
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Reports campaignId={campaignId} />
              </motion.div>
            }
          />
        </Routes>
      </AnimatePresence>
    </div>
  );
}

export default App;
