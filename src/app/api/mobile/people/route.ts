import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";
import { isPlus, plusOnlyResponse } from "@/lib/billing";
import { PersonBody, balances } from "@/lib/splits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/people — everyone you split with, and where you stand.
 *
 * Reading is never gated: if Plus lapses, the record of who owes whom is still
 * yours to see and settle. Only adding new splits needs Plus.
 */
export async function GET(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [people, owed] = await Promise.all([
    prisma.person.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, phone: true, upiId: true, archived: true },
    }),
    balances(user.id),
  ]);

  return Response.json({
    // Archived people only drop out of view once they are square.
    people: people
      .map((p) => ({ ...p, balance: owed.get(p.id) ?? 0 }))
      .filter((p) => !p.archived || p.balance !== 0),
  });
}

/** POST /api/mobile/people — add someone to split with. */
export async function POST(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isPlus(user.id))) return plusOnlyResponse("Splitting bills");

  const parsed = PersonBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid." }, { status: 400 });
  }
  const count = await prisma.person.count({ where: { userId: user.id } });
  if (count >= 500) {
    return Response.json({ error: "That's a lot of people. Archive some first." }, { status: 400 });
  }
  const person = await prisma.person.create({
    data: {
      userId: user.id,
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      upiId: parsed.data.upiId ?? null,
    },
    select: { id: true, name: true, phone: true, upiId: true, archived: true },
  });
  return Response.json({ person: { ...person, balance: 0 } }, { status: 201 });
}
