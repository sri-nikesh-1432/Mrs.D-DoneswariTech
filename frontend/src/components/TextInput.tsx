import React, { useState, useRef } from "react";
import { Send, Mic, MicOff, Square } from "lucide-react";
import { motion } from "framer-motion";
import type { VoiceState } from "../types";

interface TextInputProps {
  voiceState: VoiceState;
  onSendText: (text: string) => void;
  onMicStart: () => void;
  onMicStop: () => void;
  disabled?: boolean;
}

export default function TextInput({
  voiceState,
  onSendText,
  onMicStart,
  onMicStop,
  disabled = false,
}: TextInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const listening = voiceState === "listening";

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSendText(trimmed);
    setValue("");
    inputRef.current?.focus();
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleMic = () => {
    if (listening) onMicStop();
    else onMicStart();
  };

  return (
    <div
      className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl transition-all duration-200"
      style={{
        background: "rgba(15, 23, 42, 0.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: listening
          ? "1.5px solid #38bdf8"
          : "1.5px solid rgba(56, 189, 248, 0.25)",
        boxShadow: listening
          ? "0 0 20px rgba(56, 189, 248, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
          : "0 8px 24px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
      }}
    >
      {/* Mic button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={toggleMic}
        disabled={disabled}
        className={`
          w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all shadow-md
          ${listening
            ? "bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-red-500/30"
            : "bg-sky-500/20 text-sky-400 border border-sky-400/40 hover:bg-sky-500/30"
          }
          disabled:opacity-40 disabled:cursor-not-allowed
        `}
        title={listening ? "Stop listening" : "Start voice telecall"}
      >
        {listening ? (
          <motion.div animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
            <Square size={14} fill="currentColor" />
          </motion.div>
        ) : (
          <Mic size={18} />
        )}
      </motion.button>

      {/* Multiline textarea */}
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        placeholder={listening ? "Listening to your voice... (you can also type here)" : "Type your question here... (Press Enter to send)"}
        disabled={disabled}
        style={{ minHeight: "40px", resize: "none", maxHeight: "140px" }}
        className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-400 outline-none disabled:cursor-not-allowed leading-relaxed py-1"
      />

      {/* Send button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleSend}
        disabled={!value.trim() || disabled}
        className="
          w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all
          bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/20 hover:from-sky-400 hover:to-blue-500 border border-sky-400/30
          disabled:opacity-30 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:border-slate-700
        "
        title="Send Question"
      >
        <Send size={15} />
      </motion.button>
    </div>
  );
}
