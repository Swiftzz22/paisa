import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { getCategoryOptions } from "@/lib/categories";
import { getActivePaymentModes } from "@/lib/payment-modes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Form metadata for the native add-transaction screen. */
export async function GET(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [categories, modes] = await Promise.all([
    getCategoryOptions(user.id),
    getActivePaymentModes(user.id),
  ]);

  return Response.json({
    categories: categories.map((c) => ({ id: c.id, label: c.label, depth: c.depth })),
    paymentModes: modes.map((m) => ({ value: m.value, label: m.label })),
  });
}
