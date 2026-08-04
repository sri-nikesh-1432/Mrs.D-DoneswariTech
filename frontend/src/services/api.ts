const BASE_URL = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Health ─────────────────────────────────────────────────────
export async function healthCheck() {
  return request<{ status: string; version: string }>("/");
}

// ── Knowledge ───────────────────────────────────────────────────
export async function uploadKnowledge(file: File, instituteId?: number): Promise<{
  message: string;
  knowledge_id: number;
  institute_id: number;
  institute_name: string;
  status: string;
}> {
  const form = new FormData();
  form.append("file", file);
  if (instituteId) {
    form.append("institute_id", instituteId.toString());
  }
  const res = await fetch(`${BASE_URL}/knowledge/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function getKnowledgeStatus(instituteId: number) {
  return request<{
    institute_id: number;
    status: string;
    knowledge_id?: number;
    document_name?: string;
    chunks_count?: number;
    error_message?: string;
  }>(`/knowledge/status/${instituteId}`);
}

// ── Receptionist (Institute, Calls, Analytics) ─────────────────
export async function createInstitute(data: {
  name: string;
  phone_number: string;
  language?: string;
  voice?: string;
  greeting_message?: string;
}) {
  return request<{
    institute_id: string;
    id: number;
    name: string;
    phone_number: string;
    sip_status: string;
  }>("/receptionist/institute", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getInstitute(instituteId: string) {
  return request<any>(`/receptionist/institute/${instituteId}`);
}

export async function getInstituteStatus(instituteId: string) {
  return request<any>(`/receptionist/institute/${instituteId}/status`);
}

export async function getCallHistory(instituteId: string, limit: number = 50, offset: number = 0) {
  return request<any>(`/receptionist/institute/${instituteId}/calls?limit=${limit}&offset=${offset}`);
}

export async function getCallDetails(callId: string) {
  return request<any>(`/receptionist/call/${callId}`);
}

export async function getSimulatorCalls(instituteId: number) {
  return request<{ calls: any[] }>(`/conversation/calls/${instituteId}`);
}

export async function getAnalytics(instituteId: string) {
  return request<any>(`/receptionist/institute/${instituteId}/analytics`);
}

export async function getLiveStatus(instituteId: string) {
  return request<any>(`/receptionist/institute/${instituteId}/live-status`);
}
