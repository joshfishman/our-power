# Phase 6 — Admin Verification UI: Design Spec

**Status:** Draft (2026-05-30)
**Branch:** `feat/phase-6-admin-verification-plan`
**Methodology dependency:** every published `RepresentativeScore` row currently rests on auto-flipped `MarkerAchievement.verifiedAt` values. This spec retires that stand-in.

---

## 1. Problem statement

The Common Ground methodology, `docs/scorecard-methodology.md`, commits to a hard rule:

> Every score must trace to a public source via `MarkerAchievement.evidenceSourceUrl`. **Human verification required before publication.**

Today, `scripts/compute-scores.ts --auto-verify` bulk-flips every row in `MarkerAchievement` with `verifiedAt = NOW()` and `verifiedBy = 'auto-verify-temp'`. The PAC ingest path additionally writes `verifiedBy = 'pac-engine-v1.4'` at upsert time. Both are flagged in code comments as "TEMPORARY STAND-IN for Phase 6 admin verification UI."

The result is a public scorecard whose trust floor is "we wrote a script and it ran." For the methodology promise to hold — and for partner conversations with anchor organizations (RepresentUs, Issue One, Braver Angels, AFL-CIO political dept) to survive due diligence — every published achievement needs a named human reviewer who looked at the source URL and signed off.

This spec describes the admin verification UI that delivers that promise.

---

## 2. Audit target — what currently exists in `verifiedBy`

The four distinct `verifiedBy` values written into the database today:

| `verifiedBy` value     | Source                                                                | Trust tier in new model | Action under this spec                                |
| ---------------------- | --------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------- |
| `'auto-verify-temp'`   | `scripts/compute-scores.ts --auto-verify` bulk update                 | **YELLOW** (provisional) | Drains over time as admins promote to GREEN.          |
| `'pac-engine-v1.4'`    | `computePacAchievements()` inside `scripts/compute-scores.ts`         | **YELLOW** (provisional) | Drains over time; same flow.                          |
| `'manual'` / human id  | Reserved value, not yet written by any path                           | **GREEN** (verified)    | Becomes the live target verifiedBy after this ships.  |
| `null`                 | Brand-new achievement not yet touched by any verifier                 | **RED** (unverified)    | Highest-priority queue position.                      |

**Acceptance criterion before merging to `main`:** a one-shot read-only audit script (`scripts/audit-verification-state.ts`) lands first that prints, per legislator, the count of achievements in each of the four buckets above. This becomes the success metric for Phase 6 rollout — RED → 0, YELLOW → drains over time, GREEN grows.

Approximate current scale (per recent `compute-scores` runs): roughly 25,149 achievements live in the YELLOW bucket across both jurisdictions; RED is small and continuously refilled by ingest scripts; GREEN is effectively zero. The audit script gives a precise number on the day the work starts.

---

## 3. UX flow

Three primary admin surfaces, all under `/admin/verify`. Visual register matches the rest of `/scorecard*` — civic, parchment/wheat on navy, brick-red accents.

### 3.1 Queue view — `/admin/verify`

Default landing. Two-column layout.

```
+---------------------------------------------------------------+
| Verification queue                          [v]erifier: you   |
+----------------------+----------------------------------------+
| FILTERS              | LEGISLATOR GROUPS                      |
| [x] Unverified (RED) | > Sen. Smith (CA)    12 RED · 31 YEL   |
| [x] Auto-verified    | > Rep. Jones (FED)    3 RED · 18 YEL   |
| [ ] Verified (GREEN) | > Sen. Garcia (CA)    0 RED · 47 YEL   |
|                      | > Rep. Lee (FED)      9 RED ·  0 YEL   |
| Plank                | ...                                    |
| [x] 1  [x] 2  [x] 3  | (sorted: RED desc, then YEL desc)      |
| [x] 4  [x] 5         |                                        |
|                      |                                        |
| Jurisdiction         |                                        |
| [x] FEDERAL  [x] CA  |                                        |
|                      |                                        |
| Evidence type        |                                        |
| [x] VOTE             |                                        |
| [x] COSPONSOR        |                                        |
| [x] FEC_FILING       |                                        |
| [x] CAL_ACCESS_...   |                                        |
| [x] PUBLIC_STATEMENT |                                        |
+----------------------+----------------------------------------+
```

Clicking a legislator group expands to a per-marker checklist (one row per `MarkerAchievement`) with the current trust tier dot, the evidence type, and a short evidence snippet. Each row links to the single-item view.

### 3.2 Single-item view — `/admin/verify/[achievementId]`

```
+---------------------------------------------------------------+
| Sen. Smith (CA) — Plank 3, Marker: $15 minimum wage (PRIMARY) |
| Status: YELLOW (auto-verified 2026-04-12 by 'auto-verify-temp')|
+---------------------------------------------------------------+
|                                                               |
| EVIDENCE (auto-loaded)                                        |
|   Evidence type: VOTE                                         |
|   Action taken:  ACTED_FOR                                    |
|   Source URL:    https://legiscan.com/CA/rollcall/AB-1234/... |
|   Notes:         "Yes vote on third reading, 2024-08-22"      |
|                                                               |
|   [ Open source in new tab ]    [ Open bill page ]            |
|                                                               |
| VERIFIER ACTION                                               |
|   Paste citation URL you actually opened:                     |
|   [_______________________________________________________]   |
|                                                               |
|   [ Approve (GREEN) ]   [ Reject ]   [ Flag follow-up ]       |
|                                                               |
|   Rejection / follow-up note (required if reject or flag):    |
|   [_______________________________________________________]   |
|                                                               |
+---------------------------------------------------------------+
| RECENT VERIFICATIONS BY YOU                                   |
|   2026-05-30 09:14  Sen. Smith / wage-floor    APPROVED       |
|   2026-05-30 09:11  Sen. Smith / paid-leave    APPROVED       |
|   2026-05-30 09:07  Sen. Smith / care-pricing  FLAGGED        |
+---------------------------------------------------------------+
```

Behaviour rules:

- **Approve** requires the verifier to paste a citation URL (separate from `evidenceSourceUrl`, which is what the ingest script auto-wrote). The pasted URL is stored as `verifiedFromUrl`. Pasting the same URL the ingest script wrote is allowed — it's evidence the human opened it.
- **Reject** sets `actionTaken` back to the verifier's best-evidence value (or `NO_RECORD`), records `rejectionReason`, and pushes the achievement *out* of `verifiedAt` (back to RED). Score recompute is automatic on next `compute-scores` run.
- **Flag follow-up** keeps the current `actionTaken` but sets `escalatedAt`. A weekly digest emails the lead admin with all escalations open >7 days.
- Keyboard shortcuts: `J/K` next/prev row, `A` approve, `R` reject, `F` flag, `O` open source.

### 3.3 Audit log — `/admin/verify/audit`

```
+---------------------------------------------------------------+
| Verification audit log                                        |
| Filter: verifier [____v____]  action [all v]  range [_______] |
+---------------------------------------------------------------+
| 2026-05-30 09:14  J. Fishman   APPROVED  Smith / wage-floor   |
| 2026-05-30 09:11  J. Fishman   APPROVED  Smith / paid-leave   |
| 2026-05-30 09:07  J. Fishman   FLAGGED   Smith / care-pricing |
| 2026-05-29 16:33  A. Reviewer  REJECTED  Jones / care-pricing |
|   reason: "vote was actually on motion to recommit, not the   |
|    underlying bill — does not satisfy the marker"             |
| ...                                                           |
+---------------------------------------------------------------+
```

Per-verifier and per-action totals are tallied in the header. This page is **admin-restricted** (not public) for v1 — see §9 "Out of scope."

---

## 4. Schema changes

All additions on `MarkerAchievement`. No model is renamed; no field is removed.

```prisma
model MarkerAchievement {
  // ... existing fields ...

  verifiedAt        DateTime?
  verifiedBy        String?    // unchanged — keep for back-compat & non-user verifiers (ingest engines)

  // NEW
  verifierUserId    String?    // FK to User.id when verified by a human
  verifier          User?      @relation("AchievementVerifier", fields: [verifierUserId], references: [id])
  verifiedFromUrl   String?    // citation URL the admin actually opened (distinct from evidenceSourceUrl)
  rejectionReason   String?    @db.Text
  escalatedAt       DateTime?

  @@index([verifierUserId])
  @@index([escalatedAt])
}
```

And on `User`:

```prisma
model User {
  // ... existing ...
  verifiedAchievements MarkerAchievement[] @relation("AchievementVerifier")
}
```

**Trust-tier derivation is computed, not stored.** The view layer derives the tier from existing fields:

| Tier   | Condition                                                                   |
| ------ | --------------------------------------------------------------------------- |
| GREEN  | `verifiedAt IS NOT NULL AND verifierUserId IS NOT NULL`                     |
| YELLOW | `verifiedAt IS NOT NULL AND verifierUserId IS NULL` (auto / pac-engine)     |
| RED    | `verifiedAt IS NULL`                                                        |

A small helper in `src/lib/scorecard/verification.ts` exports `trustTierFor(achievement)` so the queue, single-item view, audit log, and any future public surface all agree.

---

## 5. Route structure

| Route                                  | Purpose                                                    | Auth          |
| -------------------------------------- | ---------------------------------------------------------- | ------------- |
| `/admin/verify`                        | Queue, grouped by legislator                               | Admin only    |
| `/admin/verify/[achievementId]`        | Single-item review                                         | Admin only    |
| `/admin/verify/audit`                  | Verification log, filter by verifier / action / date range | Admin only    |
| `POST /api/admin/verify/[id]/approve`  | `{ verifiedFromUrl }` → sets GREEN tier                    | Admin only    |
| `POST /api/admin/verify/[id]/reject`   | `{ rejectionReason, newActionTaken? }` → back to RED       | Admin only    |
| `POST /api/admin/verify/[id]/escalate` | `{ note }` → sets `escalatedAt`                            | Admin only    |
| `GET /api/admin/verify/queue`          | Cursor-paginated queue, JSON, for the React Query client   | Admin only    |
| `GET /api/admin/verify/audit`          | Audit log JSON                                             | Admin only    |

All admin routes live under the existing App Router but are scoped via middleware (see §6). The `(protected)/` route group does not give us admin-only; we add a thin `(admin)/` route group with its own `layout.tsx` that asserts admin role server-side.

---

## 6. Permission model

The existing `MemberRole` enum (`MEMBER | ORGANIZER | ADMIN`) is **campaign-scoped** — it lives on `CampaignMember` and means "admin of this campaign," not "admin of the platform." It is unsuitable for scorecard verification.

Two additions:

1. **New `User.platformRole` field** (enum `PlatformRole { MEMBER | SCORECARD_VERIFIER | SCORECARD_ADMIN }`, default `MEMBER`). `SCORECARD_VERIFIER` can approve / reject / flag. `SCORECARD_ADMIN` additionally sees the audit log and can revoke another verifier's approval (which sends an achievement back to RED for re-review).
2. **`requireScorecardRole(role)` server helper** in `src/lib/auth/scorecard-roles.ts`, used by all admin routes and API handlers.

Middleware (`src/middleware.ts`) already gates the protected route group. We extend it to additionally redirect non-`SCORECARD_VERIFIER` users away from `/admin/verify*` to `/scorecard`. The matcher exclusion list does not need to change.

Seeding: a one-time script `scripts/grant-scorecard-role.ts --email=… --role=SCORECARD_ADMIN` grants the role. The first run grants it to the project lead; subsequent verifier additions happen through that same CLI until a self-service admin UI is built (out of scope).

---

## 7. Public surface impact

For the launch of Phase 6, **the public `/scorecard/[id]` page does not visibly change.** A YELLOW achievement and a GREEN achievement render identically. This is deliberate — we do not want to publicly signal "this part of the score isn't fully verified yet" while the queue drains, because that creates a perverse incentive for partisans to discount unfavorable scores as "auto-only."

What does change publicly:

- **Methodology page** (`/scorecard/methodology`) gets a new section, "Human verification," that describes the GREEN / YELLOW / RED tiers, who the verifiers are (anonymous count: "37 achievements verified by 4 reviewers this week"), and the commitment to drain YELLOW to zero before any methodology version bump that affects scoring.
- **Per-legislator pages** get a small footer line: "Methodology v1.x · Score last computed YYYY-MM-DD · Verification status: N/M achievements human-verified." Informational, not alarming.

When YELLOW drains to <1% of all achievements (target: end of Q3 2026), we revisit and surface the tier on individual achievements with a small badge.

---

## 8. Migration strategy — what to do with the existing ~25k auto-verified rows

**Two options considered:**

### Option A — wipe and rebuild

Set `verifiedAt = NULL` on every row whose `verifiedBy IN ('auto-verify-temp', 'pac-engine-v1.4')`. The next `compute-scores` run would then produce empty `RepresentativeScore` rows for the affected legislators because the scorer only counts achievements where `verifiedAt IS NOT NULL`. Every legislator's score effectively goes to zero until verifiers catch up.

- **Pro:** clean methodology compliance from day one.
- **Con:** the public scorecard goes blank for weeks or months. We lose the public artifact while we still need it for partner conversations. Reverses the partner-pitch slide-08 story.

### Option B — recommended: treat auto-verified as a YELLOW tier, drain over time

Leave existing `verifiedAt` values as-is. The tier derivation (§4) classifies them YELLOW. The methodology doc is updated in the same PR to acknowledge the two-tier reality: scores are published from GREEN + YELLOW achievements during the drain window, and the public methodology page commits to a published target date by which YELLOW = 0.

- **Pro:** no public outage. Scoring continues. Verifiers can prioritize the highest-leverage achievements (PRIMARY markers on high-profile legislators) first.
- **Con:** methodology compliance is technically "in progress" during the drain. We mitigate by being explicit about it publicly and by tying the YELLOW drain to a hard date.

**Recommendation: Option B.** Sub-PR 4 (see §11) updates `docs/scorecard-methodology.md` with a v1.x → v2.0 transition note: "v2.0 ships when YELLOW = 0 platform-wide for federal legislators; CA follows by Q4 2026."

A useful side effect of Option B: the `compute-scores --auto-verify` flag stays in the codebase but becomes a **disaster-recovery tool only**, with its log message updated to "use only when seeding a fresh database; production verification is now Phase 6 UI."

---

## 9. Out of scope (explicit non-goals)

The following are deferred to later phases and **must not** be built as part of this work:

- **Verification chains** — letting one verifier approve another verifier's work. v1 trusts every `SCORECARD_VERIFIER` equally; revocations come from `SCORECARD_ADMIN` only.
- **Public verifier identity** — neither the queue page, the audit log, nor the public scorecard shows which named human verified what. v1 publishes aggregate counts only ("verified by 4 reviewers"). Personal accountability lives only inside the admin UI.
- **ML-assisted verification** — no automated suggestion of approve / reject based on past patterns. The verifier opens the source URL and reads it. Period.
- **Automated source scraping** — no headless-browser fetch of the LegiScan / FEC URL to "pre-validate" the citation. The point of human verification is that a human opens the link.
- **Mobile UX** — verification is a desktop workflow. Mobile gets a "view-only" rendering of the queue page; no approve/reject buttons.
- **Webhook on verification** — no real-time recompute. Scoring is still batch-driven via `scripts/compute-scores.ts`.
- **Partner self-serve verification** — affiliate / anchor partners (slide 08 of the partner-pitch brief) do not get verifier accounts in v1. That is a separate trust-and-governance conversation.

---

## 10. Risks

| Risk                                                                                          | Severity | Mitigation                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Throughput.** ~25,149 YELLOW rows · 1 admin · 10 rows/day = 7 years. Drain never completes. | High     | Recruit 5–10 verifiers from anchor partners; instrument per-verifier daily throughput in the audit log. Set a public drain target and report on it. |
| **Methodology version bump mid-drain.** A v1.x → v1.y bump recomputes scores and resurrects YELLOW that was on its way to GREEN. | Medium   | `RepresentativeScore.methodologyVersion` already exists. Verification approvals are attached to the achievement (not the score), so they survive recomputes. Document this in `scoring.ts`. |
| **Reviewer bias.** A partisan verifier rubber-stamps friendly legislators and over-scrutinizes unfriendly ones. | High     | Audit log shows per-verifier approval rate. `SCORECARD_ADMIN` can revoke. Mid-term, build verifier-pair-disagreement metrics (out of scope here, but the data shape supports it). |
| **Public perception of YELLOW.** Critics seize on "auto-verified" tier as evidence the scorecard is unreliable. | Medium   | Pre-empt with the methodology page section in §7. Be the first to surface it. Frame as "Phase 6, on track to drain by Q3."                       |
| **Verifier burnout / pipeline silting up.** Achievements pile in faster than verifiers approve. | Medium   | Per-week ingest delta metric on the audit page. If RED grows for 3 weeks in a row, pause new ingest scripts until verifiers catch up.            |
| **Citation-URL paste forgery.** A verifier pastes the same URL the ingest script wrote without opening it. | Low      | Out of scope to fully prevent; trust model relies on named, accountable verifiers. Disagreement-rate metrics (future phase) catch sloppy reviewers. |

---

## 11. Implementation breakdown (3–5 sub-PRs)

A fresh engineer should be able to land this in the following sequence without further design questions:

### Sub-PR 1 — Audit script + schema migration (read-only baseline)

- Add `scripts/audit-verification-state.ts` (read-only; prints RED / YELLOW / GREEN counts per legislator and jurisdiction; safe to run on prod).
- Run it; capture the baseline numbers; paste them into the PR description.
- Schema migration: add `verifierUserId`, `verifiedFromUrl`, `rejectionReason`, `escalatedAt` to `MarkerAchievement`; add inverse relation on `User`; add `User.platformRole` enum + field.
- No UI yet; no behaviour change.

### Sub-PR 2 — Admin auth scaffolding + middleware

- Add `PlatformRole` enum, `scripts/grant-scorecard-role.ts`, `src/lib/auth/scorecard-roles.ts`.
- Extend `src/middleware.ts` to redirect non-verifiers away from `/admin/verify*`.
- Add `src/app/(admin)/layout.tsx` with server-side role assertion.
- Empty `/admin/verify/page.tsx` that says "queue coming soon" — proves the auth gate.

### Sub-PR 3 — Queue view + single-item view + approve / reject / escalate API

- All three admin pages with full functionality.
- React Query hooks + mutations under `src/hooks/queries/scorecard-admin/` and `src/hooks/mutations/scorecard-admin/`.
- Zod validation on every POST handler.
- Trust-tier helper `src/lib/scorecard/verification.ts`.
- Keyboard shortcuts on single-item view.
- Vitest unit tests for the trust-tier helper and the API handlers; Playwright smoke test for the approve flow.

### Sub-PR 4 — Methodology doc update + public-page footer

- Update `docs/scorecard-methodology.md`: new "Human verification" section, version-table row, drain commitment.
- Update `/scorecard/methodology` page with the same content (parchment-on-navy styling).
- Add the footer line to `/scorecard/[id]` showing N / M verification ratio (computed server-side from the existing query, no new fetch).
- Update `scripts/compute-scores.ts` to soften the `--auto-verify` warning into a hard disaster-recovery-only message; do not remove the flag.

### Sub-PR 5 — Audit log page + verifier-throughput metrics

- `/admin/verify/audit` page with filters (verifier, action, date range).
- Per-verifier daily throughput summary at the top of the audit page (count by action; approval rate; oldest open escalation).
- Email digest job (`scripts/digest-open-escalations.ts`, run weekly via existing manual pattern — no cron in this repo per Phase 7 deferral) that emails `SCORECARD_ADMIN`s with all `escalatedAt < NOW() - 7d`.

Each sub-PR ships behind a Vercel preview review per the project workflow rule. Sub-PR 1 lands first because the audit numbers it produces inform priorities for sub-PRs 3 and 5.

---

## 12. Definition of done

- All four `verifiedBy` audit buckets in §2 are visible and counted on `/admin/verify/audit`.
- A new achievement entering the database can be moved from RED → GREEN by a `SCORECARD_VERIFIER` in under 60 seconds using the single-item UI.
- `docs/scorecard-methodology.md` describes the GREEN / YELLOW / RED tiers and names a drain target date.
- The `--auto-verify` flag on `scripts/compute-scores.ts` is downgraded in log copy from "TEMPORARY STAND-IN" to "disaster recovery only — production verification is the Phase 6 UI."
- At least one non-author verifier has been granted `SCORECARD_VERIFIER` and successfully approved 10 achievements end-to-end, in production, before this is called shipped.

---

*Spec author: Phase 6 planning pass, 2026-05-30. Implementation is explicitly out of scope for this PR — only this document and the branch land.*
