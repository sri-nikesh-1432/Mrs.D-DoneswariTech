import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SUPPORTED_LANGUAGES, LANGUAGE_NATIVE_NAMES } from "../i18n";
import { uploadKnowledge, initiateOutboundCall } from "../services/api";

export default function Settings() {
  const navigate = useNavigate();
  const [agentName, setAgentName] = useState("Mrs.D");
  const [businessName, setBusinessName] = useState("Narayana");
  const [phone, setPhone] = useState("+91 98765 43210");
  const [language, setLanguage] = useState("English");
  const [voice, setVoice] = useState("en-IN-NeerjaNeural");
  const [speed, setSpeed] = useState(1.15);
  const [greeting, setGreeting] = useState("Hi, thanks for taking my call. I'm Mrs.D.");
  const [knowledgeName, setKnowledgeName] = useState("narayana.pdf");
  const [knowledgeStatus, setKnowledgeStatus] = useState("Ready");
  const [knowledgeVersion, setKnowledgeVersion] = useState("v1");
  const [publishing, setPublishing] = useState(false);
  const [testCallPhone, setTestCallPhone] = useState("");
  const [outboundStatus, setOutboundStatus] = useState<any>(null);
  const [calling, setCalling] = useState(false);

  const voices: Record<string, string> = {
    "English": "en-IN-NeerjaNeural",
    "Telugu": "te-IN-ShrutiNeural",
    "Hindi": "hi-IN-SwarNeural",
    "Tamil": "ta-IN-PallaviNeural",
    "Kannada": "kn-IN-SapnaNeural",
    "Malayalam": "ml-IN-SobhanaNeural",
  };

  const handlePublish = async () => {
    setPublishing(true);
    await new Promise((r) => setTimeout(r, 800));
    setPublishing(false);
    setKnowledgeVersion((v) => `v${parseInt(v.slice(1)) + 1}`);
    setKnowledgeStatus("Ready");
    alert("Agent published! Mrs.D is now live.");
  };

  const handleTestCall = async () => {
    if (!testCallPhone.trim()) return;
    setCalling(true);
    try {
      const result = await initiateOutboundCall(testCallPhone.trim(), 1);
      setOutboundStatus(result);
      setTestCallPhone("");
    } catch (e: any) {
      alert(e?.message || "Test call failed. Is the telephony provider configured?");
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-sky-50 overflow-hidden">
      {/* Top bar */}
      <header className="glass-nav px-4 py-3 flex items-center justify-between z-20 border-b border-sky-200/60 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            className="btn-ghost-premium text-xs"
            onClick={() => navigate("/agent/1")}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 19-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center shadow-sm">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-sky-900">Mrs.D</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost-premium text-xs" onClick={() => navigate("/calls")}>Calls & Leads</button>
          <div className="w-7 h-7 rounded-full bg-sky-200 text-sky-700 text-xs font-medium flex items-center justify-center">U</div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <h1 className="text-xl font-semibold text-sky-900 mb-1">Settings</h1>
        <p className="text-sm text-sky-600 mb-6">Configure your AI calling agent.</p>

        <div className="max-w-2xl space-y-6">
          {/* Agent identity */}
          <Section title="Agent Identity">
            <div className="space-y-3">
              <Field label="Agent Name">
                <input className="glass-input w-64" value={agentName} onChange={(e) => setAgentName(e.target.value)} />
                <p className="text-xs text-sky-400 mt-1">The agent's name is permanently associated with your account.</p>
              </Field>
              <Field label="Business / Institution Name">
                <input className="glass-input w-80" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
                <p className="text-xs text-sky-400 mt-1">This name appears in greetings and call reports.</p>
              </Field>
              <Field label="Phone Number">
                <input className="glass-input w-64" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
          </Section>

          {/* Voice & language */}
          <Section title="Voice & Language">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Language">
                <select className="glass-select w-64" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l} value={l}>{LANGUAGE_NATIVE_NAMES[l]} · {l}</option>
                  ))}
                </select>
              </Field>
              <Field label="Voice">
                <select className="glass-select w-64" value={voice} onChange={(e) => setVoice(e.target.value)}>
                  <option value="en-IN-NeerjaNeural">en-IN-NeerjaNeural (Indian English)</option>
                  <option value="en-IN-PrabhaNeural">en-IN-PrabhaNeural (Indian English Alt)</option>
                  <option value="te-IN-ShrutiNeural">te-IN-ShrutiNeural (Telugu)</option>
                  <option value="te-IN-ChitraNeural">te-IN-ChitraNeural (Telugu Alt)</option>
                  <option value="hi-IN-SwaraNeural">hi-IN-SwaraNeural (Hindi)</option>
                  <option value="hi-IN-MeeraNeural">hi-IN-MeeraNeural (Hindi Alt)</option>
                  <option value="ta-IN-PallaviNeural">ta-IN-PallaviNeural (Tamil)</option>
                  <option value="ta-IN-VenkatalakshmiNeural">ta-IN-VenkatalakshmiNeural (Tamil Alt)</option>
                  <option value="kn-IN-SapnaNeural">kn-IN-SapnaNeural (Kannada)</option>
                  <option value="kn-IN-KushalNeural">kn-IN-KushalNeural (Kannada Alt)</option>
                  <option value="ml-IN-SobhanaNeural">ml-IN-SobhanaNeural (Malayalam)</option>
                  <option value="ml-IN-MirnalBetterBetterNeural">ml-IN-MirnalBetterBetterNeural (Malayalam Alt)</option>
                </select>
              </Field>
            </div>
            <Field label="Voice Speed">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0.9"
                  max="1.35"
                  step="0.05"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="flex-1 accent-sky-500"
                />
                <span className="text-sm text-sky-700 w-16 text-right">{speed.toFixed(2)}×</span>
              </div>
              <p className="text-xs text-sky-400 mt-1">Target: 1.15–1.25× for natural phone pace.</p>
            </Field>
            <Field label="Background Ambience">
              <select className="glass-select w-64" defaultValue="none">
                <option value="none">None (silent office)</option>
                <option value="subtle">Very subtle room tone</option>
                <option value="office">Faint office ambience</option>
              </select>
              <p className="text-xs text-sky-400 mt-1">Extremely low volume. Never interferes with speech.</p>
            </Field>
          </Section>

          {/* Greeting */}
          <Section title="Greeting">
            <Field label="Outbound Greeting">
              <textarea
                className="glass-input resize-none h-24 w-full text-sm"
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                placeholder="Hi, thanks for taking my call. I'm Mrs.D…"
              />
              <p className="text-xs text-sky-400 mt-1">Used for outbound calls. Keep it natural — never robotic.</p>
            </Field>
          </Section>

          {/* Knowledge base */}
          <Section title="Knowledge Base">
            <div className="bg-sky-50/50 rounded-2xl p-4 space-y-3 border border-sky-100">
              <div className="flex justify-between text-sm">
                <span className="text-sky-500">Current Knowledge Base</span>
                <span className="text-sky-900 font-medium">{knowledgeName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-sky-500">Status</span>
                <span className="text-sky-900 font-medium flex items-center gap-1.5">
                  <span className="status-dot green" />
                  {knowledgeStatus}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-sky-500">Version</span>
                <span className="text-sky-900 font-medium">{knowledgeVersion}</span>
              </div>
              <button
                className="btn-glow text-sm w-full"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = ".pdf";
                  input.onchange = async (e) => {
                    const f = (e.target as HTMLInputElement).files?.[0];
                    if (!f) return;
                    setKnowledgeStatus("Processing...");
                    try {
                      const { knowledge_id } = await uploadKnowledge(f, 1);
                      setKnowledgeName(f.name);
                      setKnowledgeVersion((v) => `v${parseInt(v.slice(1)) + 1}`);
                      setKnowledgeStatus("Ready");
                    } catch {
                      setKnowledgeStatus("Failed");
                    }
                  };
                  input.click();
                }}
              >
                Upload New Knowledge
              </button>
              <p className="text-xs text-sky-400">Uploading a new PDF creates a new version. The live version stays active until you publish.</p>
            </div>
          </Section>

          {/* Publish */}
          <Section title="Publish">
            <div className="bg-sky-50/50 rounded-2xl p-4 border border-sky-100">
              <p className="text-sm text-sky-700 mb-3">
                Your agent is ready to handle live calls. Publishing creates a versioned snapshot of the current knowledge and configuration.
              </p>
              <div className="flex gap-3">
                <button
                  className="btn-glow"
                  onClick={handlePublish}
                  disabled={publishing}
                >
                  {publishing ? "Publishing…" : "Publish Mrs.D"}
                </button>
                <div className={`flex items-center gap-1.5 text-xs ${
                  knowledgeStatus === "Ready" ? "text-green-600" : "text-sky-500"
                }`}>
                  <span className={`status-dot ${knowledgeStatus === "Ready" ? "green" : "orange"}`} />
                  {knowledgeStatus === "Ready" ? "Ready to publish" : knowledgeStatus}
                </div>
              </div>
            </div>
          </Section>

          {/* Test Call */}
          <Section title="Test Call">
            <div className="bg-sky-50/50 rounded-2xl p-4 border border-sky-100 space-y-3">
              <p className="text-sm text-sky-700">
                Mrs.D calls the number below and conducts a real voice conversation.
              </p>
              <div className="flex gap-2">
                <input
                  className="glass-input w-64"
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={testCallPhone}
                  onChange={(e) => setTestCallPhone(e.target.value)}
                />
                <button
                  className="btn-glow text-sm"
                  onClick={handleTestCall}
                  disabled={!testCallPhone.trim() || calling}
                >
                  {calling ? "Calling…" : "Call"}
                </button>
              </div>
              {outboundStatus && (
                <div className="text-xs text-sky-600 space-y-1">
                  <div>Call SID: {outboundStatus.call_sid}</div>
                  <div>To: {outboundStatus.to}</div>
                  <div>Status: <span className="font-medium">{outboundStatus.status}</span></div>
                  <div>Started: {new Date(outboundStatus.started_at).toLocaleString()}</div>
                </div>
              )}
              <p className="text-xs text-sky-400">
                Telephony must be configured in .env (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER).
              </p>
            </div>
          </Section>

          {/* Account */}
          <Section title="Account">
            <div className="bg-sky-50/50 rounded-2xl p-4 border border-sky-100 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-sky-500">Account holder</span>
                <span className="text-sky-900 font-medium">{agentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sky-500">Phone</span>
                <span className="text-sky-900">{phone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sky-500">Published version</span>
                <span className="text-sky-900 font-medium">{knowledgeVersion}</span>
              </div>
              <button className="btn-ghost-premium text-xs mt-2">Sign out</button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/70 rounded-2xl p-4 border border-sky-100">
      <h2 className="text-sm font-semibold text-sky-900 mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-xs text-sky-500 font-medium mb-1.5">{label}</div>
      {children}
    </div>
  );
}
