-- CreateTable
CREATE TABLE "Post" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" DATETIME,
    "category" TEXT,
    "featuredImage" TEXT,
    "bodyHtml" TEXT NOT NULL,
    "imagesJson" TEXT NOT NULL DEFAULT '[]',
    "linksJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'scraped',
    "wpPostId" INTEGER,
    "scrapedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wpPublishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "postsFound" INTEGER NOT NULL DEFAULT 0,
    "postsScraped" INTEGER NOT NULL DEFAULT 0,
    "postsPublished" INTEGER NOT NULL DEFAULT 0,
    "postsSkipped" INTEGER NOT NULL DEFAULT 0,
    "errorLog" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Post_sourceUrl_key" ON "Post"("sourceUrl");
