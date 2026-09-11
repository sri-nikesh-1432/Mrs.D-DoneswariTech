import axios from "axios";
import type {
  OnboardPayload,
  AgentProfile,
  CallRecord,
  CallStats,
  AgentSettings,
  TrainingJob,
  AnalyticPoint,
} from "../types";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const api = axios.create({ baseURL: BASE, timeout: 30_000 });

// ─── Onboarding ───────────────────────────────────────────────────
export async function onboard(
  payload: OnboardPayload,
  pdfFile: File,
  onUploadProgress?: (pct: number) => void
): Promise<AgentProfile> {
  const fd = new FormData();
  fd.append("name", payload.name);
  fd.append("phone_number", payload.phone_number);
  fd.append("agent_name", payload.agent_name);
  fd.append("language", payload.language ?? "en");
  fd.append("voice", payload.voice ?? "en-IN-NeerjaNeural");
  fd.append("file", pdfFile);

  const res = await api.post<AgentProfile>("/api/onboard", fd, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => {
      if (onUploadProgress && e.total) {
        onUploadProgress(Math.round((e.loaded * 100) / e.total));
      }
    },
  });
  return res.data;
}

// ─── Training Status Polling ──────────────────────────────────────
export async function getTrainingStatus(instituteId: string | number): Promise<TrainingJob> {
  const res = await api.get<TrainingJob>(`/api/knowledge/status/${instituteId}`);
  return res.data;
}

// ─── Institute / Agent ────────────────────────────────────────────
export async function getInstitute(instituteId: string | number): Promise<AgentProfile> {
  const res = await api.get<AgentProfile>(`/api/knowledge/status/${instituteId}`);
  // Fallback: try the receptionist route shape
  return res.data;
}

export async function publishAgent(instituteId: string | number): Promise<{ version: string }> {
  const res = await api.post<{ version: string }>(`/api/agents/${instituteId}/publish`);
  return res.data;
}

export async function getAgentSettings(instituteId: string | number): Promise<AgentSettings> {
  const res = await api.get<AgentSettings>(`/api/agents/${instituteId}/settings`);
  return res.data;
}

export async function updateAgentSettings(
  instituteId: string | number,
  settings: Partial<AgentSettings>
): Promise<AgentSettings> {
  const res = await api.patch<AgentSettings>(`/api/agents/${instituteId}/settings`, settings);
  return res.data;
}

export async function uploadNewKnowledge(
  instituteId: string | number,
  pdfFile: File,
  onUploadProgress?: (pct: number) => void
): Promise<TrainingJob> {
  const fd = new FormData();
  fd.append("file", pdfFile);

  const res = await api.post<TrainingJob>(`/api/knowledge/upload/${instituteId}`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => {
      if (onUploadProgress && e.total) {
        onUploadProgress(Math.round((e.loaded * 100) / e.total));
      }
    },
  });
  return res.data;
}

// ─── Calls ────────────────────────────────────────────────────────
export async function getCalls(instituteId: string | number): Promise<CallRecord[]> {
  const res = await api.get<CallRecord[]>(`/api/calls?institute_id=${instituteId}`);
  return res.data;
}

export async function getCallStats(instituteId: string | number): Promise<CallStats> {
  const res = await api.get<CallStats>(`/api/analytics/stats?institute_id=${instituteId}`);
  return res.data;
}

export async function getCallDetail(callId: string | number): Promise<CallRecord> {
  const res = await api.get<CallRecord>(`/api/calls/${callId}`);
  return res.data;
}

export async function getCallReport(callId: string | number): Promise<CallRecord> {
  const res = await api.get<CallRecord>(`/api/calls/${callId}/report`);
  return res.data;
}

// ─── Analytics ────────────────────────────────────────────────────
export async function getAnalytics(instituteId: string | number): Promise<AnalyticPoint[]> {
  const res = await api.get<AnalyticPoint[]>(`/api/analytics/trend?institute_id=${instituteId}`);
  return res.data;
}

// ─── Test Call (outbound) ─────────────────────────────────────────
export async function initiateTestCall(
  instituteId: string | number,
  phoneNumber: string
): Promise<{ call_id: string; status: string }> {
  const res = await api.post<{ call_id: string; status: string }>("/api/calls/outbound", {
    institute_id: instituteId,
    phone_number: phoneNumber,
  });
  return res.data;
}

// ─── Text chat (fallback to REST) ────────────────────────────────
export async function sendTextMessage(
  instituteId: string | number,
  message: string,
  sessionId?: string
): Promise<{ response: string; memory?: Record<string, string> }> {
  const res = await api.post(`/api/chat`, {
    institute_id: instituteId,
    message,
    session_id: sessionId,
  });
  return res.data;
}
