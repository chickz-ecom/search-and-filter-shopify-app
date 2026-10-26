-- CreateEnum
CREATE TYPE "SyncState" AS ENUM ('IDLE', 'QUEUED', 'RUNNING', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncJobType" AS ENUM ('FULL', 'INCREMENTAL', 'RECONCILE', 'CHECKSUM');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TypoTolerance" AS ENUM ('OFF', 'LOW', 'NORMAL');

-- CreateEnum
CREATE TYPE "OutOfStockMode" AS ENUM ('SHOW', 'HIDE', 'PUSH_DOWN');

-- CreateEnum
CREATE TYPE "SortScope" AS ENUM ('SEARCH', 'COLLECTION_DEFAULT', 'COLLECTION');

-- CreateEnum
CREATE TYPE "FilterScope" AS ENUM ('DEFAULT', 'COLLECTION', 'SEARCH');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('FILTER', 'SORT');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "publicKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "primaryLocale" TEXT NOT NULL DEFAULT 'en',
    "locales" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "markets" JSONB NOT NULL DEFAULT '[]',
    "searchKeyScoped" TEXT,
    "indexAlias" TEXT NOT NULL,
    "indexVersion" INTEGER NOT NULL DEFAULT 0,
    "syncState" "SyncState" NOT NULL DEFAULT 'IDLE',
    "lastFullSyncAt" TIMESTAMP(3),
    "lastIncrementalAt" TIMESTAMP(3),
    "lastSyncedUpdatedAt" TIMESTAMP(3),
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "indexedCount" INTEGER NOT NULL DEFAULT 0,
    "storefrontToken" TEXT,
    "features" JSONB NOT NULL DEFAULT '{}',
    "onboardingDismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "SyncJobType" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "bulkOperationId" TEXT,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchSettings" (
    "shopId" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "typoTolerance" "TypoTolerance" NOT NULL DEFAULT 'NORMAL',
    "minWordLengthFor1Typo" INTEGER NOT NULL DEFAULT 4,
    "minWordLengthFor2Typo" INTEGER NOT NULL DEFAULT 7,
    "prioritizeExactMatch" BOOLEAN NOT NULL DEFAULT true,
    "matchMode" TEXT NOT NULL DEFAULT 'max_score',
    "showOutOfStock" "OutOfStockMode" NOT NULL DEFAULT 'PUSH_DOWN',
    "excludeTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "variantAsProduct" BOOLEAN NOT NULL DEFAULT false,
    "searchTypes" JSONB NOT NULL,
    "relevanceTieBreak" TEXT NOT NULL DEFAULT 'best_selling',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchSettings_pkey" PRIMARY KEY ("shopId")
);

-- CreateTable
CREATE TABLE "SortOption" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,

    CONSTRAINT "SortOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SortDefault" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "scope" "SortScope" NOT NULL,
    "collectionId" TEXT NOT NULL DEFAULT '',
    "sortKey" TEXT NOT NULL,

    CONSTRAINT "SortDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilterSet" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "scope" "FilterScope" NOT NULL,
    "collectionId" TEXT NOT NULL DEFAULT '',
    "items" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilterSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Synonym" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'multi',
    "root" TEXT,
    "terms" TEXT[],
    "locale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Synonym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redirect" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Redirect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "condition" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StopWord" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',

    CONSTRAINT "StopWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appearance" (
    "shopId" TEXT NOT NULL,
    "tokens" JSONB NOT NULL DEFAULT '{}',
    "texts" JSONB NOT NULL DEFAULT '{}',
    "templates" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appearance_pkey" PRIMARY KEY ("shopId")
);

-- CreateTable
CREATE TABLE "AnalyticsDaily" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "zeroResults" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "addToCarts" INTEGER NOT NULL DEFAULT 0,
    "revenueShopCurrency" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsUsageDaily" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("webhookId")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_publicKey_key" ON "Shop"("publicKey");

-- CreateIndex
CREATE INDEX "SyncJob_shopId_startedAt_idx" ON "SyncJob"("shopId", "startedAt");

-- CreateIndex
CREATE INDEX "SortOption_shopId_position_idx" ON "SortOption"("shopId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SortOption_shopId_key_key" ON "SortOption"("shopId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SortDefault_shopId_scope_collectionId_key" ON "SortDefault"("shopId", "scope", "collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "FilterSet_shopId_scope_collectionId_key" ON "FilterSet"("shopId", "scope", "collectionId");

-- CreateIndex
CREATE INDEX "Synonym_shopId_idx" ON "Synonym"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Redirect_shopId_query_key" ON "Redirect"("shopId", "query");

-- CreateIndex
CREATE INDEX "MerchRule_shopId_idx" ON "MerchRule"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "StopWord_shopId_word_locale_key" ON "StopWord"("shopId", "word", "locale");

-- CreateIndex
CREATE INDEX "AnalyticsDaily_shopId_date_idx" ON "AnalyticsDaily"("shopId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDaily_shopId_date_query_key" ON "AnalyticsDaily"("shopId", "date", "query");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsUsageDaily_shopId_date_kind_key_value_key" ON "AnalyticsUsageDaily"("shopId", "date", "kind", "key", "value");

-- CreateIndex
CREATE INDEX "WebhookReceipt_receivedAt_idx" ON "WebhookReceipt"("receivedAt");

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchSettings" ADD CONSTRAINT "SearchSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SortOption" ADD CONSTRAINT "SortOption_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SortDefault" ADD CONSTRAINT "SortDefault_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilterSet" ADD CONSTRAINT "FilterSet_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Synonym" ADD CONSTRAINT "Synonym_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redirect" ADD CONSTRAINT "Redirect_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchRule" ADD CONSTRAINT "MerchRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopWord" ADD CONSTRAINT "StopWord_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appearance" ADD CONSTRAINT "Appearance_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsDaily" ADD CONSTRAINT "AnalyticsDaily_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsUsageDaily" ADD CONSTRAINT "AnalyticsUsageDaily_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
