export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredSessions, sessions } from "@/lib/session-store";

function ensureReceivers(session: any) {
  if (!session.receivers) {
    session.receivers = {};
  }
  return session.receivers;
}

function getReceiverId(body: any) {
  return typeof body.receiverId === "string" && body.receiverId.trim()
    ? body.receiverId.trim()
    : "legacy";
}

function syncLegacyReceiverState(session: any) {
  const activeReceivers = Object.values(ensureReceivers(session)).filter((receiver: any) => receiver.active);
  session.receiverActive = activeReceivers.length > 0;
  const firstReceiver = activeReceivers[0] as any;
  session.receiverName = firstReceiver?.receiverName;
  session.receiverIp = firstReceiver?.receiverIp;
}

function addUniqueCandidate(candidates: any[], candidate: any) {
  const exists = candidates.some(
    (c) => JSON.stringify(c) === JSON.stringify(candidate)
  );
  if (!exists) {
    candidates.push(candidate);
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    cleanupExpiredSessions();
    const { id } = await params;
    const session = sessions.get(id);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, session });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    cleanupExpiredSessions();
    const { id } = await params;
    const key = id;
    const session = sessions.get(key);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "join":
        const receiverId = getReceiverId(body);
        const forwarded = req.headers.get("x-forwarded-for");
        const receivers = ensureReceivers(session);
        receivers[receiverId] = {
          id: receiverId,
          active: true,
          joinedAt: receivers[receiverId]?.joinedAt || Date.now(),
          receiverName: body.receiverName || "Unknown Receiver",
          receiverIp: forwarded ? forwarded.split(/,\s*/)[0].trim() : "127.0.0.1",
          offer: undefined,
          answer: undefined,
          broadcasterIce: [],
          receiverIce: [],
        };
        syncLegacyReceiverState(session);
        break;

      case "leave":
        const leavingReceiverId = getReceiverId(body);
        if (session.receivers?.[leavingReceiverId]) {
          delete session.receivers[leavingReceiverId];
        } else {
          session.receiverActive = false;
          session.receiverName = undefined;
          session.receiverIp = undefined;
          session.receiverIce = [];
          session.answer = undefined;
        }
        syncLegacyReceiverState(session);
        break;

      case "buffer":
        if (!["small", "medium", "large"].includes(body.bufferSize)) {
          return NextResponse.json(
            { success: false, error: "Invalid buffer size" },
            { status: 400 }
          );
        }
        session.bufferSize = body.bufferSize;
        break;

      case "offer":
        if (!body.offer) {
          return NextResponse.json(
            { success: false, error: "Missing SDP offer" },
            { status: 400 }
          );
        }
        if (body.receiverId) {
          const offerReceiverId = getReceiverId(body);
          const offerReceivers = ensureReceivers(session);
          if (!offerReceivers[offerReceiverId]) {
            return NextResponse.json(
              { success: false, error: "Receiver not found" },
              { status: 404 }
            );
          }
          offerReceivers[offerReceiverId].offer = body.offer;
          offerReceivers[offerReceiverId].broadcasterIce = [];
          offerReceivers[offerReceiverId].answer = undefined;
        } else {
          session.offer = body.offer;
        }
        break;

      case "answer":
        if (!body.answer) {
          return NextResponse.json(
            { success: false, error: "Missing SDP answer" },
            { status: 400 }
          );
        }
        if (body.receiverId) {
          const answerReceiverId = getReceiverId(body);
          const answerReceivers = ensureReceivers(session);
          if (!answerReceivers[answerReceiverId]) {
            return NextResponse.json(
              { success: false, error: "Receiver not found" },
              { status: 404 }
            );
          }
          answerReceivers[answerReceiverId].answer = body.answer;
        } else {
          session.answer = body.answer;
        }
        break;

      case "candidate":
        if (!body.candidate) {
          return NextResponse.json(
            { success: false, error: "Missing ICE candidate" },
            { status: 400 }
          );
        }
        if (body.role === "broadcaster") {
          if (body.receiverId) {
            const broadcasterCandidateReceiverId = getReceiverId(body);
            const broadcasterCandidateReceiver = ensureReceivers(session)[broadcasterCandidateReceiverId];
            if (!broadcasterCandidateReceiver) {
              return NextResponse.json(
                { success: false, error: "Receiver not found" },
                { status: 404 }
              );
            }
            addUniqueCandidate(broadcasterCandidateReceiver.broadcasterIce, body.candidate);
          } else {
            addUniqueCandidate(session.broadcasterIce, body.candidate);
          }
        } else if (body.role === "receiver") {
          if (body.receiverId) {
            const receiverCandidateReceiverId = getReceiverId(body);
            const receiverCandidateReceiver = ensureReceivers(session)[receiverCandidateReceiverId];
            if (!receiverCandidateReceiver) {
              return NextResponse.json(
                { success: false, error: "Receiver not found" },
                { status: 404 }
              );
            }
            addUniqueCandidate(receiverCandidateReceiver.receiverIce, body.candidate);
          } else {
            addUniqueCandidate(session.receiverIce, body.candidate);
          }
        } else {
          return NextResponse.json(
            { success: false, error: "Invalid role specified" },
            { status: 400 }
          );
        }
        break;

      case "close":
        sessions.delete(key);
        return NextResponse.json({ success: true, message: "Session closed and cleaned up" });

      default:
        return NextResponse.json(
          { success: false, error: "Invalid action" },
          { status: 400 }
        );
    }

    // Save back to sessions map (though object references in Map are already updated, this is a clean habit)
    sessions.set(key, session);

    return NextResponse.json({ success: true, session });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}
