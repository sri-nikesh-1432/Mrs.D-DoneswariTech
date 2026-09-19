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
  const inputRef = useRef<HTMLInputElement>(null);

  const listening = voiceState === "listening";

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSendText(trimmed);
    setValue("");
    inputRef.current?.focus();
  };

  const handleKey = (e: React.KeyboardEvent) => {
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
      className="flex items-center gap-2 px-3 py-2 rounded-2xl"
      style={{
        background: "rgba(255,255,255,0.9)",
        border: listening
          ? "1.5px solid #38bdf8"
          : "1.5px solid rgba(186,230,253,0.6)",
        boxShadow: listening
          ? "0 0 0 3px rgba(56,189,248,0.15)"
          : "0 2px 8px rgba(14,165,233,0.08)",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
    >
      {/* Mic button */}
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        onClick={toggleMic}
        disabled={disabled}
        className={`
          w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors
          ${listening
            ? "bg-sky-500 text-white shadow-sm"
            : "bg-sky-50 text-sky-500 hover:bg-sky-100"
          }
          disabled:opacity-40 disabled:cursor-not-allowed
        `}
        title={listening ? "Stop listening" : "Start voice input"}
      >
        {listening ? (
          <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
            <Square size={14} fill="currentColor" />
          </motion.div>
        ) : (
          <Mic size={16} />
        )}
      </motion.button>

      {/* Text input — always typable, even while the mic listens */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        placeholder={listening ? "Listening — you can also type here…" : "Type a message…"}
        disabled={disabled}
        className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none disabled:cursor-not-allowed"
      />

      {/* Send button */}
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        onClick={handleSend}
        disabled={!value.trim() || disabled}
        className="
          w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors
          bg-sky-500 text-white hover:bg-sky-600
          disabled:opacity-30 disabled:cursor-not-allowed
        "
        title="Send"
      >
        <Send size={14} />
      </motion.button>
    </div>
  );
}
