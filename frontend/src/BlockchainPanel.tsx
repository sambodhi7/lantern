import { useEffect, useState } from 'react';
import { enableDonorReviews } from './wallet';

type Action='deploy'|'create'|'donate';
type Config={chainId:number;chainName:string;explorer:string;contract:string|null;owner?:string;campaignId:string|null;deploymentTx?:string;campaignTx?:string;donations:{transaction:string;testEth:string;from:string;createdAt:string}[]};
type Pending={action:Action;txHash:string;wallet:string};
const pendingKey='lantern-sepolia-pending';
async function api<T>(path:string,body?:unknown):Promise<T>{
  const response=await fetch('/api/testnet/'+path,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store'});
  const result=await response.json();if(!response.ok)throw new Error(result.error || 'The blockchain service is unavailable.');return result;
}

export default function BlockchainPanel(){
  const [config,setConfig]=useState<Config|null>(null);
  const [wallet,setWallet]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [testAmount,setTestAmount]=useState('0.001');
  const [pending,setPending]=useState<Pending|null>(()=>{
    try{
      const value=JSON.parse(localStorage.getItem(pendingKey)||'null');
      return value && ['deploy','create','donate'].includes(value.action) && /^0x[0-9a-f]{64}$/i.test(value.txHash) && /^0x[0-9a-f]{40}$/i.test(value.wallet) ? value : null;
    }catch{return null;}
  });
  useEffect(()=>{void api<Config>('config').then(setConfig).catch(error=>setMessage(error.message));},[]);
  async function connect(){
    if(!window.ethereum)throw new Error('Open http://127.0.0.1:5173/#blockchain in Chrome with the MetaMask extension installed.');
    const accounts=await window.ethereum.request({method:'eth_requestAccounts'}) as string[];
    const chain=await window.ethereum.request({method:'eth_chainId'}) as string;
    if(BigInt(chain)!==11155111n)await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xaa36a7'}]});
    const selected=await window.ethereum.request({method:'eth_chainId'}) as string;
    if(BigInt(selected)!==11155111n)throw new Error('Choose Ethereum Sepolia in MetaMask.');
    if(!accounts[0])throw new Error('No wallet account was selected.');setWallet(accounts[0]);return accounts[0];
  }
  async function connectClick(){setBusy(true);try{await connect();setMessage('Wallet connected on Ethereum Sepolia.');}catch(error){setMessage(error instanceof Error?error.message:'Could not connect.');}finally{setBusy(false);}}
  async function verify(saved:Pending,wait=false){
    const attempts=wait?30:1;
    for(let i=0;i<attempts;i++){
      try{
        const result=await api<Config>('confirm',saved);setConfig(result);setPending(null);localStorage.removeItem(pendingKey);
        setMessage(saved.action==='deploy'?'Contract deployed and independently verified. Next, create the campaign.':saved.action==='create'?'Water campaign created. You can now send a test donation.':'Test donation confirmed in campaign escrow. Open the transaction link to show the judges.');return;
      }catch(error){
        const text=error instanceof Error?error.message:'Verification failed.';
        if(text==='Transaction failed on-chain. Funds were not recorded.'){
          setPending(null);localStorage.removeItem(pendingKey);
        }
        if(!wait || !text.includes('pending') || i===attempts-1)throw new Error(text);
        await new Promise(resolve=>window.setTimeout(resolve,3000));
      }
    }
  }
  async function send(action:Action){
    setBusy(true);
    try{
      const account=await connect();
      const prepared=await api<{chainId:number;transaction:Record<string,string>}>('prepare',{action,wallet:account,amount:testAmount});
      if(prepared.chainId!==11155111)throw new Error('Only Sepolia test transactions are supported.');
      setMessage('Review and confirm the transaction in MetaMask. This uses Sepolia test funds.');
      const txHash=await window.ethereum!.request({method:'eth_sendTransaction',params:[prepared.transaction]}) as string;
      const saved={action,txHash,wallet:account};setPending(saved);localStorage.setItem(pendingKey,JSON.stringify(saved));
      setMessage('Transaction sent. Waiting for Sepolia confirmation…');await verify(saved,true);
    }catch(error){setMessage(error instanceof Error?error.message:'Transaction was not completed.');}
    finally{setBusy(false);}
  }
  async function retry(){if(!pending)return;setBusy(true);try{await verify(pending);}catch(error){setMessage(error instanceof Error?error.message:'Not confirmed yet.');}finally{setBusy(false);}}
  async function review(){setBusy(true);try{setMessage('Sign a free ownership message to enable receipt reviews.');await enableDonorReviews();window.location.hash='';}catch(error){setMessage(error instanceof Error?error.message:'Could not enable reviews.');}finally{setBusy(false);}}
  const ownerMatches=!wallet || !config?.owner || wallet.toLowerCase()===config.owner.toLowerCase();
  const link=(hash:string,label:string)=><a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">{label} ↗</a>;
  return <section className="blockchain-panel">
    <span className="section-eyebrow">ETHEREUM SEPOLIA / PUBLIC TESTNET</span>
    <h1>Put the promise on-chain.</h1><p className="blockchain-intro">Deploy the escrow, create a water campaign, then make a test donation. Each step is a real blockchain transaction approved by you in MetaMask. Sepolia tokens have no cash value.</p>
    <div className="blockchain-wallet"><span>{wallet?`Connected: ${wallet}`:'Open this page in Chrome with MetaMask installed.'}</span><button onClick={()=>void connectClick()} disabled={busy}>Connect MetaMask</button></div>
    <div className="blockchain-steps">
      <article><span className="edit-step">01 / DEPLOY ESCROW</span><h2>{config?.contract?'Contract is live':'Deploy LANTERN'}</h2><p>Your wallet will own the contract. Deployment uses test ETH for gas.</p><button className="dark-button" disabled={busy || !!pending || !config || !!config.contract} onClick={()=>void send('deploy')}>{config?.contract?'Deployed':'Deploy on Sepolia'}</button>{config?.deploymentTx && link(config.deploymentTx,'View deployment')}{config?.contract && <code>{config.contract}</code>}</article>
      <article><span className="edit-step">02 / CREATE CAMPAIGN</span><h2>{config?.campaignId?'Campaign is ready':'Create water campaign'}</h2><p>Bind the campaign to your wallet and its water infrastructure purpose.</p><button className="dark-button" disabled={busy || !!pending || !config?.contract || !!config.campaignId || !ownerMatches} onClick={()=>void send('create')}>{config?.campaignId?`Campaign #${config.campaignId}`:'Create campaign'}</button>{!ownerMatches && <small>Connect the deploying wallet for this step.</small>}{config?.campaignTx && link(config.campaignTx,'View campaign creation')}</article>
      <article><span className="edit-step">03 / TEST DONATION</span><h2>Fund campaign escrow</h2><p>Send a small test amount directly into the deployed contract.</p><label>Sepolia test ETH<input type="number" min="0.000001" max="0.01" step="0.001" value={testAmount} onChange={e=>setTestAmount(e.target.value)}/></label><button className="dark-button" disabled={busy || !!pending || !config?.campaignId} onClick={()=>void send('donate')}>Donate test funds</button></article>
    </div>
    {pending && <div className="blockchain-pending"><span>Pending {pending.action}: {link(pending.txHash,'View transaction')}</span><button disabled={busy} onClick={()=>void retry()}>Check confirmation</button><small>Your transaction reference is saved if you refresh. Avoid sending it again.</small></div>}
    {message && <p className="verification-message" role="status">{message}</p>}
    {!!config?.donations.length && <section className="blockchain-transactions"><h2>Public donation trail</h2>{config.donations.map(item=><div key={item.transaction}><strong>{item.testEth} test ETH</strong><span>{new Date(item.createdAt).toLocaleString('en-IN')}</span>{link(item.transaction,'Confirmed in escrow')}</div>)}</section>}
    {config?.campaignId&&<button className="dark-button" disabled={busy} onClick={()=>void review()}>Use my donor wallet to review receipts</button>}
    <p className="blockchain-footnote">This testnet flow works without the INR payment provider. Test transactions are kept separate from the rupee fundraising figures.</p>
  </section>;
}
