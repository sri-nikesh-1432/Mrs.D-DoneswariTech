import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ConversationMessage } from "../types";

interface ConversationViewProps {
  messages: ConversationMessage[];
  agentName?: string;
  partialAgent?: string;
  partialUser?: string;
}

export default function ConversationView({
  messages,
  agentName = "Mrs.D",
  partialAgent,
  partialUser,
}: ConversationViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, partialAgent, partialUser]);

  const allMessages = [...messages];
  if (partialUser) allMessages.push({ role: "user", content: partialUser, timestamp: "", partial: true });

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 min-h-0">
      <AnimatePresence initial={false}>
        {allMessages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role !== "user" && (
              <div
                className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold mt-0.5"
                style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
              >
                M
              </div>
            )}
            <div className={`max-w-[75%] ${msg.role === "user" ? "" : ""}`}>
              {msg.role !== "user" && (
                <p className="text-[10px] font-semibold text-sky-500 mb-0.5 ml-1">{agentName}</p>
              )}
              <div
                className={`
                  px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed
                  ${msg.role === "user"
                    ? "bg-sky-500 text-white rounded-tr-sm"
                    : "bg-white text-gray-700 rounded-tl-sm border border-sky-100 shadow-sm"
                  }
                  ${msg.partial ? "opacity-70" : ""}
                `}
              >
                {msg.content}
                {msg.partial && (
                  <span className="inline-flex gap-0.5 ml-1">
                    {[0, 0.2, 0.4].map((d) => (
                      <motion.span
                        key={d}
                        className="inline-block w-1 h-1 bg-current rounded-full opacity-60"
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: d }}
                      />
                    ))}
                  </span>
                )}
              </div>
              {msg.timestamp && (
                <p className={`text-[9px] text-gray-400 mt-0.5 ${msg.role === "user" ? "text-right" : "text-left ml-1"}`}>
                  {msg.timestamp}
                </p>
              )}
            </div>
          </motion.div>
        ))}

        {/* Streaming agent response */}
        {partialAgent && (
          <motion.div
            key="agent-partial"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-2 justify-start"
          >
            <div
              className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold mt-0.5"
              style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
            >
              M
            </div>
            <div>
              <p className="text-[10px] font-semibold text-sky-500 mb-0.5 ml-1">{agentName}</p>
              <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-sm text-sm leading-relaxed bg-white text-gray-700 border border-sky-100 shadow-sm opacity-80">
                {partialAgent}
                <span className="inline-flex gap-0.5 ml-1">
                  {[0, 0.2, 0.4].map((d) => (
                    <motion.span
                      key={d}
                      className="inline-block w-1 h-1 bg-sky-400 rounded-full"
                      animate={{ y: [0, -4, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: d }}
                    />
                  ))}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {allMessages.length === 0 && !partialAgent && (
        <div className="flex flex-col items-center justify-center h-32 gap-2 opacity-40">
          <p className="text-xs text-gray-400">Start a conversation by pressing the mic or typing below</p>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
