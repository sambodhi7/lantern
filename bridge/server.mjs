import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrustStore } from './trust.mjs';
import { Database } from './database.mjs';
import { VerificationService,sampleReceipt } from './verification.mjs';
import { assertDonationEvent } from './chain.mjs';
import { TestnetService } from './testnet.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const envFile = join(root, '.env.local');
if (process.env.NODE_ENV !== 'test' && existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

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
  confirmations: Math.max(1, Number(process.env.LANTERN_MIN_CONFIRMATIONS || 2)),
};
const escrowConfigured = Boolean(/^0x[0-9a-fA-F]{40}$/.test(settings.ledger) && settings.rpcUrl);
// Never open a real checkout if there is nowhere to verify and lock its proceeds.
const configured = Boolean(settings.key && settings.secret && /^0x[0-9a-fA-F]{40}$/.test(settings.wallet) && escrowConfigured && settings.token === 'ETH');
const dataDir = process.env.BRIDGE_DATA_DIR || join(root, '.data');
const dataFile = join(dataDir, 'intents.json');
mkdirSync(dataDir, { recursive: true });
const database = process.env.DATABASE_URL ? new Database(process.env.DATABASE_URL) : null;
const trust = new TrustStore(database ? null : join(dataDir, 'trust.json'));
if (database && existsSync(join(dataDir,'trust.json'))) { trust.data = JSON.parse(readFileSync(join(dataDir,'trust.json'),'utf8')); trust.migrate(); }
const verification = new VerificationService({ dataDir });
const testnet = new TestnetService();
const intents = new Map();
if (existsSync(dataFile)) {
  try { for (const item of JSON.parse(readFileSync(dataFile, 'utf8'))) intents.set(item.id, item); }
  catch { throw new Error('Could not read bridge intent store; refusing to overwrite it.'); }
}
function persist() {
  if (database) return;
  const temporary = `${dataFile}.tmp`;
  writeFileSync(temporary, JSON.stringify([...intents.values()], null, 2));
  renameSync(temporary, dataFile);
}
if (database) await database.init(trust, intents);
function reply(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function bodyText(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 9_000_000) throw new Error('Request too large');
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
  txHash = txHash.toLowerCase();
  if (intent.status === 'escrowed' && intent.escrowTx === txHash) return publicIntent(intent);
  if (intent.status !== 'converted_to_account') throw new Error('Conversion has not been confirmed');
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Invalid transaction hash');
  const [chainId, tx, receipt] = await Promise.all([
    rpc('eth_chainId', []),
    rpc('eth_getTransactionByHash', [txHash]),
    rpc('eth_getTransactionReceipt', [txHash]),
  ]);
  if (Number(BigInt(chainId)) !== settings.chainId) throw new Error('Wrong network');
  if (!tx || !receipt || receipt.status !== '0x1') throw new Error('Campaign deposit is not confirmed');
  await verifyConfirmations(receipt);
  if (String(tx.to).toLowerCase() !== settings.ledger.toLowerCase()) throw new Error('Deposit did not reach the campaign contract');
  if (String(tx.from).toLowerCase() !== settings.wallet.toLowerCase()) throw new Error('Deposit did not come from the receiving account');
  if (BigInt(tx.value) !== BigInt(intent.receivedWei)) throw new Error('Deposit amount does not match the conversion');
  const expectedData = `0xf14faf6f${BigInt(intent.campaignId).toString(16).padStart(64, '0')}`;
  if (String(tx.input).toLowerCase() !== expectedData) throw new Error('Deposit was not assigned to this campaign');
  assertDonationEvent(receipt, { ledger:settings.ledger, wallet:settings.wallet, campaignId:intent.campaignId, amountWei:intent.receivedWei });
  for (const other of intents.values()) if (other.id !== intent.id && other.escrowTx === txHash) throw new Error('Deposit already credited');
  intent.status = 'escrowed';
  intent.escrowTx = txHash;
  intent.escrowedAt = new Date().toISOString();
  trust.creditPayment(intent.id, intent.amountInr, txHash);
  persist();
  return publicIntent(intent);
}
async function verifyConfirmations(receipt) {
  if (!receipt.blockNumber) throw new Error('Transaction is not confirmed');
  const latest = BigInt(await rpc('eth_blockNumber', []));
  if (latest - BigInt(receipt.blockNumber) + 1n < BigInt(settings.confirmations)) throw new Error('Transaction is not confirmed deeply enough; retry shortly');
}
async function applyCompletedOrder(event) {
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
  const conversionTx = String(order.txnHash || order.txnhash || '').toLowerCase();
  const receivedWei = String(order.transferredAmountWei || order.transferredamountwei || '');
  if (!orderId || !/^0x[0-9a-fA-F]{64}$/.test(conversionTx) || !/^[0-9]+$/.test(receivedWei) || BigInt(receivedWei) === 0n) throw new Error('Incomplete conversion record');
  for (const other of intents.values()) if (other.id !== intent.id && (other.orderId === orderId || other.conversionTx === conversionTx)) throw new Error('Conversion already credited');
  if (intent.orderId && intent.orderId !== orderId) throw new Error('Intent already linked to a different order');
  if (intent.orderId === orderId) {
    if (intent.conversionTx !== conversionTx || intent.receivedWei !== receivedWei) throw new Error('Conflicting conversion replay');
    return { accepted: true, duplicate: true, id: intent.id };
  }
  const [chain, tx, receipt] = await Promise.all([rpc('eth_chainId', []), rpc('eth_getTransactionByHash',[conversionTx]), rpc('eth_getTransactionReceipt',[conversionTx])]);
  if (Number(BigInt(chain)) !== settings.chainId || !tx || !receipt || receipt.status !== '0x1') throw new Error('Conversion transfer is not confirmed on the configured chain');
  if (String(tx.to).toLowerCase() !== settings.wallet.toLowerCase() || BigInt(tx.value) !== BigInt(receivedWei)) throw new Error('Conversion transaction does not match the receiving account and amount');
  await verifyConfirmations(receipt);
  intent.status = 'converted_to_account';
  intent.orderId = orderId;
  intent.conversionTx = conversionTx;
  intent.receivedWei = receivedWei;
  intent.convertedAt = new Date().toISOString();
  persist();
  return { accepted: true, id: intent.id };
}

async function handle(req, res, client) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const campaignId=url.searchParams.get('campaign')||undefined;
  try {
    if (req.method === 'GET' && url.pathname === '/health') return reply(res, 200, { ok: true, configured, database: database ? 'postgresql' : 'local-files', verification: Boolean(verification.apiKey), authentication: false });
    if (req.method === 'GET' && url.pathname === '/api/testnet/config') return reply(res,200,testnet.config(trust,campaignId));
    if (req.method === 'POST' && url.pathname === '/api/testnet/prepare') return reply(res,200,await testnet.prepare(trust,{...JSON.parse(await bodyText(req)),localCampaignId:campaignId}));
    if (req.method === 'POST' && url.pathname === '/api/testnet/confirm') return reply(res,200,await testnet.confirm(trust,{...JSON.parse(await bodyText(req)),localCampaignId:campaignId}));
    if (req.method === 'POST' && url.pathname === '/api/testnet/voter/challenge') return reply(res,200,await testnet.voterChallenge(trust,{...JSON.parse(await bodyText(req)),localCampaignId:campaignId}));
    if (req.method === 'POST' && url.pathname === '/api/testnet/voter/session') return reply(res,200,await testnet.voterSession(trust,JSON.parse(await bodyText(req))));
    if (req.method === 'GET' && url.pathname === '/api/verification/config') return reply(res, 200, { configured: Boolean(verification.apiKey), model: verification.model });
    if (req.method === 'GET' && url.pathname === '/api/verification/sample') return reply(res,200,{image:`data:image/png;base64,${(await sampleReceipt()).toString('base64')}`,amountInr:500});
    const analyzeMatch = /^\/api\/trust\/ngos\/([a-z0-9-]+)\/analyze$/.exec(url.pathname);
    if (req.method === 'POST' && analyzeMatch) {
      // Read the latest campaign without holding the accounting lock during AI calls.
      const analysisTrust=database?new TrustStore(null):trust;
      if(database){const {rows}=await database.pool.query('SELECT trust FROM lantern_state WHERE id=1');analysisTrust.data=rows[0].trust;}
      const ngo = analysisTrust.ngo(analyzeMatch[1]);
      const input = JSON.parse(await bodyText(req));
      const campaign=analysisTrust.campaign(ngo,campaignId);
      return reply(res, 200, await verification.analyze(ngo.id, { ...input, category: campaign.category,campaignId:campaign.id }, client));
    }
    if (req.method === 'GET' && url.pathname === '/api/trust/ngos') return reply(res, 200, trust.list());
    if (req.method === 'POST' && url.pathname === '/api/trust/ngos') return reply(res, 201, trust.register(JSON.parse(await bodyText(req))));
    const campaignsMatch=/^\/api\/trust\/ngos\/([a-z0-9-]+)\/campaigns$/.exec(url.pathname);
    if(campaignsMatch && req.method==='GET'){const ngo=trust.ngo(campaignsMatch[1]);return reply(res,200,ngo.campaigns.map(c=>({id:c.id,name:c.name,category:c.category,targetInr:c.fundraising.targetInr,raisedInr:c.fundraising.raisedInr,story:c.fundraising.story,status:c.fundraising.status,ngoName:ngo.name,country:ngo.country,score:c.score,proofCount:c.proofs.length,blockchain:trust.get(ngo.id,undefined,c.id).blockchain})));}
    if(campaignsMatch && req.method==='POST')return reply(res,201,trust.createCampaign(campaignsMatch[1],JSON.parse(await bodyText(req))));
    if (req.method === 'POST' && url.pathname === '/api/trust/demo-donations') {
      if(process.env.NODE_ENV!=='test')return reply(res,403,{error:'Simulated donations are disabled. Donate through the campaign smart contract with MetaMask.'});
      const body = JSON.parse(await bodyText(req));
      return reply(res, 201, trust.donor(Number(body.amountInr), String(body.ngoId || 'harbor-hands'),campaignId));
    }
    if (req.method === 'POST' && url.pathname === '/api/trust/demo/reset') return reply(res, 200, trust.reset());
    const ngoMatch = /^\/api\/trust\/ngos\/([a-z0-9-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && ngoMatch) {
      const token = String(req.headers.authorization || '').replace(/^Bearer /i, '');
      let donorId;
      if (token) { try { donorId = trust.findDonor(token).id; } catch { /* public view */ } }
      return reply(res, 200, trust.get(ngoMatch[1], donorId,campaignId));
    }
    const advanceMatch = /^\/api\/trust\/ngos\/([a-z0-9-]+)\/advances$/.exec(url.pathname);
    if (req.method === 'POST' && advanceMatch) return reply(res, 201, trust.advance(advanceMatch[1], JSON.parse(await bodyText(req)),campaignId));
    const requestMatch = /^\/api\/trust\/ngos\/([a-z0-9-]+)\/request$/.exec(url.pathname);
    if (req.method === 'POST' && requestMatch) return reply(res, 200, trust.requestFunding(requestMatch[1], JSON.parse(await bodyText(req)),campaignId));
    const proofMatch = /^\/api\/trust\/ngos\/([a-z0-9-]+)\/proofs$/.exec(url.pathname);
    if (req.method === 'POST' && proofMatch) {
      let input = JSON.parse(await bodyText(req));
      // A client may request analysis, but cannot manufacture its outcome.
      delete input.verification;
      if (input.evidenceId) {
        if (input.privacyReviewed !== true) return reply(res, 400, { error: 'Review the redacted preview before publication.' });
        const record = await verification.load(input.evidenceId, proofMatch[1], client);
        return reply(res,201,trust.publishVerified(proofMatch[1],input,record,campaignId));
      }
      return reply(res, 201, trust.proof(proofMatch[1], input,campaignId));
    }
    const attackMatch = /^\/api\/trust\/ngos\/([a-z0-9-]+)\/demo-attack$/.exec(url.pathname);
    if (req.method === 'POST' && attackMatch) return reply(res, 200, trust.demoAttack(attackMatch[1]));
    const voteMatch = /^\/api\/trust\/ngos\/([a-z0-9-]+)\/proofs\/([a-z0-9-]+)\/votes$/.exec(url.pathname);
    if (req.method === 'POST' && voteMatch) {
      const token=String(req.headers.authorization || '').replace(/^Bearer /i,'');
      if(process.env.NODE_ENV!=='test' && trust.findDonor(token).demo)return reply(res,403,{error:'Only verified blockchain donors can review receipts. Enable reviews with your donor wallet.'});
      return reply(res,200,trust.vote(voteMatch[1],voteMatch[2],token,JSON.parse(await bodyText(req)).support,campaignId));
    }
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
      try { return reply(res, 200, await applyCompletedOrder(JSON.parse(raw))); }
      catch (error) { return reply(res, 422, { error: error.message }); }
    }
    return reply(res, 404, { error: 'Not found.' });
  } catch (error) { return reply(res, error.status || 400, { error: error.message }); }
}

// Serialize local state too. In PostgreSQL mode, lock/load/commit precede the
// HTTP success response so a failed write cannot appear as a saved donation.
let pending = Promise.resolve();
export const server = createServer((req, res) => {
  // AI processing does not need the ledger lock. Its single encrypted evidence
  // INSERT is atomic; donors can keep reading and donating during model calls.
  if (req.method === 'POST' && /^\/api\/trust\/ngos\/[a-z0-9-]+\/analyze(?:\?|$)/.test(req.url || '')) {
    void handle(req, res, database?.pool || null);
    return;
  }
  const execute = async () => {
    let code = 500, headers = {}, body = '';
    const captured = { writeHead(status, values) { code=status; headers=values; }, end(value) { body=value; } };
    try {
      if (database) await database.run(trust, intents, client => handle(req, captured, client));
      else await handle(req, captured, null);
      res.writeHead(code, headers); res.end(body);
    } catch { reply(res, 503, { error: 'Storage is unavailable. No success was recorded; retry after checking the service.' }); }
  };
  pending = pending.then(execute, execute);
});
server.on('close', () => { void database?.close(); });

if (process.env.NODE_ENV !== 'test') server.listen(settings.port, '127.0.0.1', () => {
  console.log(`Lantern bridge listening on http://127.0.0.1:${settings.port} (${configured ? 'configured' : 'credentials missing'})`);
});
