-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sourceUrl" TEXT,
    "wpUrl" TEXT,
    "wpUsername" TEXT,
    "wpAppPasswordEnc" TEXT,
    "scrapeCron" TEXT,
    "scrapeCronEnabled" BOOLEAN,
    "updatedAt" DATETIME NOT NULL
);
