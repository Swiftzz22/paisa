-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReceivedEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "uid" INTEGER,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "rawHtml" TEXT NOT NULL,
    "bodyText" TEXT,
    "receivedAt" DATETIME NOT NULL,
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "parseError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReceivedEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReceivedEmail" ("createdAt", "fromAddress", "id", "parseError", "parseStatus", "rawHtml", "receivedAt", "subject", "userId") SELECT "createdAt", "fromAddress", "id", "parseError", "parseStatus", "rawHtml", "receivedAt", "subject", "userId" FROM "ReceivedEmail";
DROP TABLE "ReceivedEmail";
ALTER TABLE "new_ReceivedEmail" RENAME TO "ReceivedEmail";
CREATE INDEX "ReceivedEmail_userId_receivedAt_idx" ON "ReceivedEmail"("userId", "receivedAt");
CREATE UNIQUE INDEX "ReceivedEmail_userId_uid_key" ON "ReceivedEmail"("userId", "uid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
