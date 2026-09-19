import React, { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  Upload, Search, Plus, Trash2, Users, Loader2, FileSpreadsheet, CheckCircle2, XCircle, Phone,
} from "lucide-react";
import {
  validateStudentsFile, importStudents, addStudent, listStudents, deleteStudent,
} from "../services/api";
import type { ImportPreview } from "../types";
import { useI18n } from "../i18n";

export default function Students() {
  const { t } = useI18n();
  const { agentId } = useParams<{ agentId: string }>();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [interestFilter, setInterestFilter] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["students", agentId, search, statusFilter, interestFilter],
    queryFn: () =>
      listStudents(agentId!, {
        search: search || undefined,
        call_status: statusFilter !== "all" ? statusFilter : undefined,
        interest_level: interestFilter !== "all" ? interestFilter : undefined,
        limit: 500,
      }),
    enabled: !!agentId,
  });

  // Import flow state
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);

  // Manual add modal
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", phone: "", email: "", preferred_course: "", city: "" });
  const [addError, setAddError] = useState("");

  const handleFile = async (file: File) => {
    if (!agentId) return;
    setValidating(true);
    try {
      const res = await validateStudentsFile(agentId, file);
      setPreview(res);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail || "Failed to validate file");
    } finally {
      setValidating(false);
    }
  };

  const commitImport = async () => {
    if (!agentId || !preview) return;
    setImporting(true);
    try {
      const res = await importStudents(agentId, preview.valid_records);
      alert(res.message);
      setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ["students", agentId] });
    } finally {
      setImporting(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentId) return;
    setAddError("");
    try {
      await addStudent(agentId, addForm);
      setShowAdd(false);
      setAddForm({ name: "", phone: "", email: "", preferred_course: "", city: "" });
      await queryClient.invalidateQueries({ queryKey: ["students", agentId] });
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setAddError(detail || "Failed to add student");
    }
  };

  const handleDelete = async (id: number) => {
    if (!agentId || !confirm("Delete this student?")) return;
    await deleteStudent(agentId, id);
    await queryClient.invalidateQueries({ queryKey: ["students", agentId] });
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--gray-800)]">{t("nav.students")}</h1>
          <p className="text-sm text-[var(--gray-500)] mt-0.5">{data?.total ?? 0} total contacts</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={validating}
            className="flex items-center gap-2 bg-white hover:bg-[var(--gray-50)] text-[var(--gray-700)] border border-[var(--gray-200)] text-sm font-semibold rounded-lg px-4 py-2.5 disabled:opacity-60"
          >
            {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Upload CSV/XLSX
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white text-sm font-semibold rounded-lg px-4 py-2.5"
          >
            <Plus className="w-4 h-4" /> {t("students.add")}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2.5 mb-5">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--gray-400)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone…"
            className="w-full bg-white border border-[var(--gray-200)] rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-white border border-[var(--gray-200)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
        >
          {["all", "Pending", "Calling", "In Progress", "Completed", "No Answer", "Busy", "Failed", "Callback Requested"].map((s) => (
            <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>
          ))}
        </select>
        <select
          value={interestFilter}
          onChange={(e) => setInterestFilter(e.target.value)}
          className="bg-white border border-[var(--gray-200)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
        >
          {["all", "Interested", "Not Interested", "Needs Follow-up", "Callback Requested", "Unclear"].map((s) => (
            <option key={s} value={s}>{s === "all" ? "All interest levels" : s}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="glass rounded-[var(--radius-md)] shadow-[var(--shadow-sm)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/70 border-b border-[var(--gray-200)] text-left text-[12px] uppercase tracking-wide text-[var(--gray-500)]">
                <th className="px-4 py-3 font-semibold">Student</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">Course</th>
                <th className="px-4 py-3 font-semibold">City</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Interest</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--gray-400)]"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
              ) : (data?.students ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Users className="w-8 h-8 text-[var(--gray-300)] mx-auto mb-2" />
                    <div className="text-sm text-[var(--gray-500)]">No students yet — upload a CSV or add manually</div>
                  </td>
                </tr>
              ) : (
                data!.students.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--gray-100)] hover:bg-white/60 transition-colors">
                    <td className="px-4 py-3 font-medium text-[var(--gray-800)]">{s.name}</td>
                    <td className="px-4 py-3 text-[var(--gray-600)] font-mono text-[12.5px]">{s.phone}</td>
                    <td className="px-4 py-3 text-[var(--gray-600)]">{s.preferred_course || "—"}</td>
                    <td className="px-4 py-3 text-[var(--gray-600)]">{s.city || "—"}</td>
                    <td className="px-4 py-3"><StatusPill value={s.call_status} /></td>
                    <td className="px-4 py-3"><InterestPill value={s.interest_level} /></td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="p-1.5 rounded-lg text-[var(--gray-400)] hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete student"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Import preview dialog */}
      {preview && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 px-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] w-full max-w-2xl p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-5">
              <FileSpreadsheet className="w-5 h-5 text-[var(--sky-600)]" />
              <h2 className="text-lg font-semibold text-[var(--gray-800)]">Import Preview — {preview.filename}</h2>
            </div>

            <div className="grid grid-cols-4 gap-3 mb-5">
              <Stat label="Total" value={preview.total_rows} color="text-[var(--gray-800)]" />
              <Stat label="Valid" value={preview.valid_count} color="text-emerald-600" />
              <Stat label="Invalid" value={preview.invalid_count} color="text-red-600" />
              <Stat label="Duplicates" value={preview.duplicates_count} color="text-amber-600" />
            </div>

            {preview.preview_valid.length > 0 && (
              <>
                <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--gray-500)] mb-2">Sample valid rows</div>
                <div className="border border-[var(--gray-100)] rounded-lg overflow-hidden mb-4">
                  <table className="w-full text-[12.5px]">
                    <tbody>
                      {preview.preview_valid.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-b border-[var(--gray-100)] last:border-0">
                          <td className="px-3 py-2 font-medium text-[var(--gray-700)]">{r.name}</td>
                          <td className="px-3 py-2 font-mono text-[var(--gray-600)]">{r.phone}</td>
                          <td className="px-3 py-2 text-[var(--gray-500)]">{r.preferred_course || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {preview.errors.length > 0 && (
              <>
                <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--gray-500)] mb-2">Errors (first 10)</div>
                <div className="space-y-1.5 mb-4">
                  {preview.errors.slice(0, 10).map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12.5px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5">
                      <XCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Row {e.row}: {e.reason}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex gap-2.5 pt-2">
              <button onClick={() => setPreview(null)} className="flex-1 text-sm font-medium text-[var(--gray-600)] bg-[var(--gray-50)] hover:bg-[var(--gray-100)] border border-[var(--gray-200)] rounded-lg py-2.5">
                Cancel
              </button>
              <button
                onClick={commitImport}
                disabled={importing || preview.valid_count === 0}
                className="flex-1 flex items-center justify-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white text-sm font-semibold rounded-lg py-2.5 disabled:opacity-50"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Import {preview.valid_count} Students
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add student modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 px-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-[var(--gray-800)] mb-5">Add Student Manually</h2>
            <form onSubmit={handleAdd} className="space-y-4">
              <Field label="Name *" value={addForm.name} onChange={(v) => setAddForm({ ...addForm, name: v })} required />
              <Field label="Phone *" value={addForm.phone} onChange={(v) => setAddForm({ ...addForm, phone: v })} placeholder="+91 98765 43210" required />
              <Field label="Email" value={addForm.email} onChange={(v) => setAddForm({ ...addForm, email: v })} />
              <Field label="Preferred Course" value={addForm.preferred_course} onChange={(v) => setAddForm({ ...addForm, preferred_course: v })} />
              <Field label="City" value={addForm.city} onChange={(v) => setAddForm({ ...addForm, city: v })} />
              {addError && <div className="text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{addError}</div>}
              <div className="flex gap-2.5 pt-1">
                <button type="button" onClick={() => setShowAdd(false)} className="flex-1 text-sm font-medium text-[var(--gray-600)] bg-[var(--gray-50)] hover:bg-[var(--gray-100)] border border-[var(--gray-200)] rounded-lg py-2.5">Cancel</button>
                <button type="submit" className="flex-1 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white text-sm font-semibold rounded-lg py-2.5">Add Student</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-[var(--gray-50)] border border-[var(--gray-100)] rounded-lg p-3 text-center">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-[var(--gray-500)]">{label}</div>
    </div>
  );
}

export function StatusPill({ value }: { value: string }) {
  const map: Record<string, string> = {
    Pending: "bg-[var(--gray-100)] text-[var(--gray-600)]",
    Calling: "bg-blue-50 text-blue-700",
    "In Progress": "bg-indigo-50 text-indigo-700",
    Completed: "bg-emerald-50 text-emerald-700",
    "No Answer": "bg-orange-50 text-orange-700",
    Busy: "bg-amber-50 text-amber-700",
    Failed: "bg-red-50 text-red-700",
    "Callback Requested": "bg-violet-50 text-violet-700",
  };
  return <span className={`text-[11.5px] font-medium px-2 py-0.5 rounded-full ${map[value] ?? "bg-[var(--gray-100)] text-[var(--gray-600)]"}`}>{value}</span>;
}

export function InterestPill({ value }: { value: string }) {
  const map: Record<string, string> = {
    Interested: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    "Not Interested": "bg-red-50 text-red-700 border border-red-200",
    "Needs Follow-up": "bg-blue-50 text-blue-700 border border-blue-200",
    "Callback Requested": "bg-violet-50 text-violet-700 border border-violet-200",
    Unclear: "bg-[var(--gray-50)] text-[var(--gray-500)] border border-[var(--gray-200)]",
  };
  return <span className={`text-[11.5px] font-medium px-2 py-0.5 rounded-full ${map[value] ?? map.Unclear}`}>{value}</span>;
}

function Field({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--gray-700)] mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-[var(--gray-200)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
      />
    </div>
  );
}
