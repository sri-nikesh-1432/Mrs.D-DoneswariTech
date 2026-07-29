import type { Campaign, Student, UploadResponse, CampaignStats } from "../types";

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
export async function uploadKnowledge(file: File, campaignId: number): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE_URL}/knowledge/upload?campaign_id=${campaignId}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function getKnowledgeStatus(campaignId: number) {
  return request<{ status: string; knowledge_id?: number; chunks_count?: number }>(`/knowledge/status/${campaignId}`);
}

// ── Students ────────────────────────────────────────────────────
export async function uploadStudents(file: File, campaignId: number): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE_URL}/students/upload?campaign_id=${campaignId}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function getStudents(campaignId: number) {
  return request<{ campaign_id: number; students: Student[] }>(`/students/campaign/${campaignId}`);
}

export async function getStudent(studentId: number) {
  return request<Student>(`/students/${studentId}`);
}

// ── Campaign ────────────────────────────────────────────────────
export async function createCampaign(data: {
  campaign_name: string;
  institute_name: string;
  language?: string;
  voice?: string;
}) {
  return request<{ message: string; campaign_id: number; campaign_name: string; institute_name: string; status: string }>("/campaigns/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getCampaignStatus(campaignId: number) {
  return request<any>(`/campaigns/${campaignId}/status`);
}

export async function getCampaign(campaignId: number) {
  return request<Campaign>(`/campaigns/${campaignId}`);
}

export async function startCampaign(campaignId: number) {
  return request<{ message: string; campaign_id: number }>(`/campaigns/${campaignId}/start`, {
    method: "POST",
  });
}

export async function pauseCampaign(campaignId: number) {
  return request<{ message: string; campaign_id: number }>(`/campaigns/${campaignId}/pause`, {
    method: "POST",
  });
}

export async function resumeCampaign(campaignId: number) {
  return request<{ message: string; campaign_id: number }>(`/campaigns/${campaignId}/resume`, {
    method: "POST",
  });
}

export async function cancelCampaign(campaignId: number) {
  return request<{ message: string; campaign_id: number }>(`/campaigns/${campaignId}/cancel`, {
    method: "POST",
  });
}

// ── Analytics ───────────────────────────────────────────────────
export async function getCampaignAnalytics(campaignId: number) {
  return request<any>(`/analytics/campaign/${campaignId}`);
}

export async function getStudentAnalytics(campaignId: number) {
  return request<{ campaign_id: number; students: any[] }>(`/analytics/campaign/${campaignId}/students`);
}

export async function getStudentSummary(studentId: number) {
  return request<any>(`/analytics/student/${studentId}/summary`);
}
