import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { network } from 'hardhat';
import { TestnetService } from './testnet.mjs';
import { TrustStore } from './trust.mjs';

test('wallet deployment, campaign creation and donation are independently checked against actual contract execution', {timeout:90000},async()=>{
  const connection=await network.create();
  const {provider,viem}=connection;
  const [owner,donor]=await viem.getWalletClients();
  const client=await viem.getPublicClient();
  const rpc=createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const call=JSON.parse(Buffer.concat(chunks));
      const result=await provider.request({method:call.method,params:call.params});
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,result}));
    }catch{res.writeHead(500);res.end('{}');}
  });
  await new Promise(resolve=>rpc.listen(0,'127.0.0.1',resolve));
  try{
    const service=new TestnetService({rpcUrl:`http://127.0.0.1:${rpc.address().port}`,chainId:await client.getChainId()});
    const trust=new TrustStore(null);
    const deploy=await service.prepare(trust,{action:'deploy',wallet:owner.account.address});
    const deployedTx=await owner.sendTransaction({account:owner.account,data:deploy.transaction.data});
    await client.waitForTransactionReceipt({hash:deployedTx,timeout:20000,pollingInterval:100});
    const deployed=await service.confirm(trust,{action:'deploy',wallet:owner.account.address,txHash:deployedTx});
    assert.match(deployed.contract,/^0x[0-9a-f]{40}$/);
    assert.equal(deployed.owner,owner.account.address.toLowerCase());
    await assert.rejects(service.prepare(trust,{action:'create',wallet:donor.account.address}),/deploy/);
    const create=await service.prepare(trust,{action:'create',wallet:owner.account.address});
    const campaignTx=await owner.sendTransaction({account:owner.account,to:create.transaction.to,data:create.transaction.data});
    await client.waitForTransactionReceipt({hash:campaignTx,timeout:20000,pollingInterval:100});
    const campaign=await service.confirm(trust,{action:'create',wallet:owner.account.address,txHash:campaignTx});
    assert.equal(campaign.campaignId,'1');
    const prepared=await service.prepare(trust,{action:'donate',wallet:donor.account.address,amount:'0.001'});
    const donationTx=await donor.sendTransaction({account:donor.account,to:prepared.transaction.to,data:prepared.transaction.data,value:BigInt(prepared.transaction.value)});
    await client.waitForTransactionReceipt({hash:donationTx,timeout:20000,pollingInterval:100});
    await assert.rejects(service.confirm(trust,{action:'donate',wallet:owner.account.address,txHash:donationTx}),/sender/);
    await service.confirm(trust,{action:'donate',wallet:donor.account.address,txHash:donationTx});
    await service.confirm(trust,{action:'donate',wallet:donor.account.address,txHash:donationTx});
    assert.equal(service.config(trust).donations.length,1);
    assert.equal(await client.getBalance({address:deployed.contract}),1000000000000000n);
    assert.equal(trust.get('harbor-hands').campaign.fundraising.raisedInr,1000000,'test tokens do not inflate INR raised');
    trust.reset();assert.equal(service.config(trust).contract,deployed.contract,'demo reset preserves the public deployment');
  }finally{await new Promise(resolve=>rpc.close(resolve));await connection.close();}
});
