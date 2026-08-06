import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  Volume2,
  Send,
  Loader2,
  Phone,
  PhoneOff,
  Globe,
  User,
  Bot,
} from "lucide-react";
import { useVoiceAgent } from "../hooks/useVoiceAgent";
import Markdown from "./Markdown";
import { useTranslation } from "../i18n";

const STAGE_LABEL_KEYS: Record<string, string> = {
  connecting: "connecting",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  idle: "idle",
  error: "error",
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function AICallSimulator({
  instituteId = 1,
  onClose,
}: {
  instituteId?: number;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const {
    callStage,
    messages,
    inputText,
    setInputText,
    isListening,
    detectedLanguage,
    startCall,
    endCall,
    sendMessage,
    toggleListening,
    audioRef,
  } = useVoiceAgent({ mode: "process", instituteId, silenceTimeoutMs: 2000 });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleEnd = async () => {
    await endCall();
    onClose?.();
  };

  if (callStage === "idle") {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card rounded-3xl p-8 border border-white/10 backdrop-blur-xl bg-white/5 max-w-md w-full mx-4"
        >
          <div className="text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center mx-auto">
              <Phone className="w-10 h-10 text-purple-400" />
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-2">
                {t("aiCallSimulator")}
              </h2>
              <p className="text-slate-400 text-sm">
                Real-time voice conversation with AI
              </p>
            </div>

            <button
              onClick={() => startCall()}
              className="w-full py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <Phone className="w-5 h-5" />
              {t("startCall")}
            </button>

            <button
              onClick={onClose}
              className="w-full py-3 bg-white/5 border border-white/10 rounded-xl font-medium hover:bg-white/10 transition-colors"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="p-4 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center">
              <Phone className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <h3 className="font-semibold">{t("aiCallSimulator")}</h3>
              <p className="text-xs text-slate-400">Real-time conversation</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Globe className="w-4 h-4 text-slate-400" />
              <span>{detectedLanguage}</span>
            </div>
            <button
              onClick={handleEnd}
              className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 flex items-center justify-center hover:bg-red-500/30 transition-colors"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 min-h-0">
          {/* Avatar */}
          <div className="relative mb-6">
            <div
              className={`w-32 h-32 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center ${
                callStage === "listening" ? "animate-pulse" : ""
              }`}
            >
              {callStage === "listening" && (
                <Mic className="w-16 h-16 text-purple-400" />
              )}
              {callStage === "thinking" && (
                <Loader2 className="w-16 h-16 text-blue-400 animate-spin" />
              )}
              {callStage === "speaking" && (
                <Volume2 className="w-16 h-16 text-green-400" />
              )}
              {callStage === "connecting" && (
                <Loader2 className="w-16 h-16 text-yellow-400 animate-spin" />
              )}
            </div>

            {/* Status */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-medium backdrop-blur-xl border border-white/10 whitespace-nowrap">
              <span
                className={
                  callStage === "listening"
                    ? "text-green-400"
                    : callStage === "thinking"
                    ? "text-blue-400"
                    : callStage === "speaking"
                    ? "text-purple-400"
                    : "text-yellow-400"
                }
              >
                {t(STAGE_LABEL_KEYS[callStage] || "idle")}
              </span>
            </div>
          </div>

          {/* Wave Animation */}
          {callStage === "speaking" && (
            <div className="flex items-center gap-1 mb-6">
              {[...Array(5)].map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1 bg-purple-400 rounded-full"
                  animate={{ height: [10, 30, 10] }}
                  transition={{
                    duration: 0.5,
                    repeat: Infinity,
                    delay: i * 0.1,
                  }}
                />
              ))}
            </div>
          )}

          {/* Messages */}
          <div
            ref={scrollRef}
            className="w-full max-w-2xl space-y-4 overflow-y-auto max-h-64 px-2 scroll-smooth"
          >
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={`${msg.timestamp}-${idx}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-3 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`flex gap-2 max-w-[80%] min-w-0 ${
                      msg.role === "user" ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                        msg.role === "user"
                          ? "bg-purple-500/20 text-purple-400"
                          : "bg-blue-500/20 text-blue-400"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <User className="w-5 h-5" />
                      ) : (
                        <Bot className="w-5 h-5" />
                      )}
                    </div>
                    <div
                      className={`p-4 rounded-2xl min-w-0 break-words ${
                        msg.role === "user"
                          ? "bg-purple-500/20 border border-purple-500/30"
                          : "bg-blue-500/20 border border-blue-500/30"
                      }`}
                    >
                      {msg.role === "ai" ? (
                        <Markdown text={msg.content} />
                      ) : (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      )}
                      <div className="mt-1.5 text-[10px] text-slate-500 text-right">
                        {formatTime(msg.timestamp)}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Input */}
          <div className="w-full max-w-2xl mt-6 flex gap-2">
            <button
              onClick={toggleListening}
              disabled={callStage !== "listening"}
              className={`p-4 rounded-xl transition-all ${
                isListening
                  ? "bg-red-500/20 text-red-400 border border-red-500/30"
                  : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
              } disabled:opacity-50`}
              title={isListening ? "Stop listening" : "Start listening"}
            >
              <Mic className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder={t("typeMessage")}
              disabled={callStage !== "listening"}
              className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-500/50 disabled:opacity-50 min-w-0"
            />
            <button
              onClick={() => sendMessage()}
              disabled={!inputText.trim() || callStage !== "listening"}
              className="px-5 py-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-medium hover:opacity-90 transition-all disabled:opacity-50"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
