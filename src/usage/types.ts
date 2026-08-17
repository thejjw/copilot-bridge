// Types for provider plan usage, quota tracking, and balance metrics.

import type { ProviderId } from '../providers';

export type UsageStatus = 'ok' | 'low' | 'critical' | 'error';

export interface QuotaResetInfo {
  label: string;
  countdown: string;
  targetDate?: Date;
}

export interface UsageReport {
  providerId: ProviderId;
  providerName: string;
  /** Primary numeric percentage remaining (0-100), if applicable. */
  percentageRemaining?: number;
  /** Primary currency balance string (e.g. "¥299.79"), if applicable. */
  balanceDisplay?: string;
  /** Detailed breakdown bullets (e.g. "3,950 / 4,000 calls left", "5h token limit: 99%"). */
  details: string[];
  /** Primary next quota reset timestamp, if known. */
  nextResetTime?: Date;
  /** Primary formatted human-readable reset countdown (e.g. "in 3h 42m"). */
  resetCountdown?: string;
  /** Comprehensive list of all active reset countdowns (e.g. 5-Hour rolling window, Weekly membership reset). */
  resets?: QuotaResetInfo[];
  status: UsageStatus;
  lastUpdated: Date;
  errorMessage?: string;
}

/** Calculate human-readable countdown to a future date. */
export function formatCountdown(target: Date): string {
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return 'now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `in ${hours}h ${remMins}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

/** Get a clean pie-chart glyph for a 0-100 percentage. */
export function getPieGlyph(percent: number): string {
  if (percent >= 88) return '●'; // 100% full
  if (percent >= 63) return '◕'; // 75%
  if (percent >= 38) return '◑'; // 50%
  if (percent >= 13) return '◔'; // 25%
  return '○';                   // < 13% empty / critical
}

/** Get a clean Datatype codicon reference for a 0-100 percentage. */
export function getDatatypeIcon(percent: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return `$(copilot-bridge-p${clamped})`;
}
