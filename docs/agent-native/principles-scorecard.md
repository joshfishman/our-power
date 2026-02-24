# Agent-Native Principles Scorecard

This scorecard is generated from static capability and CRUD definitions in:

- `src/lib/agent-native/capabilities.ts`
- `src/lib/agent-native/scorecard.ts`

## Current Snapshot

| Principle         | Score                                                           | Status    |
| ----------------- | --------------------------------------------------------------- | --------- |
| Action parity     | 35/42 (83%)                                                     | Strong    |
| CRUD completeness | 6/9 entities (67%)                                              | Partial   |
| Shared workspace  | Single shared Prisma/Supabase data space                        | Strong    |
| UI integration    | React Query invalidation + polling; key silent actions resolved | Improving |

## CRUD Coverage Notes

- Explicit full CRUD: `Organization`, `Campaign`, `CampaignMember`, `Action`, `Post`, `Comment`
- Intentionally partial:
  - `Cause` is read-only seeded reference data.
  - `ActionParticipation` uses update as reversible state instead of hard delete.
  - `User.create` is auth-provider managed (NextAuth).

## Target Milestones

1. **Milestone 1**: parity >= 70% for campaign/action/post/social domains. ✅ Achieved (83%)
2. **Milestone 2**: parity >= 90% by adding remaining social like/unlike and follow/unfollow tools.
3. **Milestone 3**: stable score checks in CI for parity/CRUD regressions. ✅ Achieved (soft gate in CI)
