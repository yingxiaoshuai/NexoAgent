import { createHash, randomUUID } from "node:crypto";
import type { ChatMessage } from "../../src/shared/types";
import { streamFromLLM } from "./agent";
import { createSseQueue, scheduleSseCleanup } from "./sse";
import { buildRuntimeSettings } from "./settings";
import { ensureSessionsLoaded, getSessionsMap, saveSessionsToDisk } from "./sessions";
import type { ChannelId } from "./channel-store";
import type { Session } from "./types";

export interface IncomingChannelMessage {
  channel: ChannelId;
  text: string;
  senderId?: string;
  conversationId?: string;
  raw?: unknown;
  xml?: Record<string, string>;
}

export interface ChannelRunResult {
  sessionId: string;
  reply: string;
}

function parseJsonMaybe(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function readPath(value: unknown, path: string[]) {
  let cursor = value;
  for (const key of path) {
    if (typeof cursor !== "object" || cursor === null || !(key in cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function readStringPath(value: unknown, paths: string[][]) {
  for (const path of paths) {
    const raw = readPath(value, path);
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  }
  return "";
}

function stripAtPrefix(value: string) {
  return value.replace(/^@\S+\s*/, "").trim();
}

export function parseXmlFields(raw: string) {
  const fields: Record<string, string> = {};
  for (const match of raw.matchAll(/<([A-Za-z0-9_]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/\1>/g)) {
    fields[match[1]] = (match[2] ?? match[3] ?? "").trim();
  }
  return fields;
}

export function buildTextXmlReply(toUser: string, fromUser: string, content: string) {
  return [
    "<xml>",
    `<ToUserName><![CDATA[${toUser}]]></ToUserName>`,
    `<FromUserName><![CDATA[${fromUser}]]></FromUserName>`,
    `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>`,
    "<MsgType><![CDATA[text]]></MsgType>",
    `<Content><![CDATA[${content}]]></Content>`,
    "</xml>",
  ].join("");
}

export function verifyWechatSignature(token: string, signature?: string, timestamp?: string, nonce?: string) {
  if (!token || !signature || !timestamp || !nonce) return !token;
  const digest = createHash("sha1").update([token, timestamp, nonce].sort().join("")).digest("hex");
  return digest === signature;
}

export function extractChannelMessage(channel: ChannelId, body: unknown): IncomingChannelMessage | null {
  if (typeof body === "string") {
    const xml = parseXmlFields(body);
    const text = xml.Content || xml.MsgType || "";
    if (!text) return null;
    return {
      channel,
      text,
      senderId: xml.FromUserName || xml.FromUserId || xml.UserID,
      conversationId: xml.ToUserName || xml.AgentID,
      raw: body,
      xml,
    };
  }

  const payload = parseJsonMaybe(body);
  if (typeof payload !== "object" || payload === null) return null;

  if (channel === "dingtalk") {
    const text = stripAtPrefix(readStringPath(payload, [["text", "content"], ["content"], ["message"], ["msg"]]));
    if (!text) return null;
    return {
      channel,
      text,
      senderId: readStringPath(payload, [["senderStaffId"], ["senderId"], ["senderNick"]]),
      conversationId: readStringPath(payload, [["conversationId"], ["conversationTitle"]]),
      raw: payload,
    };
  }

  if (channel === "feishu") {
    const content = parseJsonMaybe(readPath(payload, ["event", "message", "content"]));
    const text = readStringPath(content, [["text"]])
      || readStringPath(payload, [["event", "message", "content"], ["message"], ["content"]]);
    if (!text) return null;
    return {
      channel,
      text,
      senderId: readStringPath(payload, [["event", "sender", "sender_id", "user_id"], ["event", "sender", "sender_id", "open_id"]]),
      conversationId: readStringPath(payload, [["event", "message", "chat_id"], ["event", "message", "message_id"]]),
      raw: payload,
    };
  }

  const text = readStringPath(payload, [["text"], ["content"], ["message"], ["msg"]]);
  if (!text) return null;
  return {
    channel,
    text,
    senderId: readStringPath(payload, [["from"], ["user"], ["sender"], ["senderId"]]),
    conversationId: readStringPath(payload, [["conversationId"], ["chatId"], ["roomId"]]),
    raw: payload,
  };
}

export async function runChannelMessage(message: IncomingChannelMessage, getStoredApiKey: () => string): Promise<ChannelRunResult> {
  await ensureSessionsLoaded();
  const now = new Date().toISOString();
  const sessionId = randomUUID();
  const requestId = randomUUID();
  const senderLabel = message.senderId || message.conversationId || "incoming";
  const title = `[${message.channel}] ${senderLabel}`;
  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: message.text,
    createdAt: now,
    status: "done",
  };

  const session: Session = {
    id: sessionId,
    title,
    messages: [userMsg],
    createdAt: now,
    updatedAt: now,
  };

  getSessionsMap().set(sessionId, session);
  createSseQueue(requestId);

  const doneEvent = await streamFromLLM(buildRuntimeSettings(), session, requestId, getStoredApiKey());
  const reply = doneEvent?.content?.trim() || "已收到。";
  session.messages.push({
    id: randomUUID(),
    role: "assistant",
    content: reply,
    createdAt: new Date().toISOString(),
    status: "done",
  });
  session.updatedAt = new Date().toISOString();

  await saveSessionsToDisk();
  scheduleSseCleanup(requestId);
  return { sessionId, reply };
}
