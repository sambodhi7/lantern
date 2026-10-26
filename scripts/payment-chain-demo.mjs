import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { network } from 'hardhat';
import { parseEther, stringToHex } from 'viem';

// Actual Solidity execution plus the actual HTTP bridge and PostgreSQL.
// Only the fiat provider callback is simulated; no real currency is collected.
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const directory=mkdtempSync(join(tmpdir(),'lantern-chain-'));
const databaseUrl=process.env.TEST_DATABASE_URL || 'postgresql://lantern@127.0.0.1:55432/lantern';
const admin=new pg.Pool({connectionString:databaseUrl});
const schema=`payment_${randomUUID().replaceAll('-','')}`;
let bridge, rpcServer, connection;
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  console.log('Starting isolated local blockchain and PostgreSQL payment demo.');
  connection=await network.create();
  const {viem,provider}=connection;
  const [owner,ngo,conversionProvider,receiver]=await viem.getWalletClients();
  const client=await viem.getPublicClient();
  const ledger=await viem.deployContract('LanternLedger',[owner.account.address]);
  console.log('Campaign contract deployed; connecting the HTTP bridge.');
  await ledger.write.createCampaign([stringToHex('WATER',{size:32})],{account:ngo.account});
  rpcServer=createServer(async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const call=JSON.parse(Buffer.concat(chunks));
      const result=await provider.request({method:call.method,params:call.params});
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,result}));
    }catch(error){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32000,message:error.message}}));}
  });
  await new Promise(resolve=>rpcServer.listen(0,'127.0.0.1',resolve));
  const scopedUrl=new URL(databaseUrl);scopedUrl.searchParams.set('options',`-c search_path=${schema}`);
  Object.assign(process.env,{
    NODE_ENV:'test',BRIDGE_DATA_DIR:directory,DATABASE_URL:scopedUrl.toString(),GEMINI_API_KEY:'',
    ONMETA_API_KEY:'simulated-provider-public-key',ONMETA_API_SECRET:'local-simulation-only',
    ONMETA_TREASURY_ADDRESS:receiver.account.address,ONMETA_CHAIN_ID:String(await client.getChainId()),ONMETA_TOKEN_SYMBOL:'ETH',
    LANTERN_CAMPAIGN_ID:'1',LANTERN_LEDGER_ADDRESS:ledger.address,LANTERN_RPC_URL:`http://127.0.0.1:${rpcServer.address().port}`,LANTERN_MIN_CONFIRMATIONS:'2',
  });
  ({server:bridge}=await import('../bridge/server.mjs'));
  await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${bridge.address().port}`;
  const post=async(path,body,signature)=>{
    const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(signature?{'x-onmeta-signature':signature}:{})},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  const initial=await(await fetch(base+'/api/trust/ngos/harbor-hands')).json();
  const intentResponse=await post('/api/onramp/intents',{amountInr:1000});assert.equal(intentResponse.status,201);
  const intent=intentResponse.body;
  const value=parseEther('0.002');
  const conversionTx=await conversionProvider.sendTransaction({account:conversionProvider.account,to:receiver.account.address,value});
  await client.waitForTransactionReceipt({hash:conversionTx,timeout:30_000,pollingInterval:100});
  const event={eventType:'onramp',status:'completed',orderId:randomUUID(),fiat:1000,currency:'INR',receiverWalletAddress:receiver.account.address,chainId:await client.getChainId(),buyTokenSymbol:'ETH',transferredAmountWei:String(value),txnHash:conversionTx,metaData:{donationIntentId:intent.id}};
  const signature=createHmac('sha256',process.env.ONMETA_API_SECRET).update(JSON.stringify(event)).digest('hex');
  const shallow=await post('/webhooks/onmeta',event,signature);assert.equal(shallow.status,422,'wait for the second confirmation');
  await provider.request({method:'evm_mine',params:[]});
  assert.equal((await post('/webhooks/onmeta',event,signature)).status,200);
  const beforeDeposit=await(await fetch(base+'/api/trust/ngos/harbor-hands')).json();
  assert.equal(beforeDeposit.campaign.fundraising.raisedInr,initial.campaign.fundraising.raisedInr,'conversion alone is not a protected donation');
  const depositTx=await ledger.write.donate([1n],{account:receiver.account,value});
  await client.waitForTransactionReceipt({hash:depositTx,timeout:30_000,pollingInterval:100});
  await provider.request({method:'evm_mine',params:[]});
  const settled=await post(`/api/onramp/intents/${intent.id}/escrow`,{txHash:depositTx});assert.equal(settled.status,200,settled.body.error);
  assert.equal(settled.body.status,'escrowed');
  assert.equal(await client.getBalance({address:ledger.address}),value);
  assert.equal((await post('/webhooks/onmeta',event,signature)).status,200);
  assert.equal((await post(`/api/onramp/intents/${intent.id}/escrow`,{txHash:depositTx})).status,200);
  const after=await(await fetch(base+'/api/trust/ngos/harbor-hands')).json();
  assert.equal(after.campaign.fundraising.raisedInr,initial.campaign.fundraising.raisedInr+1000);
  const stored=await admin.query(`SELECT status, escrow_tx FROM ${schema}.payment_intents WHERE id=$1`,[intent.id]);
  assert.equal(stored.rows[0].status,'escrowed');assert.equal(stored.rows[0].escrow_tx,depositTx);
  const proof={network:'Local Hardhat blockchain; simulated fiat provider',contract:ledger.address,campaignId:1,donationInr:1000,conversionTransaction:conversionTx,escrowTransaction:depositTx,actualContractBalanceWei:String(value),databaseStatus:stored.rows[0].status,confirmationDepthEnforced:true,contractDonationEventVerified:true,replayedWebhookDidNotDoubleCredit:true};
  mkdirSync(join(root,'bridge','.data'),{recursive:true});writeFileSync(join(root,'bridge','.data','payment-chain-demo.json'),JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof,null,2));
} finally {
  if(bridge)await new Promise(resolve=>bridge.close(resolve));
  if(rpcServer)await new Promise(resolve=>rpcServer.close(resolve));
  await connection?.close();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
  rmSync(directory,{recursive:true,force:true});
}
