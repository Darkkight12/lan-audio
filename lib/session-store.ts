export interface ReceiverPeerSession {
  id: string;
  active: boolean;
  joinedAt: number;
  receiverName?: string;
  receiverIp?: string;
  offer?: any;
  answer?: any;
  broadcasterIce: any[];
  receiverIce: any[];
}

export interface Session {
  id: string;
  createdAt: number;
  broadcasterActive: boolean;
  receiverActive: boolean;
  offer?: any;
  answer?: any;
  broadcasterIce: any[];
  receiverIce: any[];
  broadcasterName?: string;
  broadcasterIp?: string;
  bufferSize?: "small" | "medium" | "large";
  receiverName?: string;
  receiverIp?: string;
  receivers: Record<string, ReceiverPeerSession>;
}

const globalForSessions = global as unknown as {
  sessions: Map<string, Session>;
};

if (!globalForSessions.sessions) {
  globalForSessions.sessions = new Map();
}

export const sessions = globalForSessions.sessions;

export const SESSION_TTL_MS = 60 * 60 * 1000;

export function cleanupExpiredSessions(now = Date.now()) {
  const expiresBefore = now - SESSION_TTL_MS;

  for (const [id, session] of sessions) {
    if (session.createdAt < expiresBefore) {
      sessions.delete(id);
    }
  }
}
