import {campaignPath} from './trust';
export const donorTokenKey='lantern-wallet-donor-token';
export async function testnetApi<T>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(campaignPath('/api/testnet/'+path),{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store'});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error || 'Blockchain service unavailable.'),{status:response.status});
  return result;
}
export async function connectSepolia(){
  if(!window.ethereum)throw new Error('Open this page in Chrome with MetaMask to use your testnet wallet.');
  const accounts=await window.ethereum.request({method:'eth_requestAccounts'}) as string[];
  if(!accounts[0])throw new Error('Choose a wallet account.');
  let chain=await window.ethereum.request({method:'eth_chainId'}) as string;
  if(BigInt(chain)!==11155111n){await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xaa36a7'}]});chain=await window.ethereum.request({method:'eth_chainId'}) as string;}
  if(BigInt(chain)!==11155111n)throw new Error('Switch to Ethereum Sepolia.');
  return accounts[0];
}
export async function enableDonorReviews(){
  if(!window.ethereum)throw new Error('Reviewing is free. Open this campaign in Chrome with MetaMask and use the wallet that donated.');
  const accounts=await window.ethereum.request({method:'eth_requestAccounts'}) as string[];
  const wallet=accounts[0];if(!wallet)throw new Error('Choose the wallet that made the donation.');
  const challenge=await testnetApi<{id:string;message:string}>('voter/challenge',{wallet});
  const hex='0x'+Array.from(new TextEncoder().encode(challenge.message)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const signature=await window.ethereum!.request({method:'personal_sign',params:[hex,wallet]});
  const session=await testnetApi<{token:string;source:string}>('voter/session',{id:challenge.id,signature});
  localStorage.setItem(donorTokenKey,session.token);window.dispatchEvent(new Event('lantern-donor-changed'));
  return session.token;
}

export type ChainConfig={contract:string|null;campaignId:string|null;chainId:number;owner?:string;donations:{transaction:string;testEth:string;from:string;createdAt:string}[]};

