import type { ModelInfo } from './settings';

const RECENT_KEY = 'ryokan-recent-models';
const RECENT_LIMIT = 20;
let recentModels: string[] = [];
let loaded = false;

export function getRecentModels(): string[] {
  if (!loaded && typeof localStorage !== 'undefined') {
    loaded = true;
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
      if (Array.isArray(stored)) recentModels = [...new Set(stored.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))].slice(0, RECENT_LIMIT);
    } catch { recentModels = []; }
  }
  return recentModels;
}

export function recordModelUse(model: string): void {
  const id = model.trim();
  if (!id) return;
  recentModels = [id, ...getRecentModels().filter(value => value !== id)].slice(0, RECENT_LIMIT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentModels)); } catch { /* Session-only history. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ryokan-model-used'));
}

// OpenRouter quotes USD per token. A value of $1/token already means $1m/M
// and indicates a malformed/sentinel quote, while ordinary prices stay intact.
export function pricePerMillion(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') return null;
  const perToken = Number(value);
  if (!Number.isFinite(perToken) || perToken < 0 || perToken >= 1) return null;
  const perMillion = perToken * 1_000_000;
  return Number.isFinite(perMillion) ? perMillion : null;
}

export function modelPrices(info: ModelInfo | undefined): { input: number; output: number } | null {
  const input = pricePerMillion(info?.pricing?.prompt);
  const output = pricePerMillion(info?.pricing?.completion);
  return input === null || output === null ? null : { input, output };
}

export function formatModelPrice(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
  }).format(value);
}

export function formatContextTokens(tokens: number | null | undefined): string {
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return '';
  if (tokens >= 1_000_000) {
    const million = tokens % 1_048_576 === 0 ? tokens / 1_048_576 : tokens / 1_000_000;
    return `${Number(million.toFixed(1))}M`;
  }
  if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}K`;
  return tokens.toLocaleString();
}
