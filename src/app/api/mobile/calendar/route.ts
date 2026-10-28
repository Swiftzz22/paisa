import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";
import {
  getSpendingCalendar,
  localDayBounds,
  parseDayKey,
  parseMonthKey,
} from "@/lib/calendar";
import { MOBILE_TXN_INCLUDE, toMobileTxn } from "@/lib/mobile-txn";
import { clampTzOffset, localParts } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The spending calendar for the native app. Bearer-token authenticated.
 *
 *   GET ?month=2026-10&tzOffset=330  → one entry per day, debits only
 *   GET ?day=2026-10-14&tzOffset=330 → that day's transactions
 *
 * Read-only. `month` defaults to the current local month.
 */
export async function GET(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const tzOffset = clampTzOffset(params.get("tzOffset"));

  const dayParam = params.get("day");
  if (dayParam !== null) {
    const day = parseDayKey(dayParam);
    if (!day) return Response.json({ error: "day must be YYYY-MM-DD." }, { status: 400 });
    const { from, to } = localDayBounds(day.year, day.month, day.day, tzOffset);
    const rows = await prisma.transaction.findMany({
      where: { userId: user.id, occurredAt: { gte: from, lte: to } },
      orderBy: { occurredAt: "desc" },
      include: MOBILE_TXN_INCLUDE,
    });
    return Response.json({ date: dayParam, transactions: rows.map(toMobileTxn) });
  }

  const monthParam = params.get("month");
  const now = new Date();
  const month = monthParam === null ? localParts(now, tzOffset) : parseMonthKey(monthParam);
  if (!month) return Response.json({ error: "month must be YYYY-MM." }, { status: 400 });

  return Response.json(
    await getSpendingCalendar(user.id, month.year, month.month, tzOffset, now)
  );
}
