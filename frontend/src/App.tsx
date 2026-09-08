import React from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Onboarding from "./pages/Onboarding";
import Agent from "./pages/Agent";
import Calls from "./pages/Calls";
import Settings from "./pages/Settings";

function App() {
  const location = useLocation();

  return (
    <div className="h-screen w-full relative overflow-hidden bg-sky-50">
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route
            path="/onboarding"
            element={
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Onboarding />
              </motion.div>
            }
          />
          <Route
            path="/agent/:agentId"
            element={
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Agent />
              </motion.div>
            }
          />
          <Route
            path="/calls"
            element={
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Calls />
              </motion.div>
            }
          />
          <Route
            path="/settings"
            element={
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Settings />
              </motion.div>
            }
          />
        </Routes>
      </AnimatePresence>
    </div>
  );
}

export default App;
