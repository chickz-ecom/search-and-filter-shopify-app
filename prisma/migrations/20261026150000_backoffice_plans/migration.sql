-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "adminNotes" TEXT;

-- CreateTable
CREATE TABLE "PlanConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceUsd" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "maxProducts" INTEGER NOT NULL,
    "rpm" INTEGER NOT NULL,
    "headless" BOOLEAN NOT NULL DEFAULT false,
    "semantic" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanConfig_pkey" PRIMARY KEY ("id")
);

