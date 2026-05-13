import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LegiscanBulkClient } from '@/lib/scorecard/clients/legiscan-bulk';
import type { NormalizedBill } from '@/lib/scorecard/clients/types';

// Mirrors legiscan-client.test.ts but driven from on-disk JSON fixtures
// instead of stubbed fetch. Validates that the bulk adapter and the API
// client agree on the NormalizedBill shape they emit.

vi.mock('@/lib/prisma/prisma', () => ({
  default: {
    apiCallLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

let datasetDir: string;

beforeEach(async () => {
  datasetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legiscan-bulk-test-'));
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

describe('LegiscanBulkClient', () => {
  it('throws when LEGISCAN_DATASET_DIR is missing and no datasetDir is passed', () => {
    const original = process.env.LEGISCAN_DATASET_DIR;
    delete process.env.LEGISCAN_DATASET_DIR;
    expect(() => new LegiscanBulkClient()).toThrow(/LEGISCAN_DATASET_DIR/);
    if (original) process.env.LEGISCAN_DATASET_DIR = original;
  });

  it('normalizes sponsors with tier mapping (parity with API client)', async () => {
    await writeJson('CA/2023-2024/bill/12345.json', {
      bill: {
        bill_id: 12345,
        state: 'CA',
        session: { session_id: 1234, session_name: '2023-2024 Regular Session', year_start: 2023, year_end: 2024 },
        bill_number: 'AB-2200',
        bill_type: 'B',
        title: 'Guaranteed Health Care for All',
        description: 'CalCare',
        status: 1,
        state_link: 'https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=AB2200',
        sponsors: [
          { people_id: 100, party: 'D', name: 'Ash Kalra', sponsor_type_id: 1, sponsor_order: 1 },
          { people_id: 200, party: 'D', name: 'Bryan', sponsor_type_id: 3, sponsor_order: 2 },
          { people_id: 300, party: 'D', name: 'Friedman', sponsor_type_id: 2, sponsor_order: 5 },
        ],
        votes: [],
      },
    });

    const client = new LegiscanBulkClient({ datasetDir, silent: true });
    const bill = await client.getBillById('12345');
    expect(bill).not.toBeNull();
    const b = bill as NormalizedBill;
    expect(b.billNumber).toBe('AB-2200');
    expect(b.state).toBe('CA');
    expect(b.sponsors).toHaveLength(3);
    expect(b.sponsors.find((s) => s.name === 'Ash Kalra')?.tier).toBe('SPONSOR');
    expect(b.sponsors.find((s) => s.name === 'Bryan')?.tier).toBe('PRINCIPAL_COAUTHOR');
    expect(b.sponsors.find((s) => s.name === 'Friedman')?.tier).toBe('COSPONSOR');
  });

  it('normalizes roll-call votes with position mapping (parity with API client)', async () => {
    await writeJson('CA/2023-2024/bill/12345.json', {
      bill: {
        bill_id: 12345,
        state: 'CA',
        session: { session_id: 1234 },
        bill_number: 'AB-2200',
        bill_type: 'B',
        title: 'Test',
        status: 1,
        sponsors: [],
        votes: [
          {
            roll_call_id: 9001,
            date: '2024-04-23',
            desc: 'Assembly Health Committee',
            yea: 9,
            nay: 4,
            nv: 3,
            absent: 0,
            total: 16,
            passed: 1,
            chamber: 'A',
          },
        ],
      },
    });
    await writeJson('CA/2023-2024/vote/9001.json', {
      roll_call: {
        roll_call_id: 9001,
        date: '2024-04-23',
        desc: 'Assembly Health Committee',
        yea: 9,
        nay: 4,
        nv: 3,
        absent: 0,
        total: 16,
        passed: 1,
        chamber: 'A',
        state_link: 'https://leginfo.legislature.ca.gov/roll-call/9001',
        votes: [
          { people_id: 100, vote_id: 1, vote_text: 'Yea' },
          { people_id: 200, vote_id: 2, vote_text: 'Nay' },
          { people_id: 300, vote_id: 3, vote_text: 'NV' },
          { people_id: 400, vote_id: 4, vote_text: 'Absent' },
        ],
      },
    });

    const client = new LegiscanBulkClient({ datasetDir, silent: true });
    const bill = await client.getBillById('12345');
    const b = bill as NormalizedBill;
    expect(b.rollCalls).toHaveLength(1);
    const rc = b.rollCalls[0];
    expect(rc.passed).toBe(true);
    expect(rc.yes).toBe(9);
    expect(rc.no).toBe(4);
    expect(rc.notVoting).toBe(3);
    expect(rc.votes).toHaveLength(4);
    expect(rc.votes.find((v) => v.externalPersonId === '100')?.position).toBe('YES');
    expect(rc.votes.find((v) => v.externalPersonId === '200')?.position).toBe('NO');
    expect(rc.votes.find((v) => v.externalPersonId === '300')?.position).toBe('NOT_VOTING');
    expect(rc.votes.find((v) => v.externalPersonId === '400')?.position).toBe('ABSTAINED');
  });

  it('findBillByNumber resolves by jurisdiction + bill number, normalizing AB-2200 / AB2200', async () => {
    await writeJson('CA/2023-2024/bill/12345.json', {
      bill: {
        bill_id: 12345,
        state: 'CA',
        session: { session_id: 1234 },
        bill_number: 'AB2200', // intentionally without dash
        bill_type: 'B',
        title: 'CalCare',
        status: 1,
        sponsors: [],
        votes: [],
      },
    });

    const client = new LegiscanBulkClient({ datasetDir, silent: true });
    const bill = await client.findBillByNumber({ jurisdiction: 'CA', billNumber: 'AB-2200' });
    expect(bill?.externalBillId).toBe('12345');
  });

  it('findBillByNumber returns most recent session when multiple match', async () => {
    await writeJson('CA/2021-2022/bill/100.json', {
      bill: {
        bill_id: 100,
        state: 'CA',
        session: { session_id: 1100, year_start: 2021, year_end: 2022 },
        bill_number: 'AB-1',
        bill_type: 'B',
        title: 'Old',
        status: 1,
        sponsors: [],
        votes: [],
      },
    });
    await writeJson('CA/2025-2026/bill/200.json', {
      bill: {
        bill_id: 200,
        state: 'CA',
        session: { session_id: 1300, year_start: 2025, year_end: 2026 },
        bill_number: 'AB-1',
        bill_type: 'B',
        title: 'New',
        status: 1,
        sponsors: [],
        votes: [],
      },
    });

    const client = new LegiscanBulkClient({ datasetDir, silent: true });
    const bill = await client.findBillByNumber({ jurisdiction: 'CA', billNumber: 'AB-1' });
    expect(bill?.externalBillId).toBe('200');
  });

  it('returns null when bill is not in the dataset', async () => {
    const client = new LegiscanBulkClient({ datasetDir, silent: true });
    const bill = await client.getBillById('99999');
    expect(bill).toBeNull();
  });

  it('accepts bare (un-enveloped) bill JSON shape', async () => {
    // Some LegiScan dataset variants store bills bare without the
    // `{bill: {...}}` envelope. Make sure both shapes work.
    await writeJson('US/119/bill/55555.json', {
      bill_id: 55555,
      state: 'US',
      session: { session_id: 119, session_name: '119th Congress' },
      bill_number: 'HR-100',
      bill_type: 'B',
      title: 'Federal',
      status: 1,
      sponsors: [{ people_id: 1, party: 'R', name: 'Smith', sponsor_type_id: 1, sponsor_order: 1 }],
      votes: [],
    });

    const client = new LegiscanBulkClient({ datasetDir, silent: true });
    const bill = await client.findBillByNumber({ jurisdiction: 'FEDERAL', billNumber: 'HR-100' });
    expect(bill?.externalBillId).toBe('55555');
    expect(bill?.sponsors).toHaveLength(1);
  });

  it('caches normalized bills per process so repeat reads hit memory', async () => {
    await writeJson('CA/2023-2024/bill/77.json', {
      bill: {
        bill_id: 77,
        state: 'CA',
        session: { session_id: 1234 },
        bill_number: 'AB-77',
        bill_type: 'B',
        title: 'Cache test',
        status: 1,
        sponsors: [],
        votes: [],
      },
    });

    const client = new LegiscanBulkClient({ datasetDir, silent: true });
    const a = await client.getBillById('77');
    const readSpy = vi.spyOn(fs, 'readFile');
    const b = await client.getBillById('77');
    expect(a?.billNumber).toBe('AB-77');
    expect(b?.billNumber).toBe('AB-77');
    // After warmup, second call should not re-read the bill JSON.
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('skips unparseable JSON files in the dataset directory', async () => {
    await fs.mkdir(path.join(datasetDir, 'CA/2023-2024/bill'), { recursive: true });
    await fs.writeFile(path.join(datasetDir, 'CA/2023-2024/bill/garbage.json'), '{not json', 'utf-8');
    await writeJson('CA/2023-2024/bill/55.json', {
      bill: {
        bill_id: 55,
        state: 'CA',
        session: { session_id: 1234 },
        bill_number: 'AB-55',
        bill_type: 'B',
        title: 'Survives garbage',
        status: 1,
        sponsors: [],
        votes: [],
      },
    });

    const client = new LegiscanBulkClient({ datasetDir, silent: true });
    const bill = await client.findBillByNumber({ jurisdiction: 'CA', billNumber: 'AB-55' });
    expect(bill?.externalBillId).toBe('55');
  });
});
