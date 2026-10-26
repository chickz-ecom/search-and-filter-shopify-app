-- AlterTable
ALTER TABLE "SearchSettings" ADD COLUMN     "semanticSearch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "semanticStrictness" TEXT NOT NULL DEFAULT 'balanced';
