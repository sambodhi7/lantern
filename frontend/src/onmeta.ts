export type OnrampConfig = {
  configured: boolean;
  environment: 'staging' | 'production';
  apiKey: string | null;
  walletAddress: string | null;
  chainId: number;
  tokenSymbol: string;
  campaignId: number;
  escrowConfigured: boolean;
  ledgerAddress: string | null;
};

export type OnrampIntent = {
  id: string;
  amountInr: number;
  campaignId: number;
  status: 'checkout_open' | 'converted_to_account' | 'escrowed';
  createdAt: string;
  orderId?: string;
  conversionTx?: string;
  receivedWei?: string;
  escrowTx?: string;
};

type Widget = { init(): void; on(event: string, callback: (data: unknown) => void): void };
declare global {
  interface Window {
    onMetaWidget?: new (options: Record<string, unknown>) => Widget;
  }
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(environment: OnrampConfig['environment']) {
  if (window.onMetaWidget) return Promise.resolve();
  if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = environment === 'production'
      ? 'https://platform.onmeta.in/onmeta-sdk.js'
      : 'https://stg.platform.onmeta.in/onmeta-sdk.js';
    script.async = true;
    script.onload = () => {
      if (window.onMetaWidget) resolve();
      else { sdkPromise = null; reject(new Error('Onmeta widget did not initialize.')); }
    };
    script.onerror = () => { sdkPromise = null; reject(new Error('Could not load the payment provider.')); };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export async function fetchOnrampConfig(): Promise<OnrampConfig> {
  const response = await fetch('/api/onramp/config', { cache: 'no-store' });
  if (!response.ok) throw new Error('Conversion bridge is unavailable.');
  return response.json() as Promise<OnrampConfig>;
}

export async function createOnrampIntent(amountInr: number): Promise<OnrampIntent> {
  const response = await fetch('/api/onramp/intents', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountInr }),
  });
  const data = await response.json() as OnrampIntent & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Could not start the INR checkout.');
  return data;
}

export async function fetchOnrampIntent(id: string): Promise<OnrampIntent> {
  const response = await fetch(`/api/onramp/intents/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not refresh the payment status.');
  return response.json() as Promise<OnrampIntent>;
}

export async function confirmEscrowDeposit(id: string, txHash: string): Promise<OnrampIntent> {
  const response = await fetch(`/api/onramp/intents/${encodeURIComponent(id)}/escrow`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ txHash }),
  });
  const data = await response.json() as OnrampIntent & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Could not verify the campaign deposit.');
  return data;
}

export async function mountOnmetaWidget(
  elementId: string,
  config: OnrampConfig,
  intent: OnrampIntent,
  onOrderEvent: () => void,
) {
  if (!config.configured || !config.apiKey || !config.walletAddress) throw new Error('Conversion bridge has not been configured.');
  await loadSdk(config.environment);
  if (!window.onMetaWidget) throw new Error('Onmeta widget is unavailable.');
  const widget = new window.onMetaWidget({
    elementId,
    apiKey: config.apiKey,
    environment: config.environment,
    fiatType: 'inr',
    fiatAmount: intent.amountInr,
    walletAddress: config.walletAddress,
    chainId: String(config.chainId),
    tokenSymbol: config.tokenSymbol,
    paymentMethod: 'INR_UPI',
    onRamp: 'enabled',
    offRamp: 'disabled',
    metaData: { donationIntentId: intent.id, campaignId: String(intent.campaignId) },
  });
  widget.init();
  widget.on('ORDER_COMPLETED_EVENTS', onOrderEvent);
}
