/**
 * Ecanvasser API Integration
 *
 * Ecanvasser provides a REST API for canvassing operations.
 * API Documentation: https://app.ecanvasser.com/documentation.html
 *
 * Key capabilities:
 * - Create and manage canvass campaigns
 * - Sync contact lists
 * - Retrieve canvass results
 * - Track volunteer activity
 */

import { logError } from '@/lib/logger';

const ECANVASSER_API_URL = process.env.ECANVASSER_API_URL || 'https://api.ecanvasser.com/v1';
const { ECANVASSER_API_KEY } = process.env;

interface EcanvasserRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, unknown>;
}

/**
 * Make authenticated request to Ecanvasser API
 */
async function ecanvasserRequest<T>(endpoint: string, options: EcanvasserRequestOptions = {}): Promise<T> {
  if (!ECANVASSER_API_KEY) {
    throw new Error('Ecanvasser API key not configured');
  }

  const response = await fetch(`${ECANVASSER_API_URL}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${ECANVASSER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(`Ecanvasser API error: ${error.message || response.statusText}`);
  }

  return response.json();
}

// Types based on Ecanvasser API
export interface EcanvasserCampaign {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface EcanvasserContact {
  id: string;
  first_name: string;
  last_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  email?: string;
}

export interface CanvassResult {
  contact_id: string;
  canvasser_id: string;
  status: 'contacted' | 'not_home' | 'refused' | 'moved' | 'deceased';
  support_level?: number; // 1-5 scale
  notes?: string;
  timestamp: string;
}

export interface CanvassStats {
  total_doors: number;
  doors_knocked: number;
  contacts_made: number;
  not_home: number;
  refused: number;
  support_levels: {
    strong_support: number;
    lean_support: number;
    undecided: number;
    lean_oppose: number;
    strong_oppose: number;
  };
}

/**
 * Get all campaigns
 */
export async function getCampaigns(): Promise<EcanvasserCampaign[]> {
  return ecanvasserRequest<EcanvasserCampaign[]>('/campaigns');
}

/**
 * Get a specific campaign
 */
export async function getCampaign(campaignId: string): Promise<EcanvasserCampaign> {
  return ecanvasserRequest<EcanvasserCampaign>(`/campaigns/${campaignId}`);
}

/**
 * Create a new canvass campaign in Ecanvasser
 */
export async function createCampaign(data: { name: string; description?: string }): Promise<EcanvasserCampaign> {
  return ecanvasserRequest<EcanvasserCampaign>('/campaigns', {
    method: 'POST',
    body: data,
  });
}

/**
 * Get contacts for a campaign
 */
export async function getContacts(
  campaignId: string,
  options?: { limit?: number; offset?: number },
): Promise<EcanvasserContact[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());

  const query = params.toString() ? `?${params.toString()}` : '';
  return ecanvasserRequest<EcanvasserContact[]>(`/campaigns/${campaignId}/contacts${query}`);
}

/**
 * Add contacts to a campaign
 */
export async function addContacts(
  campaignId: string,
  contacts: Omit<EcanvasserContact, 'id'>[],
): Promise<{ added: number; errors: string[] }> {
  // Ecanvasser requires one contact per request
  const results = await Promise.allSettled(
    contacts.map((contact) =>
      ecanvasserRequest(`/campaigns/${campaignId}/contacts`, {
        method: 'POST',
        body: contact,
      }),
    ),
  );

  const added = results.filter((r) => r.status === 'fulfilled').length;
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason.message);

  return { added, errors };
}

/**
 * Get canvass results for a campaign
 */
export async function getCanvassResults(campaignId: string): Promise<CanvassResult[]> {
  return ecanvasserRequest<CanvassResult[]>(`/campaigns/${campaignId}/results`);
}

/**
 * Calculate stats from canvass results
 */
export function calculateCanvassStats(results: CanvassResult[]): CanvassStats {
  const stats: CanvassStats = {
    total_doors: results.length,
    doors_knocked: results.filter((r) => r.status !== 'not_home').length,
    contacts_made: results.filter((r) => r.status === 'contacted').length,
    not_home: results.filter((r) => r.status === 'not_home').length,
    refused: results.filter((r) => r.status === 'refused').length,
    support_levels: {
      strong_support: 0,
      lean_support: 0,
      undecided: 0,
      lean_oppose: 0,
      strong_oppose: 0,
    },
  };

  // Calculate support levels (1-5 scale)
  results.forEach((r) => {
    if (r.support_level) {
      switch (r.support_level) {
        case 1:
          stats.support_levels.strong_support += 1;
          break;
        case 2:
          stats.support_levels.lean_support += 1;
          break;
        case 3:
          stats.support_levels.undecided += 1;
          break;
        case 4:
          stats.support_levels.lean_oppose += 1;
          break;
        case 5:
          stats.support_levels.strong_oppose += 1;
          break;
        default:
          // Unknown support level, ignore
          break;
      }
    }
  });

  return stats;
}

/**
 * Generate deep link to Ecanvasser mobile app
 */
export function generateCanvassDeepLink(campaignId: string, turfId?: string): string {
  // Ecanvasser uses web-based canvassing
  const baseUrl = 'https://app.ecanvasser.com/canvass';
  const params = new URLSearchParams({ campaign: campaignId });
  if (turfId) params.set('turf', turfId);

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Sync Our Power action with Ecanvasser campaign
 */
export async function syncActionToEcanvasser(action: {
  id: string;
  title: string;
  canvassArea?: string;
  campaignId: string;
}): Promise<{ ecanvasserCampaignId: string }> {
  // Create or update campaign in Ecanvasser
  const campaign = await createCampaign({
    name: action.title,
    description: `Our Power Action: ${action.canvassArea || 'General canvass'}`,
  });

  return { ecanvasserCampaignId: campaign.id };
}

/**
 * Get aggregated stats for Our Power dashboard
 */
export async function getActionCanvassStats(ecanvasserCampaignId: string): Promise<CanvassStats | null> {
  try {
    const results = await getCanvassResults(ecanvasserCampaignId);
    return calculateCanvassStats(results);
  } catch (error) {
    logError('Error fetching canvass stats', error);
    return null;
  }
}
