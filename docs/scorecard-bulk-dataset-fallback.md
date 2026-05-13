# Scorecard sync — bulk dataset fallback

**The primary path is the live LegiScan API.** Approved API keys are now in `.env.local`,
and `LEGISCAN_SOURCE=api` is the default — `npm run scorecard:sync` will hit the live API
unless you explicitly opt into bulk mode. This document covers the bulk-mode fallback,
which exists for three scenarios:

1. **Offline work / travel** — bulk archives are local, no network needed.
2. **Validation / regression** — pinning to a known-good snapshot.
3. **API outage or revocation** — same data, no live dependency.

The same data is available as free, login-only weekly bulk archives at
<https://legiscan.com/datasets>. The archive JSON is byte-for-byte the
same shape as the live API responses, per the LegiScan API user manual,
so we share the normalizer and only swap the fetch layer.

The bulk-mode adapter lives at
`src/lib/scorecard/clients/legiscan-bulk.ts` and implements the same
`LegislativeDataSource` interface as the live client.

## Operator workflow

1. **Register a free myLegiScan account** at
   <https://legiscan.com/legiscan> and log in. No application form,
   no waiting period.

2. **Download the relevant session ZIPs** from
   <https://legiscan.com/datasets>. For The Common Ground today that
   means California (current session) and US Congress (current
   session). Pick JSON format. Each ZIP is a few MB.

3. **Unpack to a stable directory** anywhere on your machine. The
   adapter walks the directory recursively and indexes by JSON
   contents, not filename, so the internal layout of the ZIP does not
   matter. Suggested location:

   ```
   ~/legiscan-data/
     ca-2025-2026/...     (unzipped contents of the CA session ZIP)
     us-119/...           (unzipped contents of the US Congress ZIP)
   ```

4. **Set environment variables in `.env.local`:**

   ```bash
   LEGISCAN_DATASET_DIR=/Users/<you>/legiscan-data
   LEGISCAN_SOURCE=bulk
   ```

   (`LEGISCAN_API_KEY` can stay blank or unset in bulk mode.)

5. **Run the sync.** Source mode can also be set per-invocation with
   the `--source` flag, which beats the env var:

   ```bash
   npm run scorecard:sync -- --source=bulk --bill=AB-2200
   npm run scorecard:sync -- --source=bulk --jurisdiction=CA --dry-run
   ```

   The first call rebuilds the index (a few seconds for two sessions);
   subsequent calls in the same process reuse it.

## Smoke test

Confirms the adapter is wired up correctly and produces the same
`NormalizedBill` shape as the API client.

1. Download and unpack the current CA session dataset (per steps 2–3
   above). Set `LEGISCAN_DATASET_DIR` to the unpack root.

2. Run a dry-run sync against CalCare AB-2200 — the bill we already
   seeded as the reference example:

   ```bash
   npm run scorecard:sync -- --source=bulk --bill=AB-2200 --dry-run
   ```

3. Expected output, line by line:

   - `[sync-marker-bills] using source: LegiScanBulk`
   - `[bill] CA AB-2200 — ...`
   - A summary block where `billsProcessed=1`, `billsNotFound=0`, and
     `rollCallsWritten` is greater than zero (the Assembly Health
     Committee 9-4-3 vote on April 23, 2024 should be present in the
     dataset).
   - `DRY RUN — no DB writes performed.`

4. Drop `--dry-run` to actually populate `BillVote` and
   `MarkerAchievement` rows. Verify with:

   ```bash
   npm run prisma:studio
   ```

   and inspect `BillVote` for the AB-2200 row. The committee vote
   description should match what the live API would have returned.

## Tradeoffs

- **Refresh cadence**: bulk archives update Sunday mornings. For our
  curated marker-bill workload that re-runs at most weekly anyway,
  that is fine. Don't expect mid-week vote changes to be reflected
  until the next archive drop.
- **No per-bill 404 fallback**: if a bill is missing from the
  dataset (newly introduced, not yet swept into a snapshot), the
  adapter returns `null` and the sync logs a `bill not found` skip.
  Re-run after the next Sunday archive.
- **No live status**: any field that LegiScan computes on the fly
  (e.g. `change_hash` deltas) is absent. The bulk archive is a
  point-in-time snapshot.

## API call ledger

Bulk reads still write `ApiCallLog` rows so the operator can audit
every call. The `source` is `LEGISCAN` (it is LegiScan data either
way), and `endpoint` is prefixed `bulk:` (e.g. `bulk:getBill`,
`bulk:findBillByNumber`) to distinguish from live API calls. Filter
the table by `endpoint LIKE 'bulk:%'` to see only on-disk reads.
