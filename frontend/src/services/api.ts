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
  return request<{ status: string; knowledge_ready: boolean; campaign_running: boolean }>("/health");
}

// ── Knowledge ───────────────────────────────────────────────────
export async function uploadKnowledge(file: File, campaignId: number): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("campaign_id", String(campaignId));
  const res = await fetch(`${BASE_URL}/upload-knowledge`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function getKnowledgeStatus() {
  return request<{ ready: boolean }>("/knowledge-status");
}

// ── Students ────────────────────────────────────────────────────
export async function uploadStudents(file: File, campaignId: number): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("campaign_id", String(campaignId));
  const res = await fetch(`${BASE_URL}/upload-students`, {
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
  return request<{ students: Student[]; total: number }>(`/students?campaign_id=${campaignId}`);
}

// ── Campaign ────────────────────────────────────────────────────
export async function createCampaign(data: {
  campaign_name: string;
  institute_name: string;
  language?: string;
  voice?: string;
}) {
  return request<{ success: boolean; message: string; data?: Campaign }>("/campaign/create", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getCampaignStatus(campaignId: number) {
  return request<{ success: boolean; data: Campaign }>(
    `/campaign/status?campaign_id=${campaignId}`
  );
}

export async function startCampaign(campaignId: number) {
  return request<{ success: boolean; message: string }>("/campaign/start", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ campaign_id: String(campaignId) }),
  });
}

export async function pauseCampaign() {
  return request<{ success: boolean; message: string }>("/campaign/pause", {
    method: "POST",
  });
}

export async function resumeCampaign() {
  return request<{ success: boolean; message: string }>("/campaign/resume", {
    method: "POST",
  });
}

export async function cancelCampaign(campaignId: number) {
  return request<{ success: boolean; message: string }>("/campaign/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ campaign_id: String(campaignId) }),
  });
}

// ── Reports ─────────────────────────────────────────────────────
export async function getCampaignSummary(campaignId: number) {
  return request<{ success: boolean; data: CampaignStats }>(
    `/reports/campaign-summary?campaign_id=${campaignId}`
  );
}

export function getExportPdfUrl(campaignId: number) {
  return `${BASE_URL}/reports/export-pdf?campaign_id=${campaignId}`;
}
