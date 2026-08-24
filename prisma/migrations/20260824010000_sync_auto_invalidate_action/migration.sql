-- Automatic invalidation of stale human verifications.
--
-- `scripts/sync-marker-bills.ts` rewrites MarkerAchievement evidence fields on
-- every run. Before this change it did so even on rows a human had already
-- verified, leaving the approval attached to evidence the reviewer never saw.
-- The sync now resets those rows to PENDING and records the change; that audit
-- row needs an action value that is honestly not a human action.
ALTER TYPE "AchievementReviewAction" ADD VALUE IF NOT EXISTS 'AUTO_INVALIDATE';
