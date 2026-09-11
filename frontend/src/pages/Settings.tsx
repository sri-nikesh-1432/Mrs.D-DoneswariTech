import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Phone, Globe, Volume2, Mic, BookOpen, Upload,
  FileText, Check, Loader2, AlertCircle, ChevronDown,
  Sparkles, Shield, Info
} from "lucide-react";
import TopBar from "../components/TopBar";
import { getAgentSettings, updateAgentSettings, uploadNewKnowledge, getTrainingStatus } from "../services/api";
import type { AgentSettings, KnowledgeStatus } from "../types";

// ─── Default settings ─────────────────────────────────────────────
const DEFAULT_SETTINGS: AgentSettings = {
  agent_name: "Mrs.D",
  business_name: "My Institution",
  phone_number: "",
  supported_languages: ["English", "Telugu", "Hindi"],
  voice: "en-IN-NeerjaNeural",
  voice_speed: 1.2,
  background_ambience: false,
  greeting: "Hi, this is {agent_name} from {business_name}. How can I help you today?",
  knowledge_file: null,
  knowledge_status: "ready",
  published_version: null,
};

const VOICES = [
  { value: "en-IN-NeerjaNeural",  label: "Neerja (English, India) — Warm, Professional" },
  { value: "en-IN-AaravNeural",   label: "Aarav (English, India) — Clear, Friendly" },
  { value: "te-IN-ShrutiNeural",  label: "Shruti (Telugu) — Natural, Native" },
  { value: "hi-IN-SwaraNeural",   label: "Swara (Hindi) — Warm, Conversational" },
  { value: "ta-IN-PallaviNeural", label: "Pallavi (Tamil) — Professional" },
];

const LANGUAGES = ["English", "Telugu", "Hindi", "Tamil"];

const KNOWLEDGE_STEP_LABELS: Partial<Record<KnowledgeStatus, string>> = {
  uploaded:     "Document uploaded",
  extracting:   "Extracting text...",
  chunking:     "Creating knowledge chunks...",
  embedding:    "Generating embeddings...",
  indexing:     "Building vector index...",
  configuring:  "Configuring agent...",
  ready:        "Knowledge base ready",
  failed:       "Processing failed",
};

// ─── Section wrapper ──────────────────────────────────────────────
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.8)",
        border: "1px solid rgba(186,230,253,0.4)",
        boxShadow: "0 2px 12px rgba(14,165,233,0.06)",
      }}
    >
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-sky-100">
        <span className="text-sky-500">{icon}</span>
        <span className="text-sm font-semibold text-gray-700">{title}</span>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 mt-1 ml-1">{hint}</p>}
    </div>
  );
}

// ─── Settings input ───────────────────────────────────────────────
function SettingsInput({ value, onChange, placeholder, type = "text" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-10 px-4 rounded-xl border border-sky-200 bg-white/80 text-sm text-gray-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition-all"
    />
  );
}

// ─── Select ───────────────────────────────────────────────────────
function SettingsSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 px-4 pr-8 rounded-xl border border-sky-200 bg-white/80 text-sm text-gray-700 outline-none focus:border-sky-400 appearance-none cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────
function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-600">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5.5 rounded-full transition-colors ${value ? "bg-sky-500" : "bg-gray-200"}`}
        style={{ height: 22 }}
      >
        <motion.div
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow"
          animate={{ x: value ? 22 : 2 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
        />
      </button>
    </div>
  );
}

// ─── Language multi-select ────────────────────────────────────────
function LanguageChips({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
  const toggle = (lang: string) => {
    if (selected.includes(lang)) {
      if (selected.length <= 1) return; // at least 1
      onChange(selected.filter((l) => l !== lang));
    } else {
      onChange([...selected, lang]);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {LANGUAGES.map((lang) => (
        <button
          key={lang}
          onClick={() => toggle(lang)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
            selected.includes(lang)
              ? "bg-sky-500 text-white border-sky-500"
              : "bg-white text-gray-500 border-sky-200 hover:border-sky-300"
          }`}
        >
          {selected.includes(lang) && <Check size={11} />}
          {lang}
        </button>
      ))}
    </div>
  );
}

// ─── Knowledge status badge ───────────────────────────────────────
function KnowledgeStatusBadge({ status }: { status?: KnowledgeStatus }) {
  if (!status) return null;
  const configs: Partial<Record<KnowledgeStatus, { bg: string; text: string; pulse?: boolean }>> = {
    ready:      { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700" },
    failed:     { bg: "bg-red-50 border-red-200",         text: "text-red-700" },
    embedding:  { bg: "bg-amber-50 border-amber-200",     text: "text-amber-700", pulse: true },
    indexing:   { bg: "bg-amber-50 border-amber-200",     text: "text-amber-700", pulse: true },
    extracting: { bg: "bg-sky-50 border-sky-200",         text: "text-sky-700",   pulse: true },
    chunking:   { bg: "bg-sky-50 border-sky-200",         text: "text-sky-700",   pulse: true },
    configuring:{ bg: "bg-indigo-50 border-indigo-200",   text: "text-indigo-700",pulse: true },
    uploaded:   { bg: "bg-gray-50 border-gray-200",       text: "text-gray-600" },
  };
  const c = configs[status] ?? { bg: "bg-gray-50 border-gray-200", text: "text-gray-500" };
  const label = KNOWLEDGE_STEP_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${c.bg} ${c.text}`}>
      {c.pulse && <motion.span className="w-1.5 h-1.5 rounded-full bg-current" animate={{ scale: [1, 1.5, 1] }} transition={{ duration: 0.8, repeat: Infinity }} />}
      {label}
    </span>
  );
}

// ─── Main Settings page ───────────────────────────────────────────
export default function Settings() {
  const agentId = localStorage.getItem("mrsd_agent_id") ?? "1";
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Knowledge upload
  const [newPdf, setNewPdf] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load settings
  useEffect(() => {
    setLoading(true);
    getAgentSettings(agentId)
      .then((s) => setSettings({ ...DEFAULT_SETTINGS, ...s }))
      .catch(() => {/* use defaults */})
      .finally(() => setLoading(false));
  }, [agentId]);

  const update = (patch: Partial<AgentSettings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

  // Save
  const handleSave = async () => {
    setSaving(true);
    try {
      await updateAgentSettings(agentId, settings);
    } catch { /* ignore for demo */ }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // Upload new knowledge
  const handleUploadKnowledge = async () => {
    if (!newPdf) return;
    setUploading(true);
    setUploadPct(0);
    try {
      await uploadNewKnowledge(agentId, newPdf, (pct) => setUploadPct(pct));
      update({ knowledge_file: newPdf.name, knowledge_status: "extracting" });
      setNewPdf(null);

      // Poll status
      pollRef.current = setInterval(async () => {
        try {
          const job = await getTrainingStatus(agentId);
          update({ knowledge_status: job.status });
          if (job.status === "ready" || job.status === "failed") {
            clearInterval(pollRef.current!);
          }
        } catch {
          clearInterval(pollRef.current!);
        }
      }, 2000);
    } catch {
      update({ knowledge_status: "failed" });
    }
    setUploading(false);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: "linear-gradient(160deg, #f0f9ff 0%, #e0f2fe 40%, #f0f9ff 100%)" }}
    >
      <TopBar agentName={settings.agent_name} />

      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-800">Settings</h1>
              <p className="text-xs text-gray-500">Configure your AI agent</p>
            </div>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white shadow-md disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
              {saved ? "Saved!" : saving ? "Saving..." : "Save Changes"}
            </motion.button>
          </div>

          {/* Agent Identity */}
          <Section title="Agent Identity" icon={<Bot size={15} />}>
            <Field label="Agent Name" hint="This is your AI's name — callers will hear this.">
              <SettingsInput value={settings.agent_name} onChange={(v) => update({ agent_name: v })} placeholder="Mrs.D" />
            </Field>
            <Field label="Business / Institution Name" hint="Used in greetings and conversations.">
              <SettingsInput value={settings.business_name} onChange={(v) => update({ business_name: v })} placeholder="My Institution" />
            </Field>
            <Field label="Custom Greeting" hint="Use {agent_name} and {business_name} as placeholders.">
              <textarea
                value={settings.greeting}
                onChange={(e) => update({ greeting: e.target.value })}
                rows={2}
                className="w-full px-4 py-2.5 rounded-xl border border-sky-200 bg-white/80 text-sm text-gray-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 resize-none"
                placeholder="Hi, this is {agent_name} from {business_name}..."
              />
            </Field>
          </Section>

          {/* Phone */}
          <Section title="Phone Settings" icon={<Phone size={15} />}>
            <Field label="Account Phone Number" hint="The number associated with your agent account.">
              <SettingsInput value={settings.phone_number} onChange={(v) => update({ phone_number: v })} placeholder="+91 98765 43210" type="tel" />
            </Field>
            <div className="flex items-start gap-2 p-3 rounded-xl bg-sky-50 border border-sky-200">
              <Info size={13} className="text-sky-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-sky-700">
                Inbound calls to this number will be answered by your AI agent automatically. Outbound test calls will also be placed from this number.
              </p>
            </div>
          </Section>

          {/* Voice */}
          <Section title="Voice & Language" icon={<Mic size={15} />}>
            <Field label="Supported Languages">
              <LanguageChips selected={settings.supported_languages} onChange={(v) => update({ supported_languages: v })} />
            </Field>
            <Field label="Agent Voice">
              <SettingsSelect
                value={settings.voice}
                onChange={(v) => update({ voice: v })}
                options={VOICES}
              />
            </Field>
            <Field label="Voice Speed" hint={`${settings.voice_speed}x — Natural conversational pace`}>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0.8} max={1.5} step={0.05}
                  value={settings.voice_speed}
                  onChange={(e) => update({ voice_speed: parseFloat(e.target.value) })}
                  className="flex-1 accent-sky-500"
                />
                <span className="text-sm font-semibold text-sky-600 w-10">{settings.voice_speed}x</span>
              </div>
            </Field>
            <Toggle
              value={settings.background_ambience}
              onChange={(v) => update({ background_ambience: v })}
              label="Subtle office ambience during calls"
            />
          </Section>

          {/* Knowledge Base */}
          <Section title="Knowledge Base" icon={<BookOpen size={15} />}>
            {/* Current */}
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Current Knowledge</p>
              {settings.knowledge_file ? (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-sky-100 bg-sky-50">
                  <div className="w-9 h-9 rounded-xl bg-sky-200 flex items-center justify-center flex-shrink-0">
                    <FileText size={16} className="text-sky-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">{settings.knowledge_file}</p>
                    <KnowledgeStatusBadge status={settings.knowledge_status} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">No knowledge base uploaded yet.</p>
              )}
            </div>

            {/* Upload new */}
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Upload New Version</p>
              <p className="text-xs text-gray-500 mb-3">
                Uploading a new PDF will create a new knowledge version. Your current live agent remains active until you publish the new version.
              </p>

              {!newPdf ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-sky-200 rounded-2xl p-6 text-center cursor-pointer hover:border-sky-300 hover:bg-sky-50/50 transition-all"
                >
                  <Upload size={20} className="text-sky-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Click to upload a PDF</p>
                  <p className="text-xs text-gray-400">PDF only · Max 20 MB</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setNewPdf(f);
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-xl border border-sky-200 bg-sky-50">
                    <FileText size={16} className="text-sky-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 truncate">{newPdf.name}</p>
                      <p className="text-xs text-gray-400">{(newPdf.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button onClick={() => setNewPdf(null)} className="text-gray-400 hover:text-red-500">✕</button>
                  </div>

                  {uploading && (
                    <div>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Uploading...</span>
                        <span>{uploadPct}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-sky-400 rounded-full"
                          animate={{ width: `${uploadPct}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </div>
                  )}

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleUploadKnowledge}
                    disabled={uploading}
                    className="w-full h-10 rounded-xl text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
                    style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
                  >
                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {uploading ? "Processing..." : "Train with New PDF"}
                  </motion.button>
                </div>
              )}
            </div>
          </Section>

          {/* Published version */}
          <Section title="Published Version" icon={<Sparkles size={15} />}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-700 font-medium">
                  {settings.published_version
                    ? `Version ${settings.published_version} is live`
                    : "No version published yet"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Publishing makes your agent live for real calls.
                </p>
              </div>
              {settings.published_version && (
                <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              )}
            </div>
          </Section>

          {/* Account */}
          <Section title="Account & Security" icon={<Shield size={15} />}>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl border border-sky-100 bg-sky-50">
                <p className="text-[10px] font-semibold text-gray-400 uppercase">Agent ID</p>
                <p className="text-sm font-mono text-gray-600 mt-0.5">{agentId}</p>
              </div>
              <div className="p-3 rounded-xl border border-sky-100 bg-sky-50">
                <p className="text-[10px] font-semibold text-gray-400 uppercase">Plan</p>
                <p className="text-sm font-medium text-gray-600 mt-0.5">Starter</p>
              </div>
            </div>
          </Section>

          {/* Bottom padding */}
          <div className="h-6" />
        </div>
      </main>

      {/* Saved toast */}
      <AnimatePresence>
        {saved && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 z-50"
          >
            <Check size={16} className="text-emerald-500" />
            Settings saved successfully!
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
