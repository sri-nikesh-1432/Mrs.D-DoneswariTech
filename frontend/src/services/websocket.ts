import type { Activity, Student } from "../types";

type WSCallback = {
  onActivity?: (activity: Activity) => void;
  onStudentCalling?: (student: Student) => void;
  onStatsUpdate?: (data: any) => void;
  onStatusChange?: (status: string) => void;
};

class WebSocketService {
  private ws: WebSocket | null = null;
  private callbacks: WSCallback = {};
  private reconnectTimer: number | null = null;
  private isConnected = false;
  private campaignId: number | null = null;

  connect(callbacks: WSCallback, campaignId?: number) {
    this.callbacks = callbacks;
    this.campaignId = campaignId || null;
    this._connect();
  }

  private _connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = this.campaignId 
      ? `${protocol}//${host}/api/ws/campaign/${this.campaignId}`
      : `${protocol}//${host}/api/ws/campaign/0`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log("WebSocket connected");
        if (this.callbacks.onStatusChange) {
          this.callbacks.onStatusChange("connected");
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "campaign_update":
              if (this.callbacks.onActivity) {
                this.callbacks.onActivity({
                  type: msg.update_type,
                  message: msg.update_type,
                  timestamp: msg.timestamp
                });
              }
              break;
            case "student_update":
              if (this.callbacks.onStudentCalling) {
                this.callbacks.onStudentCalling(msg.data);
              }
              break;
            case "call_status_update":
              if (this.callbacks.onStudentCalling) {
                this.callbacks.onStudentCalling({
                  id: msg.student_id,
                  status: msg.status,
                  ...msg.data
                });
              }
              break;
            case "campaign_statistics":
              if (this.callbacks.onStatsUpdate) {
                this.callbacks.onStatsUpdate(msg.statistics);
              }
              break;
            case "connected":
              console.log("WebSocket connection confirmed");
              break;
            case "ping":
              this.send("pong");
              break;
          }
        } catch (e) {
          console.error("WS message error:", e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        console.log("WebSocket disconnected");
        if (this.callbacks.onStatusChange) {
          this.callbacks.onStatusChange("disconnected");
        }
        // Reconnect after 3 seconds
        this.reconnectTimer = window.setTimeout(() => this._connect(), 3000);
      };

      this.ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        this.ws?.close();
      };
    } catch (e) {
      console.error("WebSocket connection failed:", e);
      this.reconnectTimer = window.setTimeout(() => this._connect(), 3000);
    }
  }

  send(data: string) {
    if (this.ws && this.isConnected) {
      this.ws.send(data);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

export const wsService = new WebSocketService();
