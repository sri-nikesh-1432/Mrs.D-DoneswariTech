import React, { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  Upload, FileText, Loader2, CheckCircle2, Rocket, Pause, Bot, Save, Trash2,
} from "lucide-react";
import { getAgent, updateAgent, uploadAgentDocument, listAgentDocuments, publishAgent, pauseAgent } from "../services/api";
import { StatusChip } from "./Dashboard";

const ALLOWED = ".pdf,.docx,.txt,.csv,.xlsx,.xls";

export default function AgentOverview() {
  const { agentId } = useParams<{ agentId: string }>();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: agent, isLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => getAgent(agentId!),
    enabled: !!agentId,
  });

  const { data: documents } = useQuery({
    queryKey: ["agent-documents", agentId],
    queryFn: () => listAgentDocuments(agentId!),
    enabled: !!agentId,
  });

  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadMsg, setUploadMsg] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ agent_name?: string; company_name?: string; greeting_message?: string; instructions?: string } | null>(null);

  // Sync local edit form when agent loads
  React.useEffect(() => {
    if (agent && !form) {
      setForm({
        agent_name: agent.agent_name ?? "",
        company_name: agent.name ?? "",
        greeting_message: agent.greeting_message ?? "",
        instructions: agent.instructions ?? "",
      });
    }
  }, [agent, form]);

  const handleUpload = async (file: File) => {
    if (!agentId) return;
    setUploading(true);
    setUploadPct(0);
    setUploadMsg("Uploading & processing document…");
    try {
      const res = await uploadAgentDocument(agentId, file, setUploadPct);
      setUploadMsg(`${res.message} (${res.chunks_count} chunks)`);
      await queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      await queryClient.invalidateQueries({ queryKey: ["agent-documents", agentId] });
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setUploadMsg(detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handlePublish = async () => {
    if (!agentId) return;
    setPublishing(true);
    try {
      const res = await publishAgent(agentId);
      setToast(res.message);
      await queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      setTimeout(() => setToast(""), 4000);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setToast(detail || "Publish failed");
      setTimeout(() => setToast(""), 4000);
    } finally {
      setPublishing(false);
    }
  };

  const handlePause = async () => {
    if (!agentId) return;
    const res = await pauseAgent(agentId);
    setToast(res.message);
    await queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
    setTimeout(() => setToast(""), 4000);
  };

  const handleSave = async () => {
    if (!agentId || !form) return;
    setSaving(true);
    try {
      await updateAgent(agentId, {
        agent_name: form.agent_name,
        company_name: form.company_name,
        greeting_message: form.greeting_message,
        instructions: form.instructions,
      });
      await queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      setToast("Settings saved");
      setTimeout(() => setToast(""), 3000);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !agent || !form) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        <div className="skeleton h-10 w-1/3" />
        <div className="skeleton h-40 rounded-[var(--radius-md)]" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--sky-400)] to-[var(--sky-600)] flex items-center justify-center text-white font-bold text-lg">
            {(agent.agent_name || "A").slice(0, 1)}
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-[var(--gray-800)]">{agent.agent_name}</h1>
              <StatusChip status={agent.status} />
            </div>
            <p className="text-sm text-[var(--gray-500)]">{agent.name} · {agent.calling_purpose}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {agent.status === "published" ? (
            <button onClick={handlePause} className="flex items-center gap-1.5 text-sm font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg px-3.5 py-2">
              <Pause className="w-4 h-4" /> Pause
            </button>
          ) : (
            <button
              onClick={handlePublish}
              disabled={publishing || !agent.knowledge_ready}
              title={agent.knowledge_ready ? "" : "Upload knowledge document first"}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-2"
            >
              {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              Publish Agent
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className="mb-5 text-sm text-[var(--sky-800)] bg-[var(--sky-50)] border border-[var(--sky-200)] rounded-lg px-4 py-2.5">{toast}</div>
      )}

      {/* Knowledge upload */}
      <section className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)] mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-[var(--gray-800)] flex items-center gap-2">
            <FileText className="w-4 h-4 text-[var(--sky-600)]" /> Knowledge Base
          </h2>
          {agent.knowledge_ready && (
            <span className="flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" /> Agent Ready
            </span>
          )}
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleUpload(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-[var(--gray-300)] hover:border-[var(--sky-400)] rounded-[var(--radius-md)] py-8 flex flex-col items-center justify-center cursor-pointer transition-colors bg-white/50"
        >
          {uploading ? (
            <>
              <Loader2 className="w-7 h-7 text-[var(--sky-500)] animate-spin mb-2" />
              <div className="text-sm text-[var(--gray-600)]">{uploadMsg}</div>
              <div className="w-56 h-1.5 bg-[var(--gray-100)] rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-[var(--sky-500)] rounded-full transition-all" style={{ width: `${uploadPct}%` }} />
              </div>
            </>
          ) : (
            <>
              <Upload className="w-7 h-7 text-[var(--gray-400)] mb-2" />
              <div className="text-sm font-medium text-[var(--gray-700)]">Drop knowledge document or click to upload</div>
              <div className="text-[12px] text-[var(--gray-500)] mt-1">PDF, DOCX, TXT, CSV, XLSX — up to 50 MB</div>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = "";
            }}
          />
        </div>

        {uploadMsg && !uploading && <div className="mt-3 text-[13px] text-[var(--gray-600)]">{uploadMsg}</div>}

        {documents && documents.length > 0 && (
          <div className="mt-4 space-y-2">
            {documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-[13px] bg-white border border-[var(--gray-100)] rounded-lg px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="w-4 h-4 text-[var(--gray-400)] shrink-0" />
                  <span className="truncate text-[var(--gray-700)]">{d.name}</span>
                </div>
                <div className="flex items-center gap-3 text-[11.5px] text-[var(--gray-500)] shrink-0">
                  <span>{d.size_kb} KB</span>
                  <span>{d.chunks} chunks</span>
                  <span className="capitalize font-medium text-[var(--sky-700)]">{d.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Agent settings */}
      <section className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-[15px] font-semibold text-[var(--gray-800)] flex items-center gap-2 mb-4">
          <Bot className="w-4 h-4 text-[var(--sky-600)]" /> Agent Configuration
        </h2>
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <LabeledInput label="Agent Name" value={form.agent_name ?? ""} onChange={(v) => setForm({ ...form, agent_name: v })} />
          <LabeledInput label="Company / Institution" value={form.company_name ?? ""} onChange={(v) => setForm({ ...form, company_name: v })} />
        </div>
        <LabeledTextarea label="Greeting Message" rows={2} value={form.greeting_message ?? ""} onChange={(v) => setForm({ ...form, greeting_message: v })} />
        <div className="mt-4">
          <LabeledTextarea label="Special Instructions" rows={3} value={form.instructions ?? ""} onChange={(v) => setForm({ ...form, instructions: v })} />
        </div>
        <div className="flex justify-end mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white text-sm font-semibold rounded-lg px-4 py-2.5 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Changes
          </button>
        </div>
      </section>
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--gray-700)] mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-[var(--gray-200)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
      />
    </div>
  );
}

function LabeledTextarea({ label, rows, value, onChange }: { label: string; rows: number; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--gray-700)] mb-1.5">{label}</label>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-[var(--gray-200)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)] resize-none"
      />
    </div>
  );
}
