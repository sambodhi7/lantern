import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { VerificationService, seal } from './verification.mjs';

const temp = mkdtempSync(join(tmpdir(), 'lantern-bridge-test-'));
const ledger = '0x2222222222222222222222222222222222222222';
const rpcServer = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const { method, params } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const tx = {
    from: process.env.ONMETA_TREASURY_ADDRESS, to: ledger,
    value: `0x${2000000000000000n.toString(16)}`,
    input: `0xf14faf6f${1n.toString(16).padStart(64, '0')}`,
  };
  const known = ['a','b','c'].some(c => params[0] === `0x${c.repeat(64)}`);
  const result = method === 'eth_chainId' ? '0x1'
    : method === 'eth_blockNumber' ? '0x4'
    : method === 'eth_getTransactionByHash' && known ? (params[0] === `0x${'b'.repeat(64)}` ? tx : { ...tx, to: process.env.ONMETA_TREASURY_ADDRESS })
    : method === 'eth_getTransactionReceipt' && known ? { status: '0x1', blockNumber: '0x1' }
    : null;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
});
await new Promise(resolve => rpcServer.listen(0, '127.0.0.1', resolve));
process.env.NODE_ENV = 'test';
process.env.BRIDGE_DATA_DIR = temp;
process.env.ONMETA_API_KEY = 'staging-public-key';
process.env.ONMETA_API_SECRET = 'test-only-webhook-secret';
process.env.ONMETA_TREASURY_ADDRESS = '0x1111111111111111111111111111111111111111';
process.env.ONMETA_CHAIN_ID = '1';
process.env.ONMETA_TOKEN_SYMBOL = 'ETH';
process.env.LANTERN_LEDGER_ADDRESS = ledger;
process.env.LANTERN_RPC_URL = `http://127.0.0.1:${rpcServer.address().port}`;
const { server } = await import('./server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (path, data, signature = '') => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-onmeta-signature': signature },
  body: JSON.stringify(data),
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => rpcServer.close(resolve));
  if (dirname(resolve(temp)) === resolve(tmpdir())) rmSync(temp, { recursive: true, force: true });
});

test('converted funds only become protected after an independently checked campaign deposit', async () => {
  const intent = await (await post('/api/onramp/intents', { amountInr: 1000 })).json();
  const order = {
    eventType: 'onramp', status: 'completed', orderId: 'order-escrow', fiat: 1000,
    currency: 'INR', receiverWalletAddress: process.env.ONMETA_TREASURY_ADDRESS,
    chainId: 1, buyTokenSymbol: 'ETH', transferredAmountWei: '2000000000000000',
    txnHash: `0x${'c'.repeat(64)}`, metaData: { donationIntentId: intent.id },
  };
  const signature = createHmac('sha256', process.env.ONMETA_API_SECRET).update(JSON.stringify(order)).digest('hex');
  assert.equal((await post('/webhooks/onmeta', order, signature)).status, 200);
  let read = await (await fetch(`${base}/api/onramp/intents/${intent.id}`)).json();
  assert.equal(read.status, 'converted_to_account');
  assert.equal((await post(`/api/onramp/intents/${intent.id}/escrow`, { txHash: `0x${'d'.repeat(64)}` })).status, 422);
  read = await (await fetch(`${base}/api/onramp/intents/${intent.id}`)).json();
  assert.equal(read.status, 'converted_to_account');
  assert.equal((await post(`/api/onramp/intents/${intent.id}/escrow`, { txHash: `0x${'b'.repeat(64)}` })).status, 200);
  read = await (await fetch(`${base}/api/onramp/intents/${intent.id}`)).json();
  assert.equal(read.status, 'escrowed');
  assert.equal((await post('/webhooks/onmeta', order, signature)).status, 200);
  read = await (await fetch(`${base}/api/onramp/intents/${intent.id}`)).json();
  assert.equal(read.status, 'escrowed', 'webhook replay cannot move escrowed funds backward');
  assert.equal((await post(`/api/onramp/intents/${intent.id}/escrow`, { txHash: `0x${'b'.repeat(64)}` })).status, 200);
  const ngo = await (await fetch(`${base}/api/trust/ngos/harbor-hands`)).json();
  assert.equal(ngo.campaign.fundraising.raisedInr, 1_001_000, 'settlement credited exactly once');
});

test('signed completed order changes only the matching intent, once', async () => {
  const config = await (await fetch(`${base}/api/onramp/config`)).json();
  assert.equal(config.configured, true);
  assert.equal(config.apiKey, 'staging-public-key');
  assert.equal(JSON.stringify(config).includes('test-only-webhook-secret'), false);

  const intentResponse = await post('/api/onramp/intents', { amountInr: 500 });
  assert.equal(intentResponse.status, 201);
  const intent = await intentResponse.json();
  assert.equal(intent.status, 'checkout_open');

  const order = {
    eventType: 'onramp', status: 'completed', orderId: 'order-001', fiat: 500,
    currency: 'INR', receiverWalletAddress: process.env.ONMETA_TREASURY_ADDRESS,
    chainId: 1, buyTokenSymbol: 'ETH', transferredAmountWei: '2000000000000000',
    txnHash: `0x${'a'.repeat(64)}`, metaData: { donationIntentId: intent.id },
    customer: { email: 'private@example.com' },
  };
  assert.equal((await post('/webhooks/onmeta', order, '0'.repeat(64))).status, 401);
  let read = await (await fetch(`${base}/api/onramp/intents/${intent.id}`)).json();
  assert.equal(read.status, 'checkout_open');
  const signature = createHmac('sha256', process.env.ONMETA_API_SECRET).update(JSON.stringify(order)).digest('hex');
  assert.equal((await post('/webhooks/onmeta', order, signature)).status, 200);
  assert.equal((await post('/webhooks/onmeta', order, signature)).status, 200);
  read = await (await fetch(`${base}/api/onramp/intents/${intent.id}`)).json();
  assert.equal(read.status, 'converted_to_account');
  assert.equal(read.conversionTx, order.txnHash);
  assert.equal(JSON.stringify(read).includes('private@example.com'), false);

  const second = await (await post('/api/onramp/intents', { amountInr: 500 })).json();
  const reused = { ...order, metaData: { donationIntentId: second.id } };
  const reusedSignature = createHmac('sha256', process.env.ONMETA_API_SECRET).update(JSON.stringify(reused)).digest('hex');
  assert.equal((await post('/webhooks/onmeta', reused, reusedSignature)).status, 422);
});

test('publishing an analyzed receipt uses server-owned fields and requires a privacy review', async () => {
  const verifier=new VerificationService({dataDir:temp,apiKey:''});
  const id=randomUUID();
  const publicRecord={id,ngoId:'harbor-hands',amountInr:1000,title:'Receipt for campaign supplies',summary:'Expense evidence with private fields withheld.',documentHash:`0x${'e'.repeat(64)}`,publicImage:'',privacy:'image_withheld',status:'checks_passed',model:'test-model',checks:{amountMatches:true,categoryMatches:true,readable:true,suspicious:false,identityPresent:true},limitation:'Assessment only.'};
  const analysis={vendor:'Private Test Supplier',invoice:'TEST-PRIVATE-001'};
  writeFileSync(join(temp,'evidence',`${id}.json`),JSON.stringify({ngoId:'harbor-hands',analysis:seal(JSON.stringify({analysis,publicRecord}),verifier.key).toString('base64')}));
  const input={evidenceId:id,privacyReviewed:false,vendor:'Spoofed Vendor',invoice:'Spoofed Invoice',amountInr:999999,publicImage:'data:image/jpeg;base64,YQ==',verification:{status:'checks_passed'}};
  assert.equal((await post('/api/trust/ngos/harbor-hands/proofs',input)).status,400);
  assert.equal((await post('/api/trust/ngos/harbor-hands/advances',{amountInr:1000})).status,201);
  const response=await post('/api/trust/ngos/harbor-hands/proofs',{...input,privacyReviewed:true});
  assert.equal(response.status,201);
  const result=await response.json();
  assert.equal(result.proof.amountInr,1000);
  assert.equal(result.proof.publicImage,'');
  assert.equal(result.proof.verification.model,'test-model');
  assert.equal(JSON.stringify(result).includes('Private Test Supplier'),false);
  const repeated=await (await post('/api/trust/ngos/harbor-hands/proofs',{...input,privacyReviewed:true})).json();
  assert.equal(repeated.duplicate,true);
});
