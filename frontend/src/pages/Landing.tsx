import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Bot, Upload, GraduationCap, PhoneCall, MessageSquareText, BarChart3,
  ShieldCheck, ArrowRight, Globe, Zap, Users, Building2,
} from "lucide-react";

/**
 * Professional SaaS landing page (spec §2).
 * Explains the platform honestly: AI telecalling with custom agents, your own
 * knowledge, training, preview/voice testing, real phone calls when telephony
 * is configured. No fabricated claims, no neon/gaming styling.
 */

const FEATURES = [
  {
    icon: Bot,
    title: "Custom AI Agents",
    desc: "Create dedicated calling agents for admissions, follow-ups, or support. Every agent has its own name, voice, script, and personality.",
  },
  {
    icon: Upload,
    title: "Upload Your Knowledge",
    desc: "Upload PDF, DOCX, TXT, CSV, or XLSX documents. Your organization's information becomes the agent's grounding — nothing invented.",
  },
  {
    icon: GraduationCap,
    title: "Train & Validate",
    desc: "The training pipeline extracts, chunks, embeds, and indexes your documents into an isolated vector knowledge base — then validates retrieval before the agent goes live.",
  },
  {
    icon: MessageSquareText,
    title: "Test Before Publishing",
    desc: "Speak with the agent in a live voice preview using the exact same runtime that handles production calls. Preview unlocks only after training succeeds.",
  },
  {
    icon: PhoneCall,
    title: "Real Phone Calls",
    desc: "When telephony credentials are configured on the server, published agents place genuine outbound calls — the student's real phone rings.",
  },
  {
    icon: BarChart3,
    title: "Real Analytics",
    desc: "Interest levels, outcomes, questions asked, callbacks, and latency metrics — all computed from actual call records. No seeded numbers.",
  },
  {
    icon: Users,
    title: "Student Management",
    desc: "Add students manually or import CSV/XLSX lists. Track call status, attempts, interest, and full transcripts per student.",
  },
  {
    icon: ShieldCheck,
    title: "Multi-Tenant Isolation",
    desc: "Every user gets an isolated workspace. Agents, knowledge, students, calls, and analytics never mix between tenants.",
  },
];

const STEPS = [
  { n: "1", title: "Create your agent", desc: "Name it, describe the purpose, pick a voice and language." },
  { n: "2", title: "Upload knowledge", desc: "Your documents become the agent's grounded knowledge base." },
  { n: "3", title: "Train & validate", desc: "Real ingestion pipeline with validation — see every stage." },
  { n: "4", title: "Preview with voice", desc: "Talk to the agent before going live. Interruptions work." },
  { n: "5", title: "Publish & call", desc: "Add students and start real calling campaigns with live analytics." },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-white text-[var(--gray-800)]">
      {/* ── Nav ── */}
      <nav className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--sky-400)] to-[var(--sky-600)] flex items-center justify-center text-white font-bold text-sm">
            D
          </div>
          <span className="font-semibold text-[15px]">Doneswari AI Telecaller</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium text-[var(--gray-600)] hover:text-[var(--gray-800)] px-3 py-2">
            Sign In
          </Link>
          <Link
            to="/signup"
            className="text-sm font-semibold bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white rounded-lg px-4 py-2 transition-colors"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <header className="max-w-6xl mx-auto px-6 pt-16 pb-20 text-center">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--sky-700)] bg-[var(--sky-50)] border border-[var(--sky-200)] rounded-full px-3.5 py-1.5 mb-6">
            <Zap className="w-3.5 h-3.5" /> AI-powered telecalling platform
          </span>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight max-w-3xl mx-auto">
            AI calling agents that know your business
          </h1>
          <p className="text-[16px] md:text-[17px] text-[var(--gray-500)] max-w-2xl mx-auto mt-5 leading-relaxed">
            Upload your own knowledge, train a dedicated AI agent, and preview it with your voice —
            then let it handle student and customer calls with grounded answers, real transcripts,
            and honest analytics.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            <Link
              to="/signup"
              className="flex items-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white font-semibold text-sm rounded-lg px-6 py-3 shadow-[var(--shadow-md)] transition-colors"
            >
              Create Your Agent <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/login"
              className="text-sm font-semibold text-[var(--gray-700)] bg-white hover:bg-[var(--gray-50)] border border-[var(--gray-200)] rounded-lg px-6 py-3 transition-colors"
            >
              Sign In
            </Link>
          </div>
        </motion.div>

        {/* Hero visual: product flow strip */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="mt-14 grid grid-cols-2 md:grid-cols-5 gap-3 max-w-4xl mx-auto"
        >
          {STEPS.map((s) => (
            <div key={s.n} className="glass rounded-[var(--radius-md)] p-4 text-left shadow-[var(--shadow-sm)]">
              <div className="w-7 h-7 rounded-lg bg-[var(--sky-50)] text-[var(--sky-700)] font-bold text-[13px] flex items-center justify-center mb-2.5">
                {s.n}
              </div>
              <div className="text-[13.5px] font-semibold">{s.title}</div>
              <div className="text-[11.5px] text-[var(--gray-500)] mt-1 leading-snug">{s.desc}</div>
            </div>
          ))}
        </motion.div>
      </header>

      {/* ── Features ── */}
      <section className="bg-[var(--gray-50)] border-y border-[var(--gray-100)] py-16">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold">Everything a calling team needs</h2>
            <p className="text-sm text-[var(--gray-500)] mt-2">
              A complete multi-agent workspace — grounded in your documents, measured in real time.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white border border-[var(--gray-100)] rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)]">
                <div className="w-9 h-9 rounded-xl bg-[var(--sky-50)] text-[var(--sky-600)] flex items-center justify-center mb-3">
                  <f.icon className="w-4.5 h-4.5" />
                </div>
                <div className="text-[14.5px] font-semibold">{f.title}</div>
                <p className="text-[12.5px] text-[var(--gray-500)] mt-1.5 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Honest telephony note ── */}
      <section className="max-w-4xl mx-auto px-6 py-14">
        <div className="rounded-[var(--radius-md)] border border-[var(--sky-200)] bg-[var(--sky-50)] p-6 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-white text-[var(--sky-600)] flex items-center justify-center shrink-0">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-[15.5px] font-semibold">About real phone calls</h3>
            <p className="text-[13.5px] text-[var(--gray-600)] leading-relaxed mt-1.5">
              The platform places genuine outbound calls when telephony credentials (Twilio or a
              compatible provider) are configured by the operator on the server. Voice previews in
              the browser use the same agent runtime and work immediately. Call statuses, durations,
              and transcripts always come from real provider events — never simulations.
            </p>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="max-w-6xl mx-auto px-6 pb-20 text-center">
        <div className="rounded-[var(--radius-lg)] bg-gradient-to-br from-[var(--sky-500)] to-[var(--sky-700)] text-white p-10">
          <Building2 className="w-8 h-8 mx-auto mb-4 opacity-90" />
          <h2 className="text-2xl font-bold">Ready to build your first agent?</h2>
          <p className="text-[14px] opacity-90 mt-2 max-w-xl mx-auto">
            Set up a workspace, upload your knowledge, and have a working AI caller in minutes.
          </p>
          <Link
            to="/signup"
            className="inline-flex items-center gap-2 bg-white text-[var(--sky-700)] font-semibold text-sm rounded-lg px-6 py-3 mt-6 hover:bg-[var(--sky-50)] transition-colors"
          >
            Get Started — it's free <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--gray-100)] py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-3 text-[12.5px] text-[var(--gray-400)]">
          <span>© {new Date().getFullYear()} Doneswari AI Telecaller</span>
          <span>Multi-tenant · Agent-isolated · Grounded answers</span>
        </div>
      </footer>
    </div>
  );
}
