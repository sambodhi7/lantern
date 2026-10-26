import { useEffect,useState } from 'react';
import { connectSepolia,enableDonorReviews,testnetApi,type ChainConfig } from './wallet';
import {selectedCampaign} from './trust';
type Pending={action:'donate'|'create';txHash:string;wallet:string};
export default function SepoliaDonation({onReady,onDonation}:{onReady:(token:string)=>void;onDonation:()=>void}){
  const key='lantern-donation-pending'+(selectedCampaign()?':'+selectedCampaign():'');
  const [config,setConfig]=useState<ChainConfig|null>(null),[amount,setAmount]=useState('0.001'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [confirmed,setConfirmed]=useState('');
  const [pending,setPending]=useState<Pending|null>(()=>{try{const saved=JSON.parse(localStorage.getItem(key)||'null');return ['donate','create'].includes(saved?.action) && /^0x[\da-f]{64}$/i.test(saved.txHash)?saved:null;}catch{return null;}});
  useEffect(()=>{void testnetApi<ChainConfig>('config').then(setConfig).catch(error=>setMessage(error.message));},[]);
  async function verify(saved:Pending,wait=false){
    for(let i=0;i<(wait?35:1);i++){
      try{const state=await testnetApi<ChainConfig>('confirm',saved);setConfig(state);if(saved.action==='donate')setConfirmed(saved.txHash);setPending(null);localStorage.removeItem(key);onDonation();setMessage(saved.action==='create'?'Campaign activated on Sepolia. You can now donate.':'Donation confirmed in public escrow. You can now enable receipt reviews.');return;}
      catch(error){const text=error instanceof Error?error.message:'Could not verify donation.';if(text.includes('Transaction failed on-chain')){setPending(null);localStorage.removeItem(key);}if(!wait || !text.includes('pending') || i===34)throw error;await new Promise(resolve=>window.setTimeout(resolve,2500));}
    }
  }
  async function donate(action:'donate'|'create'='donate'){
    setBusy(true);try{
      const wallet=await connectSepolia();
      const prepared=await testnetApi<{chainId:number;transaction:Record<string,string>}>('prepare',{action,wallet,amount});
      if(prepared.chainId!==11155111)throw new Error('Only Sepolia test funds are supported here.');
      setMessage(action==='create'?'Approve campaign activation in MetaMask.':'Approve the test donation in MetaMask.');
      const txHash=await window.ethereum!.request({method:'eth_sendTransaction',params:[prepared.transaction]}) as string;
      const saved:Pending={action,wallet,txHash};setPending(saved);localStorage.setItem(key,JSON.stringify(saved));setMessage('Waiting for Sepolia confirmation…');await verify(saved,true);
    }catch(error){setMessage(error instanceof Error?error.message:'Wallet request was not completed.');}finally{setBusy(false);}
  }
  async function reviews(){setBusy(true);try{setMessage('Sign the free ownership message in MetaMask. No funds move.');const token=await enableDonorReviews();onReady(token);}catch(error){setMessage(error instanceof Error?error.message:'Wallet verification was not completed.');}finally{setBusy(false);}}
  return <section className="sepolia-checkout"><span className="section-eyebrow">ETHEREUM SEPOLIA</span><h3>{config?.campaignId?'Donate through MetaMask':'Activate campaign escrow'}</h3><p>Donations transfer test ETH directly to this campaign in the deployed smart contract. Every confirmed transfer has a public transaction link.</p>
    {config?.campaignId?<><label>Test ETH amount<input type="number" min="0.000001" max="0.01" step="0.001" disabled={busy || !!pending} value={amount} onChange={e=>setAmount(e.target.value)}/></label><button className="dark-button wide" disabled={busy || !!pending} onClick={()=>void donate()}>Donate test funds with MetaMask</button><button className="quiet-button" disabled={busy} onClick={()=>void reviews()}>{confirmed?'Enable receipt reviews':'Already donated? Enable receipt reviews'}</button></>:config?.contract?<><p>This funding request needs its own on-chain campaign before receiving ETH. Activate it once, then donate into its separate escrow balance.</p><button className="dark-button wide" disabled={busy||!!pending} onClick={()=>void donate('create')}>Activate this campaign on Sepolia</button></>:<p>{config?'Deploy the escrow contract from the Blockchain page first.':'Loading campaign…'}</p>}
    {pending && <p>{<a href={`https://sepolia.etherscan.io/tx/${pending.txHash}`} target="_blank" rel="noreferrer">View pending donation ↗</a>} <button disabled={busy} onClick={()=>{setBusy(true);void verify(pending).catch(e=>setMessage(e.message)).finally(()=>setBusy(false));}}>Check confirmation</button></p>}
    {confirmed && <a href={`https://sepolia.etherscan.io/tx/${confirmed}`} target="_blank" rel="noreferrer">View confirmed donation ↗</a>}
    {message && <p role="status" className="checkout-status">{message}</p>}
  </section>;
}
