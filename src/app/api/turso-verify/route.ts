import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// TEMPORARY: Turso support's ownership check. Remove once confirmed.
const TABLE = "7c1d354450e9bf15a33b88a674334fb7";

export async function GET() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${TABLE}"(x)`);
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    TABLE,
  );
  return Response.json({ table: TABLE, exists: rows.length === 1 });
}
