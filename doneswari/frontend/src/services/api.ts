import axios from 'axios';
import type { UploadResponse, Agent, ChatResponse } from '../types';

const API = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

export const uploadDocument = async (file: File): Promise<UploadResponse> => {
  const form = new FormData();
  form.append('file', file);
  const { data } = await API.post('/documents/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

export const startTraining = async (agentId: string): Promise<void> => {
  await API.post(`/agents/train/${agentId}`);
};

export const getAgent = async (agentId: string): Promise<Agent> => {
  const { data } = await API.get(`/agents/${agentId}`);
  return data;
};

export const getKnowledge = async (agentId: string) => {
  const { data } = await API.get(`/agents/${agentId}/knowledge`);
  return data;
};

export const sendChat = async (
  agentId: string,
  message: string,
  conversationId?: string
): Promise<ChatResponse> => {
  const { data } = await API.post(`/agents/${agentId}/chat`, {
    message,
    conversation_id: conversationId,
  });
  return data;
};

export const textToSpeech = async (agentId: string, text: string): Promise<ArrayBuffer> => {
  const { data } = await API.post(
    `/agents/${agentId}/voice/tts`,
    { text },
    { responseType: 'arraybuffer' }
  );
  return data;
};

export const subscribeTrainingProgress = (
  agentId: string,
  onProgress: (p: any) => void,
  onComplete: () => void,
  onError: (e: string) => void
) => {
  const eventSource = new EventSource(`/api/agents/train/${agentId}/status`);
  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      onProgress(data);
      if (data.status === 'complete') {
        eventSource.close();
        onComplete();
      } else if (data.status === 'failed') {
        eventSource.close();
        onError(data.message);
      }
    } catch {}
  };
  eventSource.onerror = () => {
    eventSource.close();
  };
  return () => eventSource.close();
};
