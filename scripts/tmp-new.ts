import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { randomBytes } from "node:crypto";
import "dotenv/config";
async function main() {
  const p = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:dev.db" }) });
  const u = await p.user.create({ data: { email: "__hicks_test__@example.com", name: "Test Person" } });
  const token = randomBytes(24).toString("hex");
  await p.session.create({ data: { token, userId: u.id, expiresAt: new Date(Date.now() + 3600e3) } });
  console.log(token + " " + u.id);
  await p.$disconnect();
}
main();
