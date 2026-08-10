import { NextRequest } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE = 25;

type TxnWithLines = {
  id: string;
  merchant: string;
  amount: unknown;
  type: string;
  paymentMode: string;
  occurredAt: Date;
  note: string | null;
  lines: { category: { name: string; parent: { name: string } | null } | null }[];
};

function serialize(t: TxnWithLines) {
  const cat = t.lines[0]?.category ?? null;
  const category = cat ? (cat.parent ? cat.parent.name : cat.name) : "Uncategorized";
  return {
    id: t.id,
    merchant: t.merchant,
    category,
    amount: Math.round(Number(t.amount)),
    type: t.type as "debit" | "credit",
    paymentMode: t.paymentMode,
    note: t.note,
    occurredAt: t.occurredAt.toISOString(),
  };
}

/** Paginated transaction history (cursor = last id from the previous page). */
export async function GET(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const cursor = req.nextUrl.searchParams.get("cursor");
  const rows = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { lines: { include: { category: { include: { parent: true } } } } },
  });

  const hasMore = rows.length > PAGE;
  const items = rows.slice(0, PAGE).map(serialize);
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return Response.json({ items, nextCursor });
}

const CreateBody = z.object({
  amount: z.coerce.number().positive().max(100_000_000),
  merchant: z.string().trim().min(1).max(120),
  categoryId: z.string().min(1),
  paymentMode: z.string().trim().min(1).max(40),
  type: z.enum(["debit", "credit"]).default("debit"),
  occurredAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional(),
});

/** Create a manual transaction from the native "+" screen. */
export async function POST(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const d = parsed.data;

  // The category must belong to this user — never trust a client-supplied id.
  const category = await prisma.category.findFirst({
    where: { id: d.categoryId, userId: user.id },
    select: { id: true },
  });
  if (!category) {
    return Response.json({ error: "Unknown category." }, { status: 400 });
  }

  const created = await prisma.transaction.create({
    data: {
      userId: user.id,
      merchant: d.merchant,
      amount: d.amount,
      occurredAt: d.occurredAt ? new Date(d.occurredAt) : new Date(),
      paymentMode: d.paymentMode,
      source: "manual",
      type: d.type,
      note: d.note ?? null,
      lines: { create: [{ categoryId: d.categoryId, amount: d.amount }] },
    },
    include: { lines: { include: { category: { include: { parent: true } } } } },
  });

  return Response.json({ transaction: serialize(created) }, { status: 201 });
}
