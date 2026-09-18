import axios from "axios";
import type {
  OnboardPayload,
  AgentProfile,
  CallRecord,
  CallStats,
  AgentSettings,
  TrainingJob,
  AnalyticPoint,
  AuthResponse,
  MeResponse,
  StudentListResponse,
  Student,
  ImportPreview,
  CampaignStatus,
  AgentAnalytics,
  StudentAnalytics,
  AgentCallRecord,
} from "../types";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// ─── Auth token handling ───────────────────────────────────────────
const TOKEN_KEY = "doneswari_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

const api = axios.create({ baseURL: BASE, timeout: 120_000 });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Auth ──────────────────────────────────────────────────────────
export async function signup(
  email: string,
  password: string,
  fullName: string,
  companyName?: string
): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>("/api/auth/signup", {
    email,
    password,
    full_name: fullName,
    company_name: companyName,
  });
  setToken(res.data.token);
  return res.data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>("/api/auth/login", { email, password });
  setToken(res.data.token);
  return res.data;
}

export async function getMe(): Promise<MeResponse> {
  const res = await api.get<MeResponse>("/api/auth/me");
  return res.data;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/api/auth/logout");
  } finally {
    setToken(null);
  }
}

// ─── Agents ────────────────────────────────────────────────────────
export async function listAgents(): Promise<AgentProfile[]> {
  const res = await api.get<AgentProfile[]>("/api/agents");
  return res.data;
}

export async function createAgent(payload: {
  name: string;
  company_name: string;
  phone_number?: string;
  calling_purpose?: string;
  description?: string;
  language?: string;
  voice?: string;
  voice_speed?: number;
  greeting_message?: string;
  instructions?: string;
}): Promise<AgentProfile> {
  const res = await api.post<AgentProfile>("/api/agents", payload);
  return res.data;
}

export async function getAgent(agentId: string | number): Promise<AgentProfile> {
  const res = await api.get<AgentProfile>(`/api/agents/${agentId}`);
  return res.data;
}

export async function updateAgent(
  agentId: string | number,
  payload: Partial<AgentSettings & AgentProfile>
): Promise<AgentProfile> {
  const res = await api.patch<AgentProfile>(`/api/agents/${agentId}`, payload);
  return res.data;
}

export async function uploadAgentDocument(
  agentId: string | number,
  file: File,
  onUploadProgress?: (pct: number) => void
): Promise<{ message: string; chunks_count: number; agent: AgentProfile }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await api.post(`/api/agents/${agentId}/documents`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => {
      if (onUploadProgress && e.total) onUploadProgress(Math.round((e.loaded * 100) / e.total));
    },
  });
  return res.data;
}

export async function listAgentDocuments(agentId: string | number): Promise<Array<{
  id: number; name: string; type: string; size_kb: number; chunks: number; status: string; uploaded_at: string;
}>> {
  const res = await api.get(`/api/agents/${agentId}/documents`);
  return res.data;
}

export async function publishAgent(agentId: string | number): Promise<{ status: string; version: string; message: string }> {
  const res = await api.post(`/api/agents/${agentId}/publish`);
  return res.data;
}

export async function pauseAgent(agentId: string | number): Promise<{ status: string; message: string }> {
  const res = await api.post(`/api/agents/${agentId}/pause`);
  return res.data;
}

export async function sendTextMessage(
  instituteId: string | number,
  message: string,
  sessionId?: string
): Promise<{ response: string; grounded?: boolean; memory?: Record<string, string> }> {
  const res = await api.post(`/api/chat`, {
    institute_id: instituteId,
    message,
    session_id: sessionId,
  });
  return res.data;
}

// ─── Legacy compatibility wrappers (older pages) ──────────────────
/** @deprecated Use getAgent */
export async function getInstitute(instituteId: string | number): Promise<AgentProfile> {
  return getAgent(instituteId);
}

/** @deprecated Use getAgent */
export async function getAgentSettings(instituteId: string | number): Promise<AgentSettings> {
  const res = await api.get<AgentSettings>(`/api/agents/${instituteId}/settings`);
  return res.data;
}

/** @deprecated Use updateAgent */
export async function updateAgentSettings(
  instituteId: string | number,
  settings: Partial<AgentSettings>
): Promise<AgentSettings> {
  const res = await api.patch<AgentSettings>(`/api/agents/${instituteId}/settings`, settings);
  return res.data;
}

/** @deprecated Use uploadAgentDocument */
export async function uploadNewKnowledge(
  instituteId: string | number,
  pdfFile: File,
  onUploadProgress?: (pct: number) => void
): Promise<TrainingJob> {
  const res = await uploadAgentDocument(instituteId, pdfFile, onUploadProgress);
  return {
    job_id: `upload_${Date.now()}`,
    status: (res.agent?.knowledge_ready ? "ready" : "processing") as TrainingJob["status"],
    message: res.message,
  };
}

// ─── Students ──────────────────────────────────────────────────────
export async function validateStudentsFile(
  agentId: string | number,
  file: File
): Promise<ImportPreview> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await api.post<ImportPreview>(`/api/agents/${agentId}/students/validate`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function importStudents(
  agentId: string | number,
  students: Array<Record<string, string>>
): Promise<{ imported: number; total_students: number; message: string }> {
  const res = await api.post(`/api/agents/${agentId}/students/import`, { students });
  return res.data;
}

export async function addStudent(
  agentId: string | number,
  payload: { name: string; phone: string; email?: string; preferred_course?: string; city?: string; notes?: string }
): Promise<Student> {
  const res = await api.post<Student>(`/api/agents/${agentId}/students`, payload);
  return res.data;
}

export async function listStudents(
  agentId: string | number,
  filters?: { search?: string; call_status?: string; interest_level?: string; limit?: number; offset?: number }
): Promise<StudentListResponse> {
  const res = await api.get<StudentListResponse>(`/api/agents/${agentId}/students`, { params: filters });
  return res.data;
}

export async function deleteStudent(agentId: string | number, studentId: number): Promise<void> {
  await api.delete(`/api/agents/${agentId}/students/${studentId}`);
}

export async function getStudentAnalytics(
  agentId: string | number,
  studentId: number
): Promise<StudentAnalytics> {
  const res = await api.get<StudentAnalytics>(`/api/agents/${agentId}/students/${studentId}/analytics`);
  return res.data;
}

// ─── Campaign ──────────────────────────────────────────────────────
export async function getCampaignStatus(agentId: string | number): Promise<CampaignStatus> {
  const res = await api.get<CampaignStatus>(`/api/agents/${agentId}/campaign/status`);
  return res.data;
}

export async function startCampaign(agentId: string | number): Promise<{ message: string; is_running: boolean; pending_count?: number }> {
  const res = await api.post(`/api/agents/${agentId}/campaign/start`);
  return res.data;
}

export async function pauseCampaign(agentId: string | number): Promise<{ message: string; is_running: boolean }> {
  const res = await api.post(`/api/agents/${agentId}/campaign/pause`);
  return res.data;
}

export async function simulateCall(agentId: string | number, studentId: number): Promise<{ message: string; call_status: string; interest_level: string }> {
  const res = await api.post(`/api/agents/${agentId}/campaign/simulate-call/${studentId}`);
  return res.data;
}

// ─── Analytics ─────────────────────────────────────────────────────
export async function getAgentAnalytics(agentId: string | number): Promise<AgentAnalytics> {
  const res = await api.get<AgentAnalytics>(`/api/agents/${agentId}/analytics`);
  return res.data;
}

export async function getAgentCalls(agentId: string | number): Promise<{ total: number; calls: AgentCallRecord[] }> {
  const res = await api.get(`/api/agents/${agentId}/calls`);
  return res.data;
}

// ─── Onboarding (legacy flow) ──────────────────────────────────────
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

export async function getTrainingStatus(instituteId: string | number): Promise<TrainingJob> {
  const res = await api.get<TrainingJob>(`/api/knowledge/status/${instituteId}`);
  return res.data;
}

// ─── Calls (legacy) ────────────────────────────────────────────────
export async function getCalls(instituteId: string | number): Promise<CallRecord[]> {
  const res = await api.get<CallRecord[]>(`/api/calls?institute_id=${instituteId}`);
  return res.data;
}

export async function getCallStats(instituteId: string | number): Promise<CallStats> {
  const res = await api.get<CallStats>(`/api/analytics/stats?institute_id=${instituteId}`);
  return res.data;
}

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

export async function getAnalytics(instituteId: string | number): Promise<AnalyticPoint[]> {
  const res = await api.get<AnalyticPoint[]>(`/api/analytics/trend?institute_id=${instituteId}`);
  return res.data;
}
