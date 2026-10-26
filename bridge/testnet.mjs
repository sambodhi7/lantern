import { readFileSync } from 'node:fs';
import { encodeDeployData, encodeFunctionData, decodeEventLog, decodeFunctionResult, parseEther, formatEther, stringToHex, verifyMessage,keccak256 } from 'viem';
import { randomUUID } from 'node:crypto';
import { assertDonationEvent } from './chain.mjs';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const walletPattern=/^0x[0-9a-fA-F]{40}$/;
const hashPattern=/^0x[0-9a-fA-F]{64}$/;
const purpose=stringToHex('WATER',{size:32});

export class TestnetService {
  constructor({rpcUrl=process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',chainId=11155111,fetcher=fetch}={}) {
    this.rpcUrl=rpcUrl;this.chainId=chainId;this.fetcher=fetcher;
    this.artifact=JSON.parse(readFileSync(new URL('../artifacts/contracts/LanternLedger.sol/LanternLedger.json',import.meta.url),'utf8'));
  }
  async rpc(method,params=[]) {
    const response=await this.fetcher(this.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});
    if(!response.ok)fail(503,'Sepolia RPC is unavailable. Your pending transaction is saved; retry verification shortly.');
    const data=await response.json();if(data.error)fail(502,'Sepolia could not verify the transaction. Retry shortly.');return data.result;
  }
  state(trust,localCampaignId){
    const ngo=trust.ngo('harbor-hands'),campaign=trust.campaign(ngo,localCampaignId);
    return campaign.id===ngo.campaigns[0].id?trust.data.testnet:campaign.testnet || (trust.data.testnet?{contract:trust.data.testnet.contract,owner:trust.data.testnet.owner,deploymentTx:trust.data.testnet.deploymentTx,campaignId:null,donations:[]}:null);
  }
  purpose(trust,id){const category=trust.campaign(trust.ngo('harbor-hands'),id).category;return category==='Water infrastructure'?purpose:keccak256(stringToHex(category));}
  config(trust,localCampaignId) {
    return {chainId:this.chainId,chainName:'Ethereum Sepolia',explorer:'https://sepolia.etherscan.io',testnet:true,...(this.state(trust,localCampaignId) || {contract:null,campaignId:null,donations:[]})};
  }
  async voterChallenge(trust,input) {
    const current=this.state(trust,input.localCampaignId);
    if(!current?.campaignId || !walletPattern.test(input.wallet || ''))fail(400,'Connect a wallet and create a campaign first.');
    const wallet=input.wallet.toLowerCase();
    const chain=await this.rpc('eth_chainId');if(Number(BigInt(chain))!==this.chainId)fail(502,'The backend RPC is on the wrong network.');
    const data=encodeFunctionData({abi:this.artifact.abi,functionName:'contributions',args:[BigInt(current.campaignId),wallet]});
    const contribution=decodeFunctionResult({abi:this.artifact.abi,functionName:'contributions',data:await this.rpc('eth_call',[{to:current.contract,data},'latest'])});
    if(contribution<=0n)fail(403,'This wallet has not donated to the campaign. Make a test donation first.');
    const id=randomUUID(),expiresAt=Date.now()+300000;
    const message=`LANTERN donor review access\nSite: http://127.0.0.1:5173\nNetwork: ${this.chainId}\nContract: ${current.contract}\nCampaign: ${current.campaignId}\nWallet: ${wallet}\nNonce: ${id}\nExpires: ${new Date(expiresAt).toISOString()}\nThis signature grants receipt voting access. It does not transfer funds.`;
    trust.data.voterChallenges ||= {};
    for(const [key,value] of Object.entries(trust.data.voterChallenges))if(value.expiresAt<Date.now())delete trust.data.voterChallenges[key];
    if(Object.keys(trust.data.voterChallenges).length>=100)fail(429,'Too many pending wallet checks. Retry after a few minutes.');
    trust.data.voterChallenges[id]={wallet,message,expiresAt,localCampaignId:trust.campaign(trust.ngo('harbor-hands'),input.localCampaignId).id};trust.save();return {id,message,expiresAt};
  }
  async voterSession(trust,input) {
    const challenge=trust.data.voterChallenges?.[input.id];
    if(!challenge || challenge.expiresAt<Date.now())fail(401,'This wallet challenge expired. Connect again.');
    let valid=false;try{valid=await verifyMessage({address:challenge.wallet,message:challenge.message,signature:input.signature});}catch{}
    if(!valid)fail(401,'Wallet signature does not match the donor address.');
    delete trust.data.voterChallenges[input.id];
    return trust.walletDonor(challenge.wallet,this.chainId,challenge.localCampaignId);
  }
  async prepare(trust,input) {
    if(!walletPattern.test(input.wallet || ''))fail(400,'Connect a valid Ethereum wallet first.');
    const wallet=input.wallet.toLowerCase(), current=this.state(trust,input.localCampaignId);
    const transaction={from:wallet,value:'0x0',chainId:`0x${this.chainId.toString(16)}`};
    if(input.action==='deploy') {
      if(current?.contract)fail(409,'A contract is already deployed. Continue by creating or funding its campaign.');
      return {action:'deploy',chainId:this.chainId,transaction:{...transaction,data:encodeDeployData({abi:this.artifact.abi,bytecode:this.artifact.bytecode,args:[wallet]})}};
    }
    if(!current?.contract)fail(400,'Deploy the contract first.');
    if(input.action==='create') {
      if(!input.localCampaignId && wallet!==current.owner)fail(400,'Connect the wallet that deployed this contract.');
      if(current.campaignId)fail(409,'The campaign already exists.');
      return {action:'create',chainId:this.chainId,transaction:{...transaction,to:current.contract,data:encodeFunctionData({abi:this.artifact.abi,functionName:'createCampaign',args:[this.purpose(trust,input.localCampaignId)]})}};
    }
    if(input.action==='donate') {
      if(!current.campaignId)fail(400,'Create the campaign first.');
      const amount=String(input.amount || '');
      if(!/^0\.[0-9]{1,6}$/.test(amount))fail(400,'Use a test donation between 0.000001 and 0.01 test ETH.');
      const wei=parseEther(amount);if(wei<1000000000000n || wei>10000000000000000n)fail(400,'Use a test donation between 0.000001 and 0.01 test ETH.');
      return {action:'donate',chainId:this.chainId,transaction:{...transaction,to:current.contract,value:`0x${wei.toString(16)}`,data:encodeFunctionData({abi:this.artifact.abi,functionName:'donate',args:[BigInt(current.campaignId)]})}};
    }
    fail(400,'Unknown blockchain action.');
  }
  async confirm(trust,input) {
    if(!hashPattern.test(input.txHash || '') || !walletPattern.test(input.wallet || ''))fail(400,'Invalid transaction reference or wallet.');
    const txHash=input.txHash.toLowerCase(), wallet=input.wallet.toLowerCase();
    const current=this.state(trust,input.localCampaignId);
    if(current && ((input.action==='deploy' && current.deploymentTx===txHash) || (input.action==='create' && current.campaignTx===txHash) || (input.action==='donate' && current.donations?.some(item=>item.transaction===txHash))))return this.config(trust,input.localCampaignId);
    const [chain,tx,receipt]=await Promise.all([this.rpc('eth_chainId'),this.rpc('eth_getTransactionByHash',[txHash]),this.rpc('eth_getTransactionReceipt',[txHash])]);
    if(Number(BigInt(chain))!==this.chainId)fail(502,'The backend RPC is on the wrong network.');
    if(!tx || !receipt || !receipt.blockNumber)fail(409,'Transaction is pending. Retry verification once it confirms.');
    if(receipt.status!=='0x1')fail(422,'Transaction failed on-chain. Funds were not recorded.');
    if(String(tx.from).toLowerCase()!==wallet)fail(400,'Transaction sender does not match the connected wallet.');
    if(input.action==='deploy') {
      const prepared=await this.prepare(trust,{...input,action:'deploy',wallet});
      if(tx.to || String(tx.input).toLowerCase()!==prepared.transaction.data.toLowerCase() || !walletPattern.test(receipt.contractAddress || ''))fail(400,'This transaction did not deploy the LANTERN contract with your wallet as owner.');
      const code=await this.rpc('eth_getCode',[receipt.contractAddress,'latest']);
      if(!code || code==='0x')fail(400,'No deployed contract code was found.');
      trust.data.testnet={contract:receipt.contractAddress.toLowerCase(),owner:wallet,deploymentTx:txHash,campaignId:null,donations:[]};
    } else if(input.action==='create') {
      const prepared=await this.prepare(trust,{...input,action:'create',wallet});
      const bindings=[trust.data.testnet,...trust.data.ngos.flatMap(ngo=>ngo.campaigns.map(campaign=>campaign.testnet))].filter(Boolean);
      if(bindings.some(binding=>binding.campaignTx===txHash))fail(409,'This creation transaction already belongs to another campaign.');
      if(String(tx.to).toLowerCase()!==current.contract || String(tx.input).toLowerCase()!==prepared.transaction.data.toLowerCase())fail(400,'Transaction did not create the expected water campaign.');
      const event=this.event(receipt,current.contract,'CampaignCreated');
      if(!event || event.args.ngo.toLowerCase()!==wallet || event.args.purpose!==this.purpose(trust,input.localCampaignId))fail(400,'The matching campaign event was not found.');
      current.campaignId=event.args.campaignId.toString();current.campaignTx=txHash;current.ngoWallet=wallet;
      const ngo=trust.ngo('harbor-hands'),local=trust.campaign(ngo,input.localCampaignId);
      if(local.id!==ngo.campaigns[0].id)local.testnet=current;
    } else if(input.action==='donate') {
      if(!current?.campaignId || String(tx.to).toLowerCase()!==current.contract)fail(400,'Donation did not reach the campaign contract.');
      const data=encodeFunctionData({abi:this.artifact.abi,functionName:'donate',args:[BigInt(current.campaignId)]});
      if(String(tx.input).toLowerCase()!==data.toLowerCase() || BigInt(tx.value)<=0n)fail(400,'Transaction was not a donation to this campaign.');
      assertDonationEvent(receipt,{ledger:current.contract,wallet,campaignId:current.campaignId,amountWei:tx.value});
      current.donations.unshift({transaction:txHash,from:wallet,amountWei:BigInt(tx.value).toString(),testEth:formatEther(BigInt(tx.value)),createdAt:new Date().toISOString()});
      const campaign=trust.campaign(trust.ngo('harbor-hands'),input.localCampaignId);
      campaign.events.unshift({id:txHash,type:'chain_donation',title:'Sepolia test donation confirmed',detail:'Test funds received by the public campaign escrow. No INR payment was made.',testEth:formatEther(BigInt(tx.value)),transaction:txHash,createdAt:new Date().toISOString(),demo:false});
    } else fail(400,'Unknown blockchain action.');
    trust.save();return this.config(trust,input.localCampaignId);
  }
  event(receipt,address,name) {
    for(const log of receipt.logs || []) {
      if(log.removed || String(log.address).toLowerCase()!==address)continue;
      try {const event=decodeEventLog({abi:this.artifact.abi,data:log.data,topics:log.topics});if(event.eventName===name)return event;}catch{}
    }
  }
}
