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

  connect(callbacks: WSCallback) {
    this.callbacks = callbacks;
    this._connect();
  }

  private _connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/live-dashboard`;

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
            case "activity":
              if (this.callbacks.onActivity) {
                this.callbacks.onActivity(msg.data);
              }
              break;
            case "student_calling":
              if (this.callbacks.onStudentCalling) {
                this.callbacks.onStudentCalling(msg.data);
              }
              break;
            case "stats_update":
              if (this.callbacks.onStatsUpdate) {
                this.callbacks.onStatsUpdate(msg.data);
              }
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
