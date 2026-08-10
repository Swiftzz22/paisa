import { NextRequest } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UpdateBody = z.object({
  amount: z.coerce.number().positive().max(100_000_000),
  merchant: z.string().trim().min(1).max(120),
  categoryId: z.string().min(1),
  paymentMode: z.string().trim().min(1).max(40),
  type: z.enum(["debit", "credit"]).default("debit"),
  note: z.string().trim().max(500).optional(),
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

  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id },
      data: {
        merchant: d.merchant,
        amount: d.amount,
        paymentMode: d.paymentMode,
        type: d.type,
        note: d.note ?? null,
      },
    });

    if (existing.lines.length === 1) {
      await tx.expenseLine.update({
        where: { id: existing.lines[0].id },
        data: { categoryId: d.categoryId, amount: d.amount },
      });
    } else {
      await tx.expenseLine.deleteMany({ where: { transactionId: id } });
      await tx.expenseLine.create({
        data: { transactionId: id, categoryId: d.categoryId, amount: d.amount },
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
