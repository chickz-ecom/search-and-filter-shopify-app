-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UsageKind" ADD VALUE 'FILTER_COMBO';
ALTER TYPE "UsageKind" ADD VALUE 'SUGGESTION';

-- DropIndex
DROP INDEX "AnalyticsUsageDaily_shopId_date_kind_key_value_key";

-- AlterTable
ALTER TABLE "AnalyticsDaily" ADD COLUMN     "orders" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "productsBought" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AnalyticsUsageDaily" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "AnalyticsProductDaily" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "productId" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "searchClicks" INTEGER NOT NULL DEFAULT 0,
    "collectionClicks" INTEGER NOT NULL DEFAULT 0,
    "addToCarts" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsProductDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsCollectionDaily" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "collectionId" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsCollectionDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsProductDaily_shopId_date_idx" ON "AnalyticsProductDaily"("shopId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsProductDaily_shopId_date_productId_key" ON "AnalyticsProductDaily"("shopId", "date", "productId");

-- CreateIndex
CREATE INDEX "AnalyticsCollectionDaily_shopId_date_idx" ON "AnalyticsCollectionDaily"("shopId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsCollectionDaily_shopId_date_collectionId_key" ON "AnalyticsCollectionDaily"("shopId", "date", "collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsUsageDaily_shopId_date_kind_scope_key_value_key" ON "AnalyticsUsageDaily"("shopId", "date", "kind", "scope", "key", "value");

-- AddForeignKey
ALTER TABLE "AnalyticsProductDaily" ADD CONSTRAINT "AnalyticsProductDaily_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsCollectionDaily" ADD CONSTRAINT "AnalyticsCollectionDaily_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

