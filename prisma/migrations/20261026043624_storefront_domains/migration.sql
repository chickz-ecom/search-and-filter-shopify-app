-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "storefrontDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];
