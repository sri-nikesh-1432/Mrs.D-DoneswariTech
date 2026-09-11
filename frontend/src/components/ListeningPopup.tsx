import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import VoiceWaveform from "./VoiceWaveform";
import type { VoiceState } from "../types";

interface ListeningPopupProps {
  visible: boolean;
  state: VoiceState;
  amplitude?: number;
  partialText?: string;
}

const STATE_LABEL: Partial<Record<VoiceState, string>> = {
  listening:  "Listening...",
  thinking:   "Thinking...",
  speaking:   "Speaking...",
  connecting: "Connecting...",
  greeting:   "Greeting...",
  calling:    "Calling...",
  connected:  "Connected",
};

export default function ListeningPopup({ visible, state, amplitude = 0, partialText }: ListeningPopupProps) {
  const label = STATE_LABEL[state] ?? "Listening...";
  const isListening = state === "listening";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.95 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          style={{ minWidth: 280 }}
        >
          <div
            className="glass rounded-2xl px-6 pt-4 pb-3 shadow-lg flex flex-col items-center gap-2"
            style={{
              border: "1px solid rgba(186,230,253,0.7)",
              background: "rgba(255,255,255,0.88)",
            }}
          >
            {/* Status dot + label */}
            <div className="flex items-center gap-2">
              <motion.div
                className="w-2.5 h-2.5 rounded-full bg-sky-400"
                animate={{ opacity: [1, 0.3, 1], scale: [1, 1.3, 1] }}
                transition={{ duration: 0.9, repeat: Infinity }}
              />
              <span className="text-sm font-semibold text-sky-600 tracking-wide">{label}</span>
            </div>

            {/* Waveform */}
            <div className="w-full" style={{ height: 40 }}>
              <VoiceWaveform
                state={state}
                amplitude={amplitude}
                barCount={28}
                color="#0ea5e9"
                height={40}
              />
            </div>

            {/* Partial transcript */}
            {partialText && (
              <p className="text-xs text-gray-500 text-center max-w-xs truncate">
                {partialText}
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
