import { NextRequest } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";
import { isPlus, plusOnlyResponse } from "@/lib/billing";
import { FxUnavailableError, NO_FX, resolveOriginal, type ResolvedFx } from "@/lib/fx";
import { removeSplit } from "@/lib/splits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UpdateBody = z.object({
  amount: z.coerce.number().positive().max(100_000_000),
  merchant: z.string().trim().min(1).max(120),
  categoryId: z.string().min(1),
  paymentMode: z.string().trim().min(1).max(40),
  type: z.enum(["debit", "credit"]).default("debit"),
  note: z.string().trim().max(500).optional(),
  /** Same meaning as on create; `null` turns it back into a rupee expense. */
  original: z
    .object({
      amount: z.coerce.number().positive().max(100_000_000),
      currency: z.string().trim().length(3),
    })
    .nullable()
    .optional(),
  tzOffset: z.coerce.number().int().min(-720).max(840).optional(),
});

/** Edit a transaction from the native app. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = UpdateBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const d = parsed.data;

  // Ownership check on BOTH the transaction and the target category.
  const [existing, category] = await Promise.all([
    prisma.transaction.findFirst({
      where: { id, userId: user.id },
      include: { lines: true },
    }),
    prisma.category.findFirst({
      where: { id: d.categoryId, userId: user.id },
      select: { id: true },
    }),
  ]);
  if (!existing) return Response.json({ error: "Not found." }, { status: 404 });
  if (!category) return Response.json({ error: "Unknown category." }, { status: 400 });

  // Three cases for the foreign-currency fields:
  //  - `original` sent: re-convert at the purchase day's rate.
  //  - `original: null`: the person made it a rupee expense again.
  //  - absent (any app that predates this): keep them only while the rupee
  //    amount is unchanged. A new INR amount means the stored receipt amount
  //    no longer describes this transaction, and showing it would be a lie.
  let amount = d.amount;
  let fx: ResolvedFx["fields"] | undefined;
  if (d.original) {
    if (!(await isPlus(user.id))) return plusOnlyResponse("Foreign currency");
    try {
      const resolved = await resolveOriginal(d.original, existing.occurredAt, d.tzOffset);
      amount = resolved.inrAmount;
      fx = resolved.fields;
    } catch (e) {
      if (e instanceof FxUnavailableError) {
        return Response.json({ error: e.message }, { status: 422 });
      }
      throw e;
    }
  } else if (d.original === null) {
    fx = NO_FX;
  } else if (existing.originalCurrency) {
    // The app is sent whole rupees, so an untouched ₹1,234.56 comes back as
    // 1235. That is the same amount, not an edit — keep the exact figure.
    const exact = Number(existing.amount);
    if (Math.round(exact) === d.amount) amount = exact;
    else fx = NO_FX;
  }

  // A split expense's `amount` is your share, which is what the app shows and
  // sends back. Sent back unchanged (allowing for whole-rupee rounding), the
  // split stands. A different amount means the bill itself changed and the old
  // shares no longer describe it, so the split goes and the new figure is the
  // whole bill — the app re-splits straight after if that's what was meant.
  if (existing.splitTotal != null) {
    const mine = Number(existing.amount);
    if (Math.round(mine) === Math.round(amount) && !d.original) {
      amount = mine;
    } else {
      await removeSplit(user.id, id);
      existing.lines = await prisma.expenseLine.findMany({ where: { transactionId: id } });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id },
      data: {
        merchant: d.merchant,
        amount,
        paymentMode: d.paymentMode,
        type: d.type,
        note: d.note ?? null,
        ...fx,
      },
    });

    if (existing.lines.length === 1) {
      await tx.expenseLine.update({
        where: { id: existing.lines[0].id },
        data: { categoryId: d.categoryId, amount },
      });
    } else {
      await tx.expenseLine.deleteMany({ where: { transactionId: id } });
      await tx.expenseLine.create({
        data: { transactionId: id, categoryId: d.categoryId, amount },
      });
    }
  });

  return Response.json({ ok: true });
}

/** Delete a transaction from the native app. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.transaction.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return Response.json({ error: "Not found." }, { status: 404 });

  await prisma.transaction.delete({ where: { id } });
  return Response.json({ ok: true });
}
