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
        background: "#FFFFFF",
        border: listening
          ? "1.5px solid #0284C7"
          : "1.5px solid #D6CEBE",
        boxShadow: listening
          ? "0 0 20px rgba(14, 165, 233, 0.35), 0 2px 6px rgba(0, 0, 0, 0.04)"
          : "0 4px 16px rgba(80, 65, 45, 0.06), 0 1px 3px rgba(0, 0, 0, 0.03)",
      }}
    >
      {/* Mic button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={toggleMic}
        disabled={disabled}
        className={`
          w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all shadow-sm
          ${listening
            ? "bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-red-500/30"
            : "bg-sky-100 text-sky-700 border border-sky-300 hover:bg-sky-200"
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
        placeholder={listening ? "Listening to your voice... (you can also type here)" : "Type your question here in Telugu, English, or Tenglish... (Press Enter to send)"}
        disabled={disabled}
        style={{ minHeight: "40px", resize: "none", maxHeight: "140px" }}
        className="flex-1 bg-transparent text-sm text-stone-900 placeholder:text-stone-400 font-medium outline-none disabled:cursor-not-allowed leading-relaxed py-1"
      />

      {/* Send button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleSend}
        disabled={!value.trim() || disabled}
        className="w-10 h-10 rounded-xl bg-sky-600 hover:bg-sky-700 text-white flex items-center justify-center flex-shrink-0 transition-all shadow-md shadow-sky-600/25 disabled:opacity-40 disabled:cursor-not-allowed"
        title="Send question"
      >
        <Send size={16} />
      </motion.button>
    </div>
  );
}
