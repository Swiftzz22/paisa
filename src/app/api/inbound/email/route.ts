import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { userForInboundAddress } from "@/lib/email/inbound";
import {
  isForwardingVerification,
  looksLikeTransactionEmail,
} from "@/lib/email/classify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Guard against a forwarding loop or a bulk dump filling the database. */
const MAX_BODY_CHARS = 200_000;

const Body = z.object({
  /** The paisa address the mail was sent to. */
  to: z.string().min(3).max(320),
  /** Original sender. For forwarded mail this is the bank, not the user. */
  from: z.string().min(3).max(320),
  subject: z.string().max(998).default(""),
  html: z.string().max(MAX_BODY_CHARS).optional(),
  text: z.string().max(MAX_BODY_CHARS).optional(),
  /** RFC Message-ID, used to ignore the same message arriving twice. */
  messageId: z.string().max(998).optional(),
  /** Epoch ms or ISO; when the bank sent it, not when we received it. */
  date: z.union([z.string(), z.number()]).optional(),
});

function receivedAtFrom(value: string | number | undefined): Date {
  if (value === undefined) return new Date();
  const d = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date();
  // A forwarded header can carry a nonsense future date; the moment it reached
  // us is the latest it can honestly have happened.
  return d.getTime() > Date.now() ? new Date() : d;
}

/**
 * Receives bank alerts that a user's Gmail filter forwards to their private
 * paisa address, and stores them for the normal parser to pick up.
 *
 * This is the whole point of the forwarding design: mail is pushed to us, so
 * the app never holds access to anyone's mailbox.
 *
 * Anyone on the internet can post here, so it is deliberately narrow: a shared
 * secret from the mail relay, a recipient that must resolve to a real user, and
 * a sender that must look like a bank. Anything else is accepted and dropped,
 * never stored.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) {
    return Response.json({ error: "Inbound mail not configured." }, { status: 503 });
  }
  const given = req.headers.get("x-inbound-secret") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Bad payload" }, { status: 400 });
  }
  const mail = parsed.data;

  const user = await userForInboundAddress(mail.to);
  // 200 rather than 404: the relay should not retry mail for an address that
  // will never resolve, and a probe should not learn which addresses exist.
  if (!user) return Response.json({ ok: true, ignored: "unknown-recipient" });

  // Gmail's "confirm this forwarding address" mail, which comes from Google
  // and so would be discarded by the bank filter below. Kept, and marked as a
  // notice rather than pending, so it shows in the inbox to be acted on and is
  // never sent to the model — there is no transaction in it to find.
  const isVerification = isForwardingVerification(mail.from);

  // Only mail that looks like a bank alert is kept. A filter set too broadly
  // would otherwise pour someone's whole inbox into our database — their
  // mistake, but our liability.
  if (
    !isVerification &&
    !looksLikeTransactionEmail({ fromAddress: mail.from, subject: mail.subject })
  ) {
    return Response.json({ ok: true, ignored: "not-a-bank-email" });
  }

  const messageId = mail.messageId?.trim() || null;
  if (messageId) {
    const existing = await prisma.receivedEmail.findFirst({
      where: { userId: user.id, messageId },
      select: { id: true },
    });
    // Forwarding rules overlap, and people re-forward things by hand.
    if (existing) return Response.json({ ok: true, ignored: "duplicate" });
  }

  await prisma.receivedEmail.create({
    data: {
      userId: user.id,
      messageId,
      fromAddress: mail.from,
      subject: mail.subject,
      rawHtml: mail.html ?? "",
      bodyText: mail.text ?? null,
      receivedAt: receivedAtFrom(mail.date),
      parseStatus: isVerification ? "notice" : "pending",
    },
  });

  return Response.json({ ok: true, stored: true });
}
