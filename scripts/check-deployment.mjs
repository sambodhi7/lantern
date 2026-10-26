// Read-only Sepolia preflight: never signs or submits a transaction.
const wallet=process.argv[2];
if(!/^0x[0-9a-f]{40}$/i.test(wallet || ''))throw new Error('Usage: node scripts/check-deployment.mjs 0xYOUR_PUBLIC_WALLET');
const response=await fetch('http://127.0.0.1:8787/api/testnet/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'deploy',wallet})});
const prepared=await response.json();if(!response.ok)throw new Error(prepared.error);
if(prepared.chainId!==11155111)throw new Error('Expected Sepolia.');
async function rpc(method,params){
  const res=await fetch(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});
  const body=await res.json();if(!res.ok || body.error)throw new Error(body.error?.message || 'RPC failed.');return body.result;
}
const [gas,balance,gasPrice]=await Promise.all([rpc('eth_estimateGas',[prepared.transaction]),rpc('eth_getBalance',[wallet,'latest']),rpc('eth_gasPrice',[])]);
const estimate=BigInt(gas)*BigInt(gasPrice);
console.log(JSON.stringify({network:'Ethereum Sepolia',wallet,gasEstimate:BigInt(gas).toString(),estimatedFeeWei:estimate.toString(),balanceWei:BigInt(balance).toString(),hasEnoughTestFunds:BigInt(balance)>estimate,transactionSubmitted:false},null,2));
