import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrustStore } from './trust.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const envFile = join(root, '.env.local');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const settings = {
  port: Number(process.env.BRIDGE_PORT || 8787),
  key: process.env.ONMETA_API_KEY || '',
  secret: process.env.ONMETA_API_SECRET || '',
  wallet: process.env.ONMETA_TREASURY_ADDRESS || '',
  chainId: Number(process.env.ONMETA_CHAIN_ID || 1),
  token: process.env.ONMETA_TOKEN_SYMBOL || 'ETH',
  campaignId: Number(process.env.LANTERN_CAMPAIGN_ID || 1),
  ledger: process.env.LANTERN_LEDGER_ADDRESS || '',
  rpcUrl: process.env.LANTERN_RPC_URL || '',
  environment: process.env.ONMETA_ENVIRONMENT === 'production' ? 'production' : 'staging',
};
const escrowConfigured = Boolean(/^0x[0-9a-fA-F]{40}$/.test(settings.ledger) && settings.rpcUrl);
// Never open a real checkout if there is nowhere to verify and lock its proceeds.
const configured = Boolean(settings.key && settings.secret && /^0x[0-9a-fA-F]{40}$/.test(settings.wallet) && escrowConfigured);
const dataDir = process.env.BRIDGE_DATA_DIR || join(root, '.data');
const dataFile = join(dataDir, 'intents.json');
mkdirSync(dataDir, { recursive: true });
const trust = new TrustStore(join(dataDir, 'trust.json'));
const intents = new Map();
if (existsSync(dataFile)) {
  try { for (const item of JSON.parse(readFileSync(dataFile, 'utf8'))) intents.set(item.id, item); }
  catch { throw new Error('Could not read bridge intent store; refusing to overwrite it.'); }
}
function persist() {
  const temporary = `${dataFile}.tmp`;
  writeFileSync(temporary, JSON.stringify([...intents.values()], null, 2));
  renameSync(temporary, dataFile);
}
function reply(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function bodyText(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1_000_000) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function validSignature(raw, signature) {
  if (!settings.secret || !/^[0-9a-f]{64}$/i.test(signature || '')) return false;
  const parsed = JSON.parse(raw);
  const candidates = [raw, JSON.stringify(parsed)];
  const received = Buffer.from(signature, 'hex');
  return candidates.some(candidate => {
    const expected = createHmac('sha256', settings.secret).update(candidate).digest();
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
function publicIntent(item) {
  return { id: item.id, campaignId: item.campaignId, amountInr: item.amountInr, status: item.status, createdAt: item.createdAt, orderId: item.orderId, conversionTx: item.conversionTx, receivedWei: item.receivedWei, escrowTx: item.escrowTx };
}
async function rpc(method, params) {
  const response = await fetch(settings.rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Blockchain RPC unavailable');
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || 'Blockchain RPC error');
  return body.result;
}
async function verifyEscrowTransaction(intent, txHash) {
  if (!escrowConfigured) throw new Error('Campaign contract and RPC are not configured');
  if (intent.status !== 'converted_to_account') throw new Error('Conversion has not been confirmed');
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Invalid transaction hash');
  const [chainId, tx, receipt] = await Promise.all([
    rpc('eth_chainId', []),
    rpc('eth_getTransactionByHash', [txHash]),
    rpc('eth_getTransactionReceipt', [txHash]),
  ]);
  if (Number(BigInt(chainId)) !== settings.chainId) throw new Error('Wrong network');
  if (!tx || !receipt || receipt.status !== '0x1') throw new Error('Campaign deposit is not confirmed');
  if (String(tx.to).toLowerCase() !== settings.ledger.toLowerCase()) throw new Error('Deposit did not reach the campaign contract');
  if (String(tx.from).toLowerCase() !== settings.wallet.toLowerCase()) throw new Error('Deposit did not come from the receiving account');
  if (BigInt(tx.value) !== BigInt(intent.receivedWei)) throw new Error('Deposit amount does not match the conversion');
  const expectedData = `0xf14faf6f${BigInt(intent.campaignId).toString(16).padStart(64, '0')}`;
  if (String(tx.input).toLowerCase() !== expectedData) throw new Error('Deposit was not assigned to this campaign');
  for (const other of intents.values()) if (other.id !== intent.id && other.escrowTx === txHash) throw new Error('Deposit already credited');
  intent.status = 'escrowed';
  intent.escrowTx = txHash;
  intent.escrowedAt = new Date().toISOString();
  persist();
  return publicIntent(intent);
}
function applyCompletedOrder(event) {
  const order = event.request_data && typeof event.request_data === 'object' ? event.request_data : event;
  if (order.eventType !== 'onramp' || order.status !== 'completed') return { ignored: true };
  const intentId = order.metaData?.donationIntentId;
  const intent = intents.get(intentId);
  if (!intent) throw new Error('Unknown donation intent');
  if (String(order.currency).toUpperCase() !== 'INR') throw new Error('Wrong fiat currency');
  if (Number(order.fiat) !== intent.amountInr) throw new Error('Fiat amount mismatch');
  if (String(order.receiverWalletAddress).toLowerCase() !== settings.wallet.toLowerCase()) throw new Error('Wrong destination account');
  if (Number(order.chainId) !== settings.chainId) throw new Error('Wrong network');
  if (String(order.buyTokenSymbol).toUpperCase() !== settings.token.toUpperCase()) throw new Error('Wrong asset');
  const orderId = String(order.orderId || '');
  const conversionTx = String(order.txnHash || order.txnhash || '');
  const receivedWei = String(order.transferredAmountWei || order.transferredamountwei || '');
  if (!orderId || !/^0x[0-9a-fA-F]{64}$/.test(conversionTx) || !/^[0-9]+$/.test(receivedWei) || BigInt(receivedWei) === 0n) throw new Error('Incomplete conversion record');
  for (const other of intents.values()) if (other.id !== intent.id && (other.orderId === orderId || other.conversionTx === conversionTx)) throw new Error('Conversion already credited');
  if (intent.orderId && intent.orderId !== orderId) throw new Error('Intent already linked to a different order');
  intent.status = 'converted_to_account';
  intent.orderId = orderId;
  intent.conversionTx = conversionTx;
  intent.receivedWei = receivedWei;
  intent.convertedAt = new Date().toISOString();
  persist();
  return { accepted: true, id: intent.id };
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/health') return reply(res, 200, { ok: true, configured });
    if (req.method === 'GET' && url.pathname === '/api/trust/ngos') return reply(res, 200, trust.list());
    if (req.method === 'POST' && url.pathname === '/api/trust/ngos') return reply(res, 201, trust.register(JSON.parse(await bodyText(req))));
    if (req.method === 'POST' && url.pathname === '/api/trust/demo-donations') return reply(res, 201, trust.donor(Number(JSON.parse(await bodyText(req)).amountInr)));
    if (req.method === 'POST' && url.pathname === '/api/trust/demo/reset') return reply(res, 200, trust.reset());
    const ngoMatch = /^\/api\/trust\/ngos\/([a-z0-9-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && ngoMatch) {
      const token = String(req.headers.authorization || '').replace(/^Bearer /i, '');
      let donorId;
      if (token) { try { donorId = trust.findDonor(token).id; } catch { /* public view */ } }
      return reply(res, 200, trust.get(ngoMatch[1], donorId));
    }
    const advanceMatch = /^\/api\/trust\/ngos\/([a-z0-9-]+)\/advances$/.exec(url.pathname);
    if (req.method === 'POST' && advanceMatch) return reply(res, 201, trust.advance(advanceMatch[1], JSON.parse(await bodyText(req))));
    const proofMatch = /^\/api\/trust\/ngos\/([a-z0-9-]+)\/proofs$/.exec(url.pathname);
    if (req.method === 'POST' && proofMatch) return reply(res, 201, trust.proof(proofMatch[1], JSON.parse(await bodyText(req))));
    const attackMatch = /^\/api\/trust\/ngos\/([a-z0-9-]+)\/demo-attack$/.exec(url.pathname);
    if (req.method === 'POST' && attackMatch) return reply(res, 200, trust.demoAttack(attackMatch[1]));
    const voteMatch = /^\/api\/trust\/ngos\/([a-z0-9-]+)\/proofs\/([a-z0-9-]+)\/votes$/.exec(url.pathname);
    if (req.method === 'POST' && voteMatch) return reply(res, 200, trust.vote(voteMatch[1], voteMatch[2], String(req.headers.authorization || '').replace(/^Bearer /i, ''), JSON.parse(await bodyText(req)).support));
    if (req.method === 'GET' && url.pathname === '/api/onramp/config') return reply(res, 200, {
      configured, environment: settings.environment, apiKey: configured ? settings.key : null,
      walletAddress: configured ? settings.wallet : null, chainId: settings.chainId,
      tokenSymbol: settings.token, campaignId: settings.campaignId,
      escrowConfigured, ledgerAddress: escrowConfigured ? settings.ledger : null,
    });
    if (req.method === 'POST' && url.pathname === '/api/onramp/intents') {
      if (!configured) return reply(res, 503, { error: 'On-ramp credentials have not been configured.' });
      const body = JSON.parse(await bodyText(req));
      const amountInr = Number(body.amountInr);
      if (!Number.isSafeInteger(amountInr) || amountInr < 100 || amountInr > 20_000) return reply(res, 400, { error: 'Choose an amount from ₹100 to ₹20,000 for this test flow.' });
      const intent = { id: randomUUID(), campaignId: settings.campaignId, amountInr, status: 'checkout_open', createdAt: new Date().toISOString() };
      intents.set(intent.id, intent); persist();
      return reply(res, 201, publicIntent(intent));
    }
    const match = /^\/api\/onramp\/intents\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === 'GET' && match) {
      const intent = intents.get(match[1]);
      return intent ? reply(res, 200, publicIntent(intent)) : reply(res, 404, { error: 'Donation intent not found.' });
    }
    const depositMatch = /^\/api\/onramp\/intents\/([0-9a-f-]{36})\/escrow$/.exec(url.pathname);
    if (req.method === 'POST' && depositMatch) {
      const intent = intents.get(depositMatch[1]);
      if (!intent) return reply(res, 404, { error: 'Donation intent not found.' });
      const body = JSON.parse(await bodyText(req));
      try { return reply(res, 200, await verifyEscrowTransaction(intent, String(body.txHash || ''))); }
      catch (error) { return reply(res, 422, { error: error.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/webhooks/onmeta') {
      if (!settings.secret) return reply(res, 503, { error: 'Webhook secret has not been configured.' });
      const raw = await bodyText(req);
      if (!validSignature(raw, req.headers['x-onmeta-signature'])) return reply(res, 401, { error: 'Invalid webhook signature.' });
      try { return reply(res, 200, applyCompletedOrder(JSON.parse(raw))); }
      catch (error) { return reply(res, 422, { error: error.message }); }
    }
    return reply(res, 404, { error: 'Not found.' });
  } catch (error) { return reply(res, error.status || 400, { error: error.message }); }
});

if (process.env.NODE_ENV !== 'test') server.listen(settings.port, '127.0.0.1', () => {
  console.log(`Lantern bridge listening on http://127.0.0.1:${settings.port} (${configured ? 'configured' : 'credentials missing'})`);
});
