import { readFileSync } from 'node:fs';
import { encodeFunctionData, decodeFunctionResult, stringToHex, formatEther } from 'viem';
import { assertDonationEvent } from '../bridge/chain.mjs';
// Read-only verification of the deployment recorded by the local backend.
const response=await fetch('http://127.0.0.1:8787/api/testnet/config');
const config=await response.json();
if(!response.ok || !config.contract)throw new Error('No confirmed testnet deployment is recorded yet.');
const rpcUrl=process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
async function rpc(method,params=[]){
  const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok || result.error)throw new Error('Sepolia RPC verification failed.');return result.result;
}
const [chain,receipt,code,owner,latest]=await Promise.all([
  rpc('eth_chainId'),rpc('eth_getTransactionReceipt',[config.deploymentTx]),rpc('eth_getCode',[config.contract,'latest']),rpc('eth_call',[{to:config.contract,data:'0x8da5cb5b'},'latest']),rpc('eth_blockNumber'),
]);
if(Number(BigInt(chain))!==11155111 || receipt?.status!=='0x1' || !code || code==='0x' || `0x${owner.slice(-40)}`.toLowerCase()!==config.owner.toLowerCase())throw new Error('Deployment checks did not match the recorded contract and owner.');
let campaignVerified=false;
let campaignEscrowWei=null, contractBalanceWei=null;
if(config.campaignId){
  const {abi}=JSON.parse(readFileSync(new URL('../artifacts/contracts/LanternLedger.sol/LanternLedger.json',import.meta.url),'utf8'));
  const data=encodeFunctionData({abi,functionName:'campaigns',args:[BigInt(config.campaignId)]});
  const raw=await rpc('eth_call',[{to:config.contract,data},'latest']);
  const campaign=decodeFunctionResult({abi,functionName:'campaigns',data:raw});
  const created=await rpc('eth_getTransactionReceipt',[config.campaignTx]);
  if(campaign[0].toLowerCase()!==config.owner.toLowerCase() || campaign[1]!==stringToHex('WATER',{size:32}) || campaign[8]!==true || created?.status!=='0x1')throw new Error('Campaign owner, purpose or creation receipt did not match.');
  campaignVerified=true;
  campaignEscrowWei=campaign[3].toString();
  contractBalanceWei=BigInt(await rpc('eth_getBalance',[config.contract,'latest'])).toString();
  for(const donation of config.donations || []){
    const receipt=await rpc('eth_getTransactionReceipt',[donation.transaction]);
    if(receipt?.status!=='0x1')throw new Error('A recorded donation did not have a successful receipt.');
    assertDonationEvent(receipt,{ledger:config.contract,wallet:donation.from,campaignId:config.campaignId,amountWei:donation.amountWei});
  }
  const recorded=(config.donations || []).reduce((sum,item)=>sum+BigInt(item.amountWei),0n);
  if(BigInt(campaignEscrowWei)<recorded || BigInt(contractBalanceWei)<BigInt(campaignEscrowWei))throw new Error('Escrow balance does not cover the recorded donations.');
}
console.log(JSON.stringify({network:'Ethereum Sepolia',contract:config.contract,deploymentTransaction:config.deploymentTx,owner:config.owner,codePresent:true,ownerVerified:true,confirmations:Number(BigInt(latest)-BigInt(receipt.blockNumber)+1n),campaignId:config.campaignId,campaignVerified,verifiedDonations:config.donations?.length || 0,campaignEscrowWei,contractBalanceWei,campaignEscrowTestEth:campaignEscrowWei===null?null:formatEther(BigInt(campaignEscrowWei))},null,2));
