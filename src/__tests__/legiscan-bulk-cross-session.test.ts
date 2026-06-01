import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LegiscanBulkClient } from '@/lib/scorecard/clients/legiscan-bulk';

// Tests the cross-session bridge: LegiScan assigns DIFFERENT people_id
// values per session, but each people/PERSON-{id}.json file carries
// bioguide_id which is stable across sessions. The bulk client indexes
// these so the marker-bill sync can fall back to bioguideId when the
// direct legiscanPeopleId lookup misses across Congresses.

vi.mock('@/lib/prisma/prisma', () => ({
  default: {
    apiCallLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

let datasetDir: string;

beforeEach(async () => {
  datasetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legiscan-bulk-cs-test-'));
});

afterEach(async () => {
  await fs.rm(datasetDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function writeJson(relPath: string, body: unknown): Promise<void> {
  const full = path.join(datasetDir, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, JSON.stringify(body), 'utf-8');
}

describe('LegiscanBulkClient cross-session bioguide bridge', () => {
  it('indexes federal people/*.json files and maps people_id → bioguide_id', async () => {
    // 117th Congress people entry for Mo Brooks.
    await writeJson('US/117/people/PERSON-11041.json', {
      person: {
        people_id: 11041,
        bioguide_id: 'B001274',
        name: 'Mo Brooks',
        party_id: 2,
        party: 'R',
      },
    });
    // 119th Congress people entry for a different legislator,
    // hypothetically reusing nearby people_ids. Confirms multiple
    // entries from different session subtrees are both indexed.
    await writeJson('US/119/people/PERSON-22222.json', {
      person: {
        people_id: 22222,
        bioguide_id: 'P000197',
        name: 'Nancy Pelosi',
        party_id: 1,
        party: 'D',
      },
    });

    const client = new LegiscanBulkClient({ datasetDir, silent: true });
    expect(await client.getBioguideByPeopleId(11041)).toBe('B001274');
    expect(await client.getBioguideByPeopleId(22222)).toBe('P000197');
  });

  it('accepts bare (un-enveloped) person JSON shape', async () => {
    await writeJson('US/117/people/PERSON-99999.json', {
      people_id: 99999,
      bioguide_id: 'X000001',
      name: 'Bare Shape Senator',
    });

    const client = new LegiscanBulkClient({ datasetDir, silent: true });
    expect(await client.getBioguideByPeopleId(99999)).toBe('X000001');
  });

  it('returns undefined for unknown people_ids', async () => {
    const client = new LegiscanBulkClient({ datasetDir, silent: true });
    expect(await client.getBioguideByPeopleId(404)).toBeUndefined();
  });

  it('skips CA people files cleanly (no bioguide_id field)', async () => {
    // CA people files don't carry bioguide_id — make sure the indexer
    // doesn't blow up and just skips the entry without crashing.
    await writeJson('CA/2023-2024/people/PERSON-7777.json', {
      person: {
        people_id: 7777,
        // no bioguide_id
        name: 'Ash Kalra',
        party_id: 1,
        party: 'D',
      },
    });

    const client = new LegiscanBulkClient({ datasetDir, silent: true });
    expect(await client.getBioguideByPeopleId(7777)).toBeUndefined();
  });
});
