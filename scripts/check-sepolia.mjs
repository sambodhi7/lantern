const url=process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
for(const [method,params] of [['eth_chainId',[]],['eth_getBalance',['0xBd1af74A2735F4a4C3f634d017a51832094b1C83','latest']]]){
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});
  const body=await response.json();if(!response.ok || body.error)throw new Error('Sepolia RPC request failed.');
  console.log(JSON.stringify({method,result:body.result}));
}
