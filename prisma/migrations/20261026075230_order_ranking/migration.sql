-- AlterTable
ALTER TABLE "SearchSettings" ADD COLUMN     "bestSellingMetric" TEXT NOT NULL DEFAULT 'quantity',
ADD COLUMN     "bestSellingSource" TEXT NOT NULL DEFAULT 'storefront';

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "bestSellingComputedAt" TIMESTAMP(3),
ADD COLUMN     "bestSellingOrders" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OrderLine" (
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("shopId","orderId","productId")
);

-- CreateIndex
CREATE INDEX "OrderLine_shopId_createdAt_idx" ON "OrderLine"("shopId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
