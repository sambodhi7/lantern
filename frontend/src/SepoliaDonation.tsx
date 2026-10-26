import { useEffect,useState } from 'react';
import { connectSepolia,enableDonorReviews,testnetApi,type ChainConfig } from './wallet';
type Pending={action:'donate';txHash:string;wallet:string};
const key='lantern-donation-pending';
export default function SepoliaDonation({onReady,onDonation}:{onReady:(token:string)=>void;onDonation:()=>void}){
  const [config,setConfig]=useState<ChainConfig|null>(null),[amount,setAmount]=useState('0.001'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [confirmed,setConfirmed]=useState('');
  const [pending,setPending]=useState<Pending|null>(()=>{try{const saved=JSON.parse(localStorage.getItem(key)||'null');return saved?.action==='donate' && /^0x[\da-f]{64}$/i.test(saved.txHash)?saved:null;}catch{return null;}});
  useEffect(()=>{void testnetApi<ChainConfig>('config').then(setConfig).catch(error=>setMessage(error.message));},[]);
  async function verify(saved:Pending,wait=false){
    for(let i=0;i<(wait?35:1);i++){
      try{const state=await testnetApi<ChainConfig>('confirm',saved);setConfig(state);setConfirmed(saved.txHash);setPending(null);localStorage.removeItem(key);onDonation();setMessage('Donation confirmed in public escrow. You can now enable receipt reviews.');return;}
      catch(error){const text=error instanceof Error?error.message:'Could not verify donation.';if(!wait || !text.includes('pending') || i===34)throw error;await new Promise(resolve=>window.setTimeout(resolve,2500));}
    }
  }
  async function donate(){
    setBusy(true);try{
      const wallet=await connectSepolia();
      const prepared=await testnetApi<{chainId:number;transaction:Record<string,string>}>('prepare',{action:'donate',wallet,amount});
      if(prepared.chainId!==11155111)throw new Error('Only Sepolia test funds are supported here.');
      setMessage('Approve the test donation in MetaMask.');
      const txHash=await window.ethereum!.request({method:'eth_sendTransaction',params:[prepared.transaction]}) as string;
      const saved:Pending={action:'donate',wallet,txHash};setPending(saved);localStorage.setItem(key,JSON.stringify(saved));setMessage('Waiting for Sepolia confirmation…');await verify(saved,true);
    }catch(error){setMessage(error instanceof Error?error.message:'Wallet request was not completed.');}finally{setBusy(false);}
  }
  async function reviews(){setBusy(true);try{setMessage('Sign the free ownership message in MetaMask. No funds move.');const token=await enableDonorReviews();onReady(token);}catch(error){setMessage(error instanceof Error?error.message:'Wallet verification was not completed.');}finally{setBusy(false);}}
  return <section className="sepolia-checkout"><span className="section-eyebrow">PUBLIC BLOCKCHAIN DEMO</span><h3>Donate through Sepolia</h3><p>Free test tokens go directly to the campaign escrow. This is separate from INR donations.</p>
    {config?.campaignId?<><label>Test ETH amount<input type="number" min="0.000001" max="0.01" step="0.001" disabled={busy || !!pending} value={amount} onChange={e=>setAmount(e.target.value)}/></label><button className="dark-button wide" disabled={busy || !!pending} onClick={()=>void donate()}>Donate test funds with MetaMask</button><button className="quiet-button" disabled={busy} onClick={()=>void reviews()}>{confirmed?'Enable receipt reviews':'Already donated? Enable receipt reviews'}</button></>:<p>{config?'The testnet campaign needs to be created first.':'Loading campaign…'}</p>}
    {pending && <p>{<a href={`https://sepolia.etherscan.io/tx/${pending.txHash}`} target="_blank" rel="noreferrer">View pending donation ↗</a>} <button disabled={busy} onClick={()=>{setBusy(true);void verify(pending).catch(e=>setMessage(e.message)).finally(()=>setBusy(false));}}>Check confirmation</button></p>}
    {confirmed && <a href={`https://sepolia.etherscan.io/tx/${confirmed}`} target="_blank" rel="noreferrer">View confirmed donation ↗</a>}
    {message && <p role="status" className="checkout-status">{message}</p>}
  </section>;
}
