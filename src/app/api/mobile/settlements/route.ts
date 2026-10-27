import { NextRequest } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  personId: z.string().min(1),
  amount: z.number().positive().max(100_000_000),
  /** paid = you paid them; received = they paid you. */
  direction: z.enum(["paid", "received"]),
  note: z.string().trim().max(200).nullish(),
  occurredAt: z.string().datetime().optional(),
});

/**
 * POST /api/mobile/settlements — record money that moved to square up.
 *
 * Not gated: settling a debt someone already has on record should never sit
 * behind a paywall. It is not a Transaction, so it never shows as spending or
 * income in any total.
 */
export async function POST(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid." }, { status: 400 });
  }
  const d = parsed.data;
  const person = await prisma.person.findFirst({
    where: { id: d.personId, userId: user.id },
    select: { id: true },
  });
  if (!person) return Response.json({ error: "Unknown person." }, { status: 400 });

  const settlement = await prisma.settlement.create({
    data: {
      userId: user.id,
      personId: d.personId,
      amount: Math.round(d.amount * 100) / 100,
      direction: d.direction,
      note: d.note ?? null,
      occurredAt: d.occurredAt ? new Date(d.occurredAt) : new Date(),
    },
    select: { id: true },
  });
  return Response.json({ settlement }, { status: 201 });
}
