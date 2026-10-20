export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { cleanupExpiredSessions, sessions, Session } from "@/lib/session-store";

function createSessionId() {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const id = randomInt(0, 1_000_000).toString().padStart(6, "0");
    if (!sessions.has(id)) return id;
  }

  throw new Error("Could not allocate a unique session code");
}

export async function GET(req: NextRequest) {
  try {
    cleanupExpiredSessions();
    const forwarded = req.headers.get("x-forwarded-for");
    const requestorIp = forwarded ? forwarded.split(/,\s*/)[0].trim() : "127.0.0.1";

    const activeSessions = [];
    for (const [id, session] of sessions.entries()) {
      if (session.broadcasterActive) {
        const ipMatched = session.broadcasterIp === requestorIp;
        const receiverCount = Object.values(session.receivers || {}).filter((receiver) => receiver.active).length;
        activeSessions.push({
          id: session.id,
          createdAt: session.createdAt,
          broadcasterActive: session.broadcasterActive,
          receiverActive: receiverCount > 0 || session.receiverActive,
          receiverCount,
          broadcasterName: session.broadcasterName || "Unknown Broadcaster",
          bufferSize: session.bufferSize || "medium",
          sameNetwork: ipMatched || requestorIp === "127.0.0.1" || session.broadcasterIp === "127.0.0.1"
        });
      }
    }

    return NextResponse.json({ success: true, sessions: activeSessions });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    cleanupExpiredSessions();

    let body: any = {};
    try {
      body = await req.json();
    } catch (e) {
      // Body is optional
    }

    const broadcasterName = body.broadcasterName || "Unknown Broadcaster";
    const bufferSize = body.bufferSize || "medium";

    // Extract client IP address
    const forwarded = req.headers.get("x-forwarded-for");
    const broadcasterIp = forwarded ? forwarded.split(/,\s*/)[0].trim() : "127.0.0.1";

    const id = createSessionId();

    const session: Session = {
      id,
      createdAt: Date.now(),
      broadcasterActive: true,
      receiverActive: false,
      broadcasterIce: [],
      receiverIce: [],
      receivers: {},
      broadcasterName,
      broadcasterIp,
      bufferSize,
    };

    sessions.set(id, session);

    return NextResponse.json({ success: true, sessionId: id, session });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}
