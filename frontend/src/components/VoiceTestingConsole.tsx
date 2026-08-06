import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Play,
  RefreshCw,
  Zap,
  Brain,
  Volume2,
  User,
  Bot,
  Loader2,
  Mic,
  Send,
  Globe,
  Phone,
  PhoneOff,
  Maximize2,
} from "lucide-react";
import { useVoiceAgent } from "../hooks/useVoiceAgent";
import Markdown from "./Markdown";
import LanguageSwitcher from "./LanguageSwitcher";
import { useTranslation } from "../i18n";
import { saveSimulatorCall } from "../services/api";

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

export default function VoiceTestingConsole() {
  const navigate = useNavigate();
  const { t, lang } = useTranslation();
  const [showDebug, setShowDebug] = React.useState(true);

  // THE MOST IMPORTANT RULE: the Testing Console uses backend/knowledge/institute.json ONLY.
  // Hardcoded, for developers, and completely isolated from the uploaded-PDF FAISS knowledge.
  const KNOWLEDGE_FILE = "institute.json";

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startedAtRef = useRef(Date.now());

  const {
    callStage,
    messages,
    inputText,
    setInputText,
    isListening,
    debugInfo,
    detectedLanguage,
    conversationId,
    startCall,
    endCall,
    sendMessage,
    toggleListening,
    audioRef,
  } = useVoiceAgent({ mode: "test", knowledgeFile: KNOWLEDGE_FILE, initialLanguage: lang });

  // Auto-scroll to newest message
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Track when the call starts (for duration)
  useEffect(() => {
    if (callStage === "connecting") startedAtRef.current = Date.now();
  }, [callStage]);

  // Free backend memory if the user navigates away
  useEffect(() => {
    return () => {
      endCall();
    };
  }, [endCall]);

  const handleEnd = async () => {
    const transcript = messages.map((m) => ({
      speaker: m.role === "user" ? "USER" : "AI",
      text: m.content,
    }));
    const duration = Math.max(
      1,
      Math.floor((Date.now() - startedAtRef.current) / 1000)
    );
    try {
      await saveSimulatorCall({
        call_id: conversationId.current,
        institute_id: 1,
        duration,
        language: detectedLanguage,
        status: "completed",
        transcript,
      });
    } catch (e) {
      console.error("Failed to save call:", e);
    }
    await endCall();
  };

  if (callStage === "idle") {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 backdrop-blur-2xl rounded-3xl border border-white/10 p-12 shadow-2xl max-w-2xl w-full mx-4"
        >
          <div className="text-center space-y-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 150 }}
              className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center mx-auto border-2 border-purple-500/50 shadow-xl shadow-purple-500/30"
            >
              <Bot className="w-12 h-12 text-purple-300" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
                {t("testingConsole")}
              </h1>
              <p className="text-slate-400 text-lg">
                Developer mode with hardcoded knowledge
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="max-w-md mx-auto"
            >
              <div className="bg-white/5 border border-purple-500/30 rounded-xl px-6 py-4">
                <div className="text-xs text-slate-500 uppercase tracking-wider mb-1 text-left">
                  {t("knowledgeSource")}
                </div>
                <div className="font-mono text-purple-300 text-sm text-left">
                  backend/knowledge/institute.json
                </div>
                <div className="text-xs text-slate-500 mt-2 text-left">
                  Hardcoded · for developers only · never merged with uploaded
                  PDFs
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              <button
                onClick={() => startCall()}
                className="px-12 py-5 bg-gradient-to-r from-purple-500 to-blue-500 rounded-2xl font-semibold text-lg hover:opacity-90 transition-all hover:scale-105 flex items-center justify-center gap-3 mx-auto shadow-xl shadow-purple-500/30"
              >
                <Phone className="w-6 h-6" />
                {t("startVoiceAgent")}
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="flex items-center justify-center gap-8 text-sm text-slate-500 pt-4"
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span>Continuous voice</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-400" />
                <span>Auto language detection</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-400" />
                <span>Real-time STT & TTS</span>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 flex overflow-hidden">
        {/* Voice Agent (Center) */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 relative min-w-0">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative mb-8"
          >
            <div
              className={`w-48 h-48 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center border-2 border-purple-500/50 shadow-2xl shadow-purple-500/30 ${
                callStage === "listening" ? "animate-pulse" : ""
              }`}
            >
              {callStage === "listening" && (
                <Mic className="w-24 h-24 text-purple-300" />
              )}
              {callStage === "thinking" && (
                <Loader2 className="w-24 h-24 text-blue-400 animate-spin" />
              )}
              {callStage === "speaking" && (
                <Volume2 className="w-24 h-24 text-green-400" />
              )}
              {callStage === "connecting" && (
                <Loader2 className="w-24 h-24 text-yellow-400 animate-spin" />
              )}
            </div>

            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-6 py-2 rounded-full text-sm font-medium backdrop-blur-xl border border-white/20 bg-black/30 whitespace-nowrap"
            >
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
            </motion.div>
          </motion.div>

          {callStage === "speaking" && (
            <div className="flex items-center gap-1 mb-8">
              {[...Array(9)].map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1.5 bg-gradient-to-t from-purple-500 to-blue-500 rounded-full"
                  animate={{ height: [15, 50, 15] }}
                  transition={{
                    duration: 0.6,
                    repeat: Infinity,
                    delay: i * 0.06,
                  }}
                />
              ))}
            </div>
          )}

          {/* Messages — full conversation, auto-scroll, timestamps, markdown */}
          <div
            ref={scrollRef}
            className="w-full max-w-3xl space-y-4 overflow-y-auto max-h-64 px-2 scroll-smooth"
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
                    className={`flex gap-3 max-w-[85%] min-w-0 ${
                      msg.role === "user" ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                        msg.role === "user"
                          ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                          : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <User className="w-6 h-6" />
                      ) : (
                        <Bot className="w-6 h-6" />
                      )}
                    </div>
                    <div
                      className={`p-5 rounded-2xl min-w-0 break-words ${
                        msg.role === "user"
                          ? "bg-purple-500/20 border border-purple-500/30"
                          : "bg-blue-500/20 border border-blue-500/30"
                      }`}
                    >
                      {msg.role === "ai" ? (
                        <Markdown text={msg.content} />
                      ) : (
                        <p className="text-base leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      )}
                      <div className="mt-2 text-[11px] text-slate-500 text-right">
                        {formatTime(msg.timestamp)}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Developer Console (Right) */}
        <div className="w-[450px] border-l border-white/10 flex flex-col bg-black/30 backdrop-blur-2xl hidden lg:flex">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">
                {t("developerConsole")}
              </h3>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 text-sm bg-white/5 px-3 py-1.5 rounded-lg">
                  <Globe className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-300">{detectedLanguage}</span>
                </div>
                <LanguageSwitcher compact />
              </div>
            </div>

            <div className="flex gap-2">
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
                <Mic className="w-6 h-6" />
              </button>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder={t("typeMessage")}
                disabled={callStage !== "listening"}
                className="flex-1 px-5 py-4 bg-white/5 border border-white/10 rounded-xl text-base focus:outline-none focus:border-purple-500/50 disabled:opacity-50 min-w-0"
              />

              <button
                onClick={() => sendMessage()}
                disabled={!inputText.trim() || callStage !== "listening"}
                className="px-6 py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-medium hover:opacity-90 transition-all disabled:opacity-50"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>

          {showDebug && debugInfo && (
            <div className="p-6 border-b border-white/10 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-300">
                  {t("pipelineDebug")}
                </span>
                <RefreshCw className="w-4 h-4 text-slate-400" />
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs">
                    {t("retrieval")}
                  </div>
                  <div className="font-mono text-green-400 text-lg">
                    {debugInfo.retrieval_time_ms}ms
                  </div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs">{t("llm")}</div>
                  <div className="font-mono text-blue-400 text-lg">
                    {debugInfo.llm_time_ms}ms
                  </div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs">{t("tts")}</div>
                  <div className="font-mono text-purple-400 text-lg">
                    {debugInfo.tts_time_ms}ms
                  </div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs">{t("total")}</div>
                  <div className="font-mono text-white text-lg">
                    {debugInfo.total_time_ms}ms
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm bg-white/5 p-3 rounded-xl border border-white/10">
                <Brain className="w-4 h-4 text-purple-400" />
                <span className="text-slate-300">
                  {t("chunksRetrieved")}: {debugInfo.chunks_retrieved}
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm bg-white/5 p-3 rounded-xl border border-white/10">
                <Zap className="w-4 h-4 text-blue-400" />
                <span className="text-slate-300">
                  {t("knowledgeSource")}: {debugInfo.knowledge_source}
                </span>
              </div>
            </div>
          )}

          <div className="p-6 border-b border-white/10">
            <div className="text-sm font-medium text-slate-300 mb-3">
              {t("quickCommands")}
            </div>
            <div className="space-y-2 text-sm">
              <div className="bg-purple-500/10 border border-purple-500/30 p-3 rounded-xl">
                <div className="text-purple-400 font-mono text-base">
                  /insert &lt;content&gt;
                </div>
                <div className="text-slate-400 mt-1 text-xs">
                  {t("uploadKnowledge")}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            <div className="text-sm font-medium text-slate-300 mb-4 sticky top-0 bg-black/30 backdrop-blur-2xl py-2">
              {t("conversationLog")}
            </div>
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <div
                  key={`log-${msg.timestamp}-${idx}`}
                  className={`text-sm p-4 rounded-xl border ${
                    msg.role === "user"
                      ? "bg-purple-500/10 border-purple-500/30"
                      : "bg-blue-500/10 border-blue-500/30"
                  }`}
                >
                  <div className="font-medium mb-2 flex items-center gap-2 text-slate-300">
                    {msg.role === "user" ? t("you") : t("ai")}
                    <span className="ml-auto text-[11px] text-slate-500">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                  <div className="text-slate-400 whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                </div>
              ))}
            </AnimatePresence>
          </div>

          <div className="p-6 border-t border-white/10 space-y-3">
            <button
              onClick={() => navigate(`/active-call?knowledge=${KNOWLEDGE_FILE}`)}
              className="w-full py-3 bg-white/5 border border-white/10 rounded-xl font-medium hover:bg-white/10 transition-all flex items-center justify-center gap-3 text-slate-300"
            >
              <Maximize2 className="w-4 h-4" />
              {t("openFullScreen")}
            </button>
            <button
              onClick={handleEnd}
              className="w-full py-4 bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl font-medium hover:bg-red-500/30 transition-all flex items-center justify-center gap-3"
            >
              <PhoneOff className="w-5 h-5" />
              {t("endCall")}
            </button>
          </div>
        </div>
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
