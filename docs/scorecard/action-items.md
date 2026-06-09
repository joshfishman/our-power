# Scorecard / repo action items — snapshot 2026-06-09

Point-in-time working list following the v0.9 methodology overhaul (ratio voting
engine, full MONEY-bucket PAC, public-support gate, Senate expansion 11→74
bills). Branch: `scorecard/voting` (worktree at `~/dev/op-voting`). Items are
grouped: **A** = ship the v0.9 branch, **B** = open methodology decisions,
**C** = repo hygiene.

## A — Ship the v0.9 branch

1. **Fix the "PAC-only overall" defect.** `computeTwoScoreAverage` returns the
   PAC score alone when voting is null, so Resident Commissioner Hernández (PR,
   0 scoreable bills) ranks #6 overall on PAC=91% with no voting record.
   Decide: insufficient-data badge / exclude from rankings / require both
   scores. (Surfaced by the delegate fix.)
2. **Commit the uncommitted worktree changes** — CA-gate fix in
   voting-alignment.ts, State-Dept marker drop + $15 reconcile in
   federal-planks.ts, public-support.ts cleanup, apply-senate-expansion.ts,
   methodology doc, marker-public-support.md, senate-vote-expansion.md.
3. **Fix + rerun `scripts/diag-party.ts`** (exits 1 after the marquee section;
   the post-recompute D/R party averages never printed). We still need the
   party-distribution read on the new numbers.
4. **Sync stale methodology-doc claims**: "27 of 28 pass / 1 fails" → 27
   markers, all pass (State-Dept dropped); add SJRES 103 exclusion rationale +
   Senate expansion (74 bills) to the v0.9 version row.
5. **Verify bill-breakdown parity with the scorer** — the scorer now has the
   delegate rule + gate + Senate votes; `getLegislatorBillBreakdown` shares
   predicates but its "X aligned of Y" counts should be asserted equal to the
   scorer's (esp. for delegates).
6. **Tests**: confirm the ratio-model tests survived the stash churn on this
   branch; add tests for the public-support gate, the delegate rule, and the
   cosponsor-only-helps rule. Full `test:run` + lint + typecheck + build.
7. **DW-NOMINATE re-calibration** (`scripts/calibrate-vs-dw-nominate.ts`) —
   required by CLAUDE.md for any methodology change; confirm r is still in a
   defensible band under v0.9.
8. **Retire stale published score versions.** ~10 old methodology versions are
   still `published` per legislator. Unpublish all except `v1.9.1` (what
   production code reads today — do NOT unpublish until merge) and `v0.9`.
9. **Senate LOW-confidence remainder** (~30 bills: appropriations/CR cloture
   series, double-negative CRAs etc. in senate-vote-expansion.md) — review and
   apply or explicitly drop.
10. **CA parity follow-ups**: CA PAC ratios are pre-baked at ingest with the
    old narrow corporate definition (the MONEY-bucket fix is federal-only);
    re-run CA classification/ingest to match. CA markers currently bypass the
    public-support gate (no CA polling) — needs a CA polling pass eventually.
11. **Temp-script cleanup**: explore-bernie.ts, spotcheck-v09.ts,
    diag-party.ts, audit-markers.ts here; stray explore-noshows.ts on the main
    checkout.
12. **Push branch → PR → Vercel preview verification → merge on command.**
    v0.9 rows are already in the shared DB but invisible to production (prod
    code filters on v1.9.1), so merge timing is the go-live switch.

## B — Open methodology decisions (owner calls, not bugs)

13. **Leadership-distributor blind spot**: Pelosi (PAC 95%) and McConnell raise
    corporate money into party/leadership vehicles that flow to *other*
    members; the score only measures money *received*. Needs an outflow-side
    metric or explicit transparency disclosure.
14. **Receipts dilution**: Graham's $112M 2020 small-dollar haul makes his
    corporate share read tiny; consider cycle-weighting or latest-cycle PAC
    ratios.
15. **Option-C expansion**: only 2 of 27 markers are GOP-authored alternatives;
    expand if Republican-earnable paths matter (post-gate, the R voting ceiling
    is still structurally lower).
16. **House vote expansion**: House scores 144 of 340 voted bills; a House pass
    like the Senate one is available if more coverage is wanted.
17. **v1.0 criteria**: define what graduates v0.9 → v1.0 (Phase 6 human
    verification UI? DW calibration? CA parity? polling for the two proxy-pass
    markers?).
18. **Phase 6 admin verification UI** remains unbuilt; `--auto-verify` /
    pac-engine stand-ins still in use. Required before a real public launch
    (methodology promises human-verified evidence).

## C — Repo hygiene

19. **Stash cleanup** in the main repo (4 stashes, all believed superseded by
    commits on `scorecard/voting` and the color branch — verify, then drop).
20. **Delete dead branch** `scorecard/voting-v2` (no commits beyond main).
21. **`/styleguide` public-allowlist decision** on the color branch (currently
    public in auth.config.ts; keep public or re-gate).
22. **Old compute scripts / package.json**: confirm `compute-v16`/`compute-v17`
    npm entries are gone on this branch and the deleted scripts stay deleted at
    merge time.
