/**
 * Scale to Win Integration
 *
 * Scale to Win is a phone banking platform that integrates primarily through VAN.
 * For Our Power, we use a deep-linking approach:
 * 1. Organization sets up campaign in Scale to Win
 * 2. Organization provides the campaign URL to Our Power
 * 3. Users click "Start Calling" and are redirected to Scale to Win
 * 4. After calling, users return and mark completion manually
 *
 * Future enhancement: Direct VAN API integration for result syncing
 */

export interface ScaleToWinConfig {
  campaignUrl: string;
  campaignId?: string;
  vanApiKey?: string; // For future VAN integration
}

export interface ScaleToWinAction {
  id: string;
  title: string;
  callScript: string;
  targetCount?: number;
  dialerUrl: string;
}

/**
 * Generate a Scale to Win dialer URL for an action
 */
export function generateDialerUrl(config: ScaleToWinConfig): string {
  // Scale to Win uses direct campaign URLs
  // The URL structure is typically: https://www.scaletowin.com/dialer/[campaign-id]
  return config.campaignUrl;
}

/**
 * Generate a pre-configured deep link for a user
 * This can include user tracking parameters
 */
export function generateUserDialerLink(config: ScaleToWinConfig, userId: string, actionId: string): string {
  const baseUrl = config.campaignUrl;
  const params = new URLSearchParams({
    ref: 'ourpower',
    uid: userId.slice(-8), // Short user ID for tracking
    aid: actionId.slice(-8), // Short action ID
  });

  // Check if URL already has params
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}${params.toString()}`;
}

/**
 * Format call script for display
 */
export function formatCallScript(script: string): {
  greeting: string;
  body: string;
  closing: string;
} {
  const lines = script.split('\n').filter((l) => l.trim());

  return {
    greeting: lines[0] || 'Hello, my name is [YOUR NAME].',
    body: lines.slice(1, -1).join('\n') || script,
    closing: lines[lines.length - 1] || 'Thank you for your time.',
  };
}

/**
 * Track phone banking session start
 */
export async function trackSessionStart(
  userId: string,
  actionId: string,
): Promise<{ sessionId: string; startTime: Date; actionId: string }> {
  const sessionId = `stw-${Date.now()}-${userId.slice(-4)}`;
  return {
    sessionId,
    startTime: new Date(),
    actionId, // Include for tracking
  };
}

/**
 * Calculate estimated calls based on duration
 * Average call duration is ~2 minutes, plus ~30 seconds between calls
 */
export function estimateCalls(durationMinutes: number): number {
  const callsPerHour = 24; // Conservative estimate
  return Math.floor((durationMinutes / 60) * callsPerHour);
}

/**
 * Example usage in action form:
 *
 * const dialerUrl = generateUserDialerLink(
 *   { campaignUrl: action.dialerUrl },
 *   userId,
 *   actionId
 * );
 *
 * window.open(dialerUrl, '_blank');
 */
