import { NextRequest } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";
import { hasKnownTime } from "@/lib/time";
import { isPlus, plusOnlyResponse } from "@/lib/billing";
import { FxUnavailableError, NO_FX, resolveOriginal } from "@/lib/fx";
import { SPLIT_INCLUDE, serializeSplit } from "@/lib/splits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE = 25;

/**
 * Ceiling for `?limit=`. The app pulls its whole history in one request so it
 * can search on-device with no round-trip per keystroke; a year is only a few
 * hundred rows. Anything beyond this still falls back to cursor paging.
 */
const MAX_PAGE = 500;

type TxnWithLines = {
  id: string;
  merchant: string;
  amount: unknown;
  type: string;
  paymentMode: string;
  occurredAt: Date;
  source: string;
  note: string | null;
  originalAmount: unknown;
  originalCurrency: string | null;
  fxRate: unknown;
  fxRateDate: string | null;
  splitTotal: unknown;
  splitMode: string | null;
  paidByPersonId: string | null;
  shares: { personId: string | null; amount: unknown; weight: unknown; person: { name: string } | null }[];
  lines: {
    categoryId: string;
    category: { name: string; parent: { name: string } | null } | null;
  }[];
};

function serialize(t: TxnWithLines) {
  const cat = t.lines[0]?.category ?? null;
  const category = cat ? (cat.parent ? cat.parent.name : cat.name) : "Uncategorized";
  return {
    id: t.id,
    merchant: t.merchant,
    category,
    categoryId: t.lines[0]?.categoryId ?? null,
    amount: Math.round(Number(t.amount)),
    type: t.type as "debit" | "credit",
    paymentMode: t.paymentMode,
    note: t.note,
    occurredAt: t.occurredAt.toISOString(),
    // Lets the app tell a real timestamp from the noon placeholder that
    // statement imports and date-only forms store.
    timeKnown: hasKnownTime(t.occurredAt, t.source),
    // Only present for foreign-currency spend; older apps ignore the key.
    original:
      t.originalCurrency && t.originalAmount != null
        ? {
            amount: Number(t.originalAmount),
            currency: t.originalCurrency,
            rate: Number(t.fxRate),
            rateDate: t.fxRateDate,
          }
        : null,
    // Only present for a split expense, whose `amount` is then your share.
    split: serializeSplit(t),
  };
}

/** Paginated transaction history (cursor = last id from the previous page). */
export async function GET(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const cursor = req.nextUrl.searchParams.get("cursor");
  const requested = Number(req.nextUrl.searchParams.get("limit"));
  const page =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_PAGE)
      : PAGE;

  const rows = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: page + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { lines: { include: { category: { include: { parent: true } } } }, ...SPLIT_INCLUDE },
  });

  const hasMore = rows.length > page;
  const items = rows.slice(0, page).map(serialize);
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
  /**
   * Set when the receipt was in another currency. `amount` is then ignored and
   * worked out here from the rate on the day of purchase.
   */
  original: z
    .object({
      amount: z.coerce.number().positive().max(100_000_000),
      currency: z.string().trim().length(3),
    })
    .optional(),
  /** Minutes ahead of UTC, so "the day of purchase" is the buyer's day. */
  tzOffset: z.coerce.number().int().min(-720).max(840).optional(),
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

  const occurredAt = d.occurredAt ? new Date(d.occurredAt) : new Date();
  let amount = d.amount;
  let fx = NO_FX;
  if (d.original) {
    if (!(await isPlus(user.id))) return plusOnlyResponse("Foreign currency");
    try {
      const resolved = await resolveOriginal(d.original, occurredAt, d.tzOffset);
      amount = resolved.inrAmount;
      fx = resolved.fields;
    } catch (e) {
      if (e instanceof FxUnavailableError) {
        return Response.json({ error: e.message }, { status: 422 });
      }
      throw e;
    }
  }

  const created = await prisma.transaction.create({
    data: {
      userId: user.id,
      merchant: d.merchant,
      amount,
      occurredAt,
      paymentMode: d.paymentMode,
      source: "manual",
      type: d.type,
      note: d.note ?? null,
      ...fx,
      lines: { create: [{ categoryId: d.categoryId, amount }] },
    },
    include: { lines: { include: { category: { include: { parent: true } } } }, ...SPLIT_INCLUDE },
  });

  return Response.json({ transaction: serialize(created) }, { status: 201 });
}
