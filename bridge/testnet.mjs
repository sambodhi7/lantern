import { readFileSync } from 'node:fs';
import { encodeDeployData, encodeFunctionData, decodeEventLog, parseEther, formatEther, stringToHex } from 'viem';
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
  config(trust) {
    return {chainId:this.chainId,chainName:'Ethereum Sepolia',explorer:'https://sepolia.etherscan.io',testnet:true,...(trust.data.testnet || {contract:null,campaignId:null,donations:[]})};
  }
  async prepare(trust,input) {
    if(!walletPattern.test(input.wallet || ''))fail(400,'Connect a valid Ethereum wallet first.');
    const wallet=input.wallet.toLowerCase(), current=trust.data.testnet;
    const transaction={from:wallet,value:'0x0',chainId:`0x${this.chainId.toString(16)}`};
    if(input.action==='deploy') {
      if(current?.contract)fail(409,'A contract is already deployed. Continue by creating or funding its campaign.');
      return {action:'deploy',chainId:this.chainId,transaction:{...transaction,data:encodeDeployData({abi:this.artifact.abi,bytecode:this.artifact.bytecode,args:[wallet]})}};
    }
    if(!current?.contract)fail(400,'Deploy the contract first.');
    if(input.action==='create') {
      if(wallet!==current.owner)fail(400,'Connect the wallet that deployed this contract.');
      if(current.campaignId)fail(409,'The campaign already exists.');
      return {action:'create',chainId:this.chainId,transaction:{...transaction,to:current.contract,data:encodeFunctionData({abi:this.artifact.abi,functionName:'createCampaign',args:[purpose]})}};
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
    const current=trust.data.testnet;
    if(current && (current.deploymentTx===txHash || current.campaignTx===txHash || current.donations?.some(item=>item.transaction===txHash)))return this.config(trust);
    const [chain,tx,receipt]=await Promise.all([this.rpc('eth_chainId'),this.rpc('eth_getTransactionByHash',[txHash]),this.rpc('eth_getTransactionReceipt',[txHash])]);
    if(Number(BigInt(chain))!==this.chainId)fail(502,'The backend RPC is on the wrong network.');
    if(!tx || !receipt || !receipt.blockNumber)fail(409,'Transaction is pending. Retry verification once it confirms.');
    if(receipt.status!=='0x1')fail(422,'Transaction failed on-chain. Funds were not recorded.');
    if(String(tx.from).toLowerCase()!==wallet)fail(400,'Transaction sender does not match the connected wallet.');
    if(input.action==='deploy') {
      const prepared=await this.prepare(trust,{action:'deploy',wallet});
      if(tx.to || String(tx.input).toLowerCase()!==prepared.transaction.data.toLowerCase() || !walletPattern.test(receipt.contractAddress || ''))fail(400,'This transaction did not deploy the LANTERN contract with your wallet as owner.');
      const code=await this.rpc('eth_getCode',[receipt.contractAddress,'latest']);
      if(!code || code==='0x')fail(400,'No deployed contract code was found.');
      trust.data.testnet={contract:receipt.contractAddress.toLowerCase(),owner:wallet,deploymentTx:txHash,campaignId:null,donations:[]};
    } else if(input.action==='create') {
      const prepared=await this.prepare(trust,{action:'create',wallet});
      if(String(tx.to).toLowerCase()!==current.contract || String(tx.input).toLowerCase()!==prepared.transaction.data.toLowerCase())fail(400,'Transaction did not create the expected water campaign.');
      const event=this.event(receipt,current.contract,'CampaignCreated');
      if(!event || event.args.ngo.toLowerCase()!==wallet || event.args.purpose!==purpose)fail(400,'The matching campaign event was not found.');
      current.campaignId=event.args.campaignId.toString();current.campaignTx=txHash;
    } else if(input.action==='donate') {
      if(!current?.campaignId || String(tx.to).toLowerCase()!==current.contract)fail(400,'Donation did not reach the campaign contract.');
      const data=encodeFunctionData({abi:this.artifact.abi,functionName:'donate',args:[BigInt(current.campaignId)]});
      if(String(tx.input).toLowerCase()!==data.toLowerCase() || BigInt(tx.value)<=0n)fail(400,'Transaction was not a donation to this campaign.');
      assertDonationEvent(receipt,{ledger:current.contract,wallet,campaignId:current.campaignId,amountWei:tx.value});
      current.donations.unshift({transaction:txHash,from:wallet,amountWei:BigInt(tx.value).toString(),testEth:formatEther(BigInt(tx.value)),createdAt:new Date().toISOString()});
    } else fail(400,'Unknown blockchain action.');
    trust.save();return this.config(trust);
  }
  event(receipt,address,name) {
    for(const log of receipt.logs || []) {
      if(log.removed || String(log.address).toLowerCase()!==address)continue;
      try {const event=decodeEventLog({abi:this.artifact.abi,data:log.data,topics:log.topics});if(event.eventName===name)return event;}catch{}
    }
  }
}
