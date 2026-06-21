import "server-only";
import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import { makeAuthorizedClient } from "@/lib/email/google-oauth";
import { buildFinancialSenderQuery } from "@/lib/email/classify";

export type FetchedMessage = {
  messageId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  receivedAt: Date;
  html: string;
  text: string | null;
};

export type FetchOptions = {
  /** Cap on results. Gmail allows up to 500 per page. */
  limit: number;
  /** Only fetch emails received on or after this date (inclusive). */
  after?: Date;
  /** Only fetch emails received before this date (exclusive). */
  before?: Date;
};

/**
 * Fetch up to `limit` messages from anywhere in the user's mail, filtered to
 * known financial senders (banks, UPI, cards). The Gmail-side filter avoids
 * pulling promos and newsletters that we'd otherwise discard locally.
 */
export async function fetchRecent(
  refreshToken: string,
  opts: FetchOptions
): Promise<FetchedMessage[]> {
  const auth = makeAuthorizedClient(refreshToken);
  const gmail = google.gmail({ version: "v1", auth });

  const q = buildQuery(opts);
  const out: FetchedMessage[] = [];
  let pageToken: string | undefined;

  // Paginate until we've collected up to `limit` messages or Gmail has
  // nothing more to return. Each `list` page caps at 500 from the API.
  while (out.length < opts.limit) {
    const remaining = opts.limit - out.length;
    const pageSize = Math.min(500, remaining);
    const list = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: pageSize,
      pageToken,
    });

    const ids = list.data.messages ?? [];
    if (ids.length === 0) break;

    for (const ref of ids) {
      if (!ref.id) continue;
      if (out.length >= opts.limit) break;
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: ref.id,
        format: "full",
      });
      out.push(extractMessage(msg.data));
    }

    if (!list.data.nextPageToken) break;
    pageToken = list.data.nextPageToken;
  }

  out.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  return out;
}

function buildQuery(opts: FetchOptions): string {
  const parts: string[] = [buildFinancialSenderQuery()];
  if (opts.after) parts.push(`after:${gmailDate(opts.after)}`);
  if (opts.before) parts.push(`before:${gmailDate(opts.before)}`);
  return parts.join(" ");
}

function gmailDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function extractMessage(msg: gmail_v1.Schema$Message): FetchedMessage {
  const headers = msg.payload?.headers ?? [];
  const headerMap: Record<string, string> = {};
  for (const h of headers) {
    if (h.name && h.value) headerMap[h.name.toLowerCase()] = h.value;
  }

  const fromHeader = headerMap["from"] ?? "";
  const { name: fromName, address: fromAddress } = parseAddress(fromHeader);
  const subject = headerMap["subject"] ?? "";

  let receivedAt: Date;
  if (msg.internalDate) {
    receivedAt = new Date(Number(msg.internalDate));
  } else if (headerMap["date"]) {
    receivedAt = new Date(headerMap["date"]);
  } else {
    receivedAt = new Date();
  }

  const { html, text } = extractBodies(msg.payload ?? null);

  return {
    messageId: msg.id ?? "",
    fromAddress,
    fromName,
    subject,
    receivedAt,
    html,
    text,
  };
}

function parseAddress(raw: string): { name: string | null; address: string } {
  // "Some Bank <alerts@bank.com>" or just "alerts@bank.com"
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (match) {
    const name = match[1].trim();
    return { name: name || null, address: match[2].trim() };
  }
  return { name: null, address: raw.trim() };
}

function extractBodies(payload: gmail_v1.Schema$MessagePart | null): {
  html: string;
  text: string | null;
} {
  if (!payload) return { html: "", text: null };

  const acc = { html: "", text: "" as string };

  function walk(part: gmail_v1.Schema$MessagePart) {
    const mime = part.mimeType ?? "";
    const data = part.body?.data;
    if (data) {
      const decoded = decodeBase64Url(data);
      if (mime === "text/html") acc.html += decoded;
      else if (mime === "text/plain") acc.text += decoded;
    }
    for (const sub of part.parts ?? []) walk(sub);
  }

  walk(payload);

  return {
    html: acc.html,
    text: acc.text ? acc.text : null,
  };
}

function decodeBase64Url(s: string): string {
  // Gmail uses URL-safe base64 without padding.
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}
