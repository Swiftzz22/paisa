import { NextRequest } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";
import { isPlus, plusOnlyResponse } from "@/lib/billing";
import { PersonBody, balances } from "@/lib/splits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET — one person, their balance, and every split and settlement with them. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const person = await prisma.person.findFirst({
    where: { id, userId: user.id },
    select: { id: true, name: true, phone: true, upiId: true, archived: true },
  });
  if (!person) return Response.json({ error: "Not found." }, { status: 404 });

  // Expenses they were in, or paid for.
  const [txns, settlements, owed] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        OR: [{ shares: { some: { personId: id } } }, { paidByPersonId: id }],
      },
      orderBy: { occurredAt: "desc" },
      take: 200,
      select: {
        id: true,
        merchant: true,
        occurredAt: true,
        splitTotal: true,
        paidByPersonId: true,
        shares: { select: { personId: true, amount: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { userId: user.id, personId: id },
      orderBy: { occurredAt: "desc" },
      take: 200,
      select: { id: true, amount: true, direction: true, occurredAt: true, note: true },
    }),
    balances(user.id),
  ]);

  // From your side, as on the list: + they owe you, − you owe them.
  const activity = [
    ...txns.map((t) => {
      const theirs = Number(t.shares.find((s) => s.personId === id)?.amount ?? 0);
      const mine = Number(t.shares.find((s) => s.personId === null)?.amount ?? 0);
      const effect = t.paidByPersonId === null ? theirs : t.paidByPersonId === id ? -mine : 0;
      return {
        kind: "split" as const,
        id: t.id,
        title: t.merchant,
        at: t.occurredAt.toISOString(),
        total: Number(t.splitTotal ?? 0),
        paidBy: t.paidByPersonId,
        effect,
      };
    }),
    ...settlements.map((s) => ({
      kind: "settlement" as const,
      id: s.id,
      title: s.direction === "paid" ? `You paid ${person.name}` : `${person.name} paid you`,
      at: s.occurredAt.toISOString(),
      total: Number(s.amount),
      note: s.note,
      effect: s.direction === "paid" ? Number(s.amount) : -Number(s.amount),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return Response.json({ person: { ...person, balance: owed.get(id) ?? 0 }, activity });
}

/** PATCH — rename, add a UPI ID, or archive (people with history are never deleted). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isPlus(user.id))) return plusOnlyResponse("Splitting bills");
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = PersonBody.partial().extend({ archived: z.boolean().optional() }).safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid." }, { status: 400 });
  }
  const existing = await prisma.person.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!existing) return Response.json({ error: "Not found." }, { status: 404 });

  const d = parsed.data;
  const person = await prisma.person.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.phone !== undefined ? { phone: d.phone ?? null } : {}),
      ...(d.upiId !== undefined ? { upiId: d.upiId ?? null } : {}),
      ...(d.archived !== undefined ? { archived: d.archived } : {}),
    },
    select: { id: true, name: true, phone: true, upiId: true, archived: true },
  });
  return Response.json({ person });
}
