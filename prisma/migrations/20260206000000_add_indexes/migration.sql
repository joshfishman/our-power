-- CreateIndex
CREATE INDEX "Activity_targetUserId_createdAt_idx" ON "Activity"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_targetUserId_isNotificationRead_idx" ON "Activity"("targetUserId", "isNotificationRead");

-- CreateIndex
CREATE INDEX "Campaign_status_createdAt_idx" ON "Campaign"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_orgId_createdAt_idx" ON "Campaign"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_userId_createdAt_idx" ON "Post"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_campaignId_createdAt_idx" ON "Post"("campaignId", "createdAt");
