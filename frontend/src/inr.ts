export type MarketRate = { inrPerEth: number; updatedAt: number };

const RATE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr&include_last_updated_at=true';
const CACHE_KEY = 'lantern-market-rate-v1';
export const MAX_RATE_AGE_MS = 5 * 60 * 1000;

export function isFreshRate(rate: MarketRate | null, now = Date.now()) {
  return !!rate && rate.inrPerEth > 0 && now - rate.updatedAt < MAX_RATE_AGE_MS && rate.updatedAt <= now + 60_000;
}

export function formatInr(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(value);
}

export function chainToInr(amount: number, rate: MarketRate | null) {
  return rate ? `≈ ${formatInr(amount * rate.inrPerEth)}` : 'Rate unavailable';
}

export function readCachedRate(): MarketRate | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const value = raw ? JSON.parse(raw) as MarketRate : null;
    return isFreshRate(value) ? value : null;
  } catch { return null; }
}

export async function fetchMarketRate(signal?: AbortSignal): Promise<MarketRate> {
  const response = await fetch(RATE_URL, { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`Rate service returned ${response.status}`);
  const body = await response.json() as { ethereum?: { inr?: number; last_updated_at?: number } };
  const value: MarketRate = {
    inrPerEth: Number(body.ethereum?.inr),
    updatedAt: Number(body.ethereum?.last_updated_at) * 1000,
  };
  if (!isFreshRate(value)) throw new Error('Rate service returned an outdated price');
  localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  return value;
}
