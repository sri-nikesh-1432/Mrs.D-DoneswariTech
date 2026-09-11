import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, User, BookOpen, MapPin, DollarSign, Home, Bus, Flame, Clock, AlertCircle } from "lucide-react";
import type { CallerMemory } from "../types";

interface MemoryPanelProps {
  memory: CallerMemory;
  interestScore?: number;
  conversionLikelihood?: number;
  leadIntent?: "HOT" | "WARM" | "COLD" | "";
}

const intentColors = {
  HOT:  { bg: "bg-red-50",  text: "text-red-600",  border: "border-red-200",  dot: "bg-red-500"  },
  WARM: { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200", dot: "bg-orange-400" },
  COLD: { bg: "bg-blue-50", text: "text-blue-600",  border: "border-blue-200", dot: "bg-blue-400"  },
  "":   { bg: "bg-gray-50", text: "text-gray-500",  border: "border-gray-200", dot: "bg-gray-300"  },
};

interface FieldRow {
  key: keyof CallerMemory;
  label: string;
  icon: React.ReactNode;
}

const fields: FieldRow[] = [
  { key: "caller_name",        label: "Caller",    icon: <User size={13} /> },
  { key: "student_name",       label: "Student",   icon: <User size={13} /> },
  { key: "student_class",      label: "Class",     icon: <BookOpen size={13} /> },
  { key: "course_interest",    label: "Course",    icon: <BookOpen size={13} /> },
  { key: "location",           label: "Location",  icon: <MapPin size={13} /> },
  { key: "budget",             label: "Budget",    icon: <DollarSign size={13} /> },
  { key: "hostel",             label: "Hostel",    icon: <Home size={13} /> },
  { key: "transport",          label: "Transport", icon: <Bus size={13} /> },
  { key: "objections",         label: "Objections",icon: <AlertCircle size={13} /> },
  { key: "preferred_callback", label: "Callback",  icon: <Clock size={13} /> },
];

export default function MemoryPanel({ memory, interestScore, conversionLikelihood, leadIntent = "" }: MemoryPanelProps) {
  const ic = intentColors[leadIntent ?? ""] ?? intentColors[""];
  const hasAnyData = fields.some((f) => memory[f.key]);

  return (
    <div
      className="flex flex-col h-full rounded-2xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.72)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(186,230,253,0.5)",
        boxShadow: "0 4px 24px rgba(14,165,233,0.08)",
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-sky-100 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-sky-100 flex items-center justify-center">
          <Brain size={14} className="text-sky-500" />
        </div>
        <span className="text-sm font-semibold text-gray-700">Caller Memory</span>
        {leadIntent && (
          <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full border ${ic.bg} ${ic.text} ${ic.border}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${ic.dot}`} />
            {leadIntent}
          </span>
        )}
      </div>

      {/* Scores */}
      {(interestScore !== undefined || conversionLikelihood !== undefined) && (
        <div className="px-4 py-3 border-b border-sky-50 grid grid-cols-2 gap-2">
          {interestScore !== undefined && (
            <ScoreBar label="Interest" value={interestScore} color="#0ea5e9" />
          )}
          {conversionLikelihood !== undefined && (
            <ScoreBar label="Conversion" value={conversionLikelihood} color="#10b981" />
          )}
        </div>
      )}

      {/* Fields */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {!hasAnyData && (
          <div className="flex flex-col items-center justify-center py-8 gap-2 opacity-50">
            <Brain size={28} className="text-sky-300" />
            <p className="text-xs text-gray-400 text-center">Memory updates as the conversation progresses</p>
          </div>
        )}

        <AnimatePresence>
          {fields.map((field) => {
            const val = memory[field.key];
            if (!val) return null;
            return (
              <motion.div
                key={field.key}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
                className="flex items-start gap-2 px-2 py-2 rounded-xl hover:bg-sky-50 transition-colors"
              >
                <span className="text-sky-400 mt-0.5 shrink-0">{field.icon}</span>
                <div className="min-w-0">
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide leading-none mb-0.5">
                    {field.label}
                  </p>
                  <p className="text-xs font-medium text-gray-700 break-words">{val}</p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-[10px] text-gray-400 font-medium">{label}</span>
        <span className="text-[10px] font-bold" style={{ color }}>{value}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
