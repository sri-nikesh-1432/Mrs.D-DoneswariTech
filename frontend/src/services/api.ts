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
    status: string;
  }>("/receptionist/institute", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Initiate a complete onboarding flow: create institute, upload PDF, wait for
 * knowledge to become READY, then return the real institute_id so the Agent
 * page can connect to the correct tenant. The PDF processing is synchronous
 * in the current backend, so this returns once the knowledge is marked READY.
 */
export async function onboard(
  profile: { name: string; phone_number: string; language?: string; voice?: string },
  file: File
): Promise<{
  institute_id: string;
  institute_name: string;
  knowledge_id: number;
  status: string;
}> {
  // 1. Create institute.
  const institute = await createInstitute({
    name: profile.name,
    phone_number: profile.phone_number,
    language: profile.language || "en",
    voice: profile.voice || "en-IN-NeerjaNeural",
  });

  // 2. Upload + process the PDF. The backend processes synchronously and
  //    returns once the knowledge row is READY.
  const knowledge = await uploadKnowledge(file, institute.id);

  return {
    institute_id: institute.institute_id,
    institute_name: knowledge.institute_name,
    knowledge_id: knowledge.knowledge_id,
    status: knowledge.status,
  };
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

export async function saveSimulatorCall(data: {
  call_id: string;
  institute_id: number;
  duration: number;
  language: string;
  status: string;
  transcript: Array<{ speaker: string; text: string }>;
}) {
  const qs = new URLSearchParams({
    call_id: data.call_id,
    institute_id: String(data.institute_id),
    duration: String(data.duration),
    language: data.language,
    status: data.status,
  });
  const res = await fetch(`${BASE_URL}/conversation/calls/save?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript: data.transcript }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to save call");
  }
  return res.json();
}

export async function getAnalytics(instituteId: string) {
  return request<any>(`/receptionist/institute/${instituteId}/analytics`);
}

export async function getLiveStatus(instituteId: string) {
  return request<any>(`/receptionist/institute/${instituteId}/live-status`);
}

// ── Telephony (spec §58 §59) ───────────────────────────────────────────────
export async function initiateOutboundCall(
  phoneNumber: string,
  instituteId: number
): Promise<{
  call_sid: string;
  to: string;
  from: string;
  status: string;
  institute_id: number;
  institute_name: string;
  started_at: string;
}> {
  const form = new FormData();
  form.append("phone_number", phoneNumber);
  form.append("institute_id", String(instituteId));
  const res = await fetch("/api/telephony/outbound", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Outbound call failed.");
  }
  return res.json();
}

export async function getCallStatus(callSid: string): Promise<any> {
  const res = await fetch(`/api/receptionist/call/${callSid}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Call not found.");
  }
  return res.json();
}
