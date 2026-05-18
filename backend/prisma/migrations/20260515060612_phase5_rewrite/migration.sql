-- AlterTable
ALTER TABLE "Post" ADD COLUMN "rewrittenBodyHtml" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "anthropicApiKeyEnc" TEXT;
ALTER TABLE "Settings" ADD COLUMN "rewriteEnabled" BOOLEAN;
ALTER TABLE "Settings" ADD COLUMN "rewriteModel" TEXT;
