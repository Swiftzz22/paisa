import "server-only";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Database adapter selection:
 *   - Production (Vercel) or USE_TURSO=1  → Turso/libSQL over the network.
 *   - Everything else (local dev)         → the SQLite file via better-sqlite3.
 *
 * Both share the same Prisma schema (provider = "sqlite"); libSQL is
 * SQLite-on-the-wire, so no query changes are needed.
 */
const useTurso =
  Boolean(process.env.VERCEL) || process.env.USE_TURSO === "1";

declare global {
  // eslint-disable-next-line no-var
  var prismaClient: PrismaClient | undefined;
}

function createClient() {
  if (useTurso) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error("TURSO_DATABASE_URL is not set.");
    const adapter = new PrismaLibSql({ url, authToken });
    return new PrismaClient({ adapter });
  }
  const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  return new PrismaClient({ adapter });
}

export const prisma = globalThis.prismaClient ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaClient = prisma;
}
