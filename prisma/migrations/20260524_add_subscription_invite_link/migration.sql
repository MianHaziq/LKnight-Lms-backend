-- CreateTable
CREATE TABLE "SubscriptionInviteLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "SubscriptionInviteLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInviteLink_token_key" ON "SubscriptionInviteLink"("token");

-- CreateIndex
CREATE INDEX "SubscriptionInviteLink_subscriptionId_idx" ON "SubscriptionInviteLink"("subscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionInviteLink_token_idx" ON "SubscriptionInviteLink"("token");

-- CreateIndex
CREATE INDEX "SubscriptionInviteLink_isActive_idx" ON "SubscriptionInviteLink"("isActive");

-- CreateIndex
CREATE INDEX "SubscriptionInviteLink_expiresAt_idx" ON "SubscriptionInviteLink"("expiresAt");

-- AddForeignKey
ALTER TABLE "SubscriptionInviteLink" ADD CONSTRAINT "SubscriptionInviteLink_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInviteLink" ADD CONSTRAINT "SubscriptionInviteLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
