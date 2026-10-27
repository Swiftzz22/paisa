import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { isPlus, plusOnlyResponse } from "@/lib/billing";
import { FxUnavailableError, getInrRate, localDate } from "@/lib/fx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/fx?currency=USD&date=2026-10-10
 *
 * The rate the app shows as a live preview while someone types a foreign
 * amount. It is only a preview: when the transaction is saved the server looks
 * the rate up again itself, so a client can never choose its own rate.
 */
export async function GET(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (!(await isPlus(user.id))) {
    return plusOnlyResponse("Foreign currency");
  }

  const currency = req.nextUrl.searchParams.get("currency") ?? "";
  const dateParam = req.nextUrl.searchParams.get("date");
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : localDate(new Date());

  try {
    return Response.json(await getInrRate(currency, date));
  } catch (e) {
    if (e instanceof FxUnavailableError) {
      return Response.json({ error: e.message }, { status: 422 });
    }
    throw e;
  }
}
