import { afterEach, describe, expect, it, vi } from 'vitest';
import { LegiscanClient } from '@/lib/scorecard/clients/legiscan';
import type { NormalizedBill } from '@/lib/scorecard/clients/types';

// These tests exercise the pure normalization path: LegiScan raw envelope ->
// our NormalizedBill shape. They don't hit the live LegiScan API or the
// database — fetch is stubbed and ApiCallLog writes are mocked out.

vi.mock('@/lib/prisma/prisma', () => ({
  default: {
    apiCallLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

interface FetchStub {
  responses: unknown[];
  index: number;
}

function stubFetch(responses: unknown[]): FetchStub {
  const stub: FetchStub = { responses, index: 0 };
  global.fetch = vi.fn(async () => {
    const body = stub.responses[stub.index] ?? { status: 'ERROR', alert: { message: 'no more stubs' } };
    stub.index += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return stub;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LegiscanClient', () => {
  it('throws when LEGISCAN_API_KEY is missing', () => {
    const original = process.env.LEGISCAN_API_KEY;
    delete process.env.LEGISCAN_API_KEY;
    expect(() => new LegiscanClient()).toThrow(/LEGISCAN_API_KEY/);
    if (original) process.env.LEGISCAN_API_KEY = original;
  });

  it('normalizes sponsors with tier mapping', async () => {
    process.env.LEGISCAN_API_KEY = 'test-key';
    const client = new LegiscanClient();

    stubFetch([
      // First call: getBill — full bill envelope
      {
        status: 'OK',
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
          votes: [], // No roll calls in this test
        },
      },
    ]);

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

  it('normalizes roll-call votes with position mapping', async () => {
    process.env.LEGISCAN_API_KEY = 'test-key';
    const client = new LegiscanClient();

    stubFetch([
      // getBill
      {
        status: 'OK',
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
      },
      // getRollCall (called for the single roll call above)
      {
        status: 'OK',
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
      },
    ]);

    const bill = await client.getBillById('12345');
    const b = bill as NormalizedBill;
    expect(b.rollCalls).toHaveLength(1);
    const rc = b.rollCalls[0];
    expect(rc.passed).toBe(true);
    expect(rc.votes).toHaveLength(4);
    expect(rc.votes.find((v) => v.externalPersonId === '100')?.position).toBe('YES');
    expect(rc.votes.find((v) => v.externalPersonId === '200')?.position).toBe('NO');
    expect(rc.votes.find((v) => v.externalPersonId === '300')?.position).toBe('NOT_VOTING');
    expect(rc.votes.find((v) => v.externalPersonId === '400')?.position).toBe('ABSTAINED');
  });

  it('returns null when LegiScan returns ERROR status', async () => {
    process.env.LEGISCAN_API_KEY = 'test-key';
    const client = new LegiscanClient();
    stubFetch([{ status: 'ERROR', alert: { message: 'Bill not found' } }]);
    const bill = await client.getBillById('99999');
    expect(bill).toBeNull();
  });

  it('caches per-process so the same call does not re-fetch', async () => {
    process.env.LEGISCAN_API_KEY = 'test-key';
    const client = new LegiscanClient();
    const stub = stubFetch([
      {
        status: 'OK',
        bill: {
          bill_id: 1,
          state: 'CA',
          session: { session_id: 1 },
          bill_number: 'AB-1',
          bill_type: 'B',
          title: 'T',
          status: 1,
          sponsors: [],
          votes: [],
        },
      },
    ]);
    const a = await client.getBillById('1');
    const b = await client.getBillById('1');
    expect(a?.billNumber).toBe('AB-1');
    expect(b?.billNumber).toBe('AB-1');
    expect(stub.index).toBe(1); // Second call should be a cache hit
  });
});
