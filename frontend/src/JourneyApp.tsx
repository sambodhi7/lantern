import { useEffect,useState } from 'react';
import { ArrowRight,Check,ChevronRight,Copy,ImagePlus,RotateCcw,X } from 'lucide-react';
import { fetchTrust,requestFunding,resetTrust,voteProof,listCampaigns,type CampaignSummary,type TrustNgo,type TrustProof,type TrustEvent } from './trust';
import { formatInr } from './inr';
import { donorTokenKey,enableDonorReviews } from './wallet';
import ReceiptVerifier,{VerificationNote} from './ReceiptVerifier';
import BlockchainPanel from './BlockchainPanel';
import SepoliaDonation from './SepoliaDonation';
import CampaignCreator,{openCampaign} from './CampaignCreator';
import CampaignHome from './CampaignHome';

type View='home'|'donor'|'ngo'|'blockchain';
const short=(value:string)=>`${value.slice(0,16)}…${value.slice(-5)}`;
const date=(value:string)=>new Date(value).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
const viewFromUrl=():View=>window.location.hash==='#blockchain'?'blockchain':window.location.hash==='#ngo'?'ngo':new URLSearchParams(window.location.search).has('campaign')?'donor':'home';
const errorText=(error:unknown)=>error instanceof Error?error.message:'The request could not be completed.';

export default function JourneyApp(){
  const [view,setView]=useState<View>(viewFromUrl),[ngo,setNgo]=useState<TrustNgo|null>(null);
  const [donorToken,setDonorToken]=useState(()=>localStorage.getItem(donorTokenKey)||'');
  const [checkout,setCheckout]=useState(false);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [requestName,setRequestName]=useState(''),[requestStory,setRequestStory]=useState(''),[requestTarget,setRequestTarget]=useState('1500000');
  const [photo,setPhoto]=useState<{src:string;title:string}|null>(null);
  const [campaigns,setCampaigns]=useState<CampaignSummary[]>([]);
  const [campaignsLoading,setCampaignsLoading]=useState(true),[campaignsError,setCampaignsError]=useState('');
  async function refreshCampaigns(){try{setCampaigns(await listCampaigns());setCampaignsError('');}catch{setCampaignsError('Could not load campaigns. Check that the local backend is running.');}finally{setCampaignsLoading(false);}}
  async function refresh(token=localStorage.getItem(donorTokenKey)||''){const state=await fetchTrust(token);setNgo(state);return state;}
  function navigate(next:View,section?:string){setView(next);const search=next==='home'?'':window.location.search||(next==='donor'?`?campaign=${encodeURIComponent(ngo?.campaign.id||'water-infrastructure')}`:'');window.history.replaceState(null,'',`${window.location.pathname}${search}${next==='donor'||next==='home'?'':`#${next}`}`);if(next==='home'){void refreshCampaigns();setNgo(null);void refresh().catch(()=>undefined);}window.setTimeout(()=>section?document.getElementById(section)?.scrollIntoView({behavior:'smooth'}):window.scrollTo({top:0,behavior:'smooth'}),0);}
  function openCheckout(){setCheckout(true);}
  function closeCheckout(){if(!busy)setCheckout(false);}
  useEffect(()=>{
    void refreshCampaigns();
    void refresh().catch(()=>setNotice('The local backend is unavailable. Start the app service and retry.'));
    const update=()=>{setDonorToken(localStorage.getItem(donorTokenKey)||'');void refresh().catch(()=>undefined);void refreshCampaigns();};
    const hash=()=>{setView(viewFromUrl());window.scrollTo({top:0});};
    window.addEventListener('hashchange',hash);window.addEventListener('focus',update);window.addEventListener('lantern-donor-changed',update);
    const timer=window.setInterval(update,15000);
    return()=>{window.clearInterval(timer);window.removeEventListener('hashchange',hash);window.removeEventListener('focus',update);window.removeEventListener('lantern-donor-changed',update);};
  },[]);
  useEffect(()=>{if(!ngo)return;setRequestName(ngo.campaign.name);setRequestStory(ngo.campaign.fundraising.story);setRequestTarget(String(ngo.campaign.fundraising.targetInr));},[ngo?.campaign.name,ngo?.campaign.fundraising.story,ngo?.campaign.fundraising.targetInr]);
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),7500);return()=>window.clearTimeout(timer);},[notice]);
  useEffect(()=>{if(!checkout&&!photo)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy){setPhoto(null);setCheckout(false);}};window.addEventListener('keydown',key);return()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',key);};},[checkout,photo,busy]);
  async function donorReady(token:string){
    setBusy(true);localStorage.setItem(donorTokenKey,token);setDonorToken(token);
    try{await refresh(token);setNotice('You can now review campaign receipts.');setCheckout(false);navigate('donor','proofs');}
    catch(error){setNotice(errorText(error));}finally{setBusy(false);}
  }
  async function vote(proof:TrustProof,support:boolean){
    if(busy)return;setBusy(true);
    try{
      let token=donorToken;
      const accounts=window.ethereum?await window.ethereum.request({method:'eth_accounts'}) as string[]:[];
      const walletChanged=!!accounts[0] && accounts[0].toLowerCase()!==ngo?.donor?.wallet?.toLowerCase();
      if(!token || ngo?.donor?.source!=='verified_testnet_donor' || walletChanged){setNotice('Verify your donor wallet with a free signature. No payment is requested.');token=await enableDonorReviews();setDonorToken(token);}
      let state:TrustNgo;
      try{state=await voteProof(proof.id,support,token);}catch(error){const status=(error as {status?:number}).status;if(status!==401 && status!==403)throw error;localStorage.removeItem(donorTokenKey);setDonorToken('');setNotice('Renew review access with a free wallet signature.');token=await enableDonorReviews();setDonorToken(token);state=await voteProof(proof.id,support,token);}
      setNgo(state);setNotice('Your review was counted. No payment was made.');
    }catch(error){const text=errorText(error);setNotice(/has not donated/i.test(text)?'This wallet has no confirmed donation to this campaign. Switch to the wallet you donated with; reviewing is free.':text);}finally{setBusy(false);}
  }
  async function saveRequest(){setBusy(true);try{setNgo(await requestFunding({name:requestName,story:requestStory,targetInr:Number(requestTarget)}));navigate('donor','campaign');setNotice('Funding request published.');}catch(error){setNotice(errorText(error));}finally{setBusy(false);}}
  async function reset(){setBusy(true);try{setNgo(await resetTrust());localStorage.removeItem(donorTokenKey);for(const key of Object.keys(localStorage))if(key.startsWith('lantern-evidence-draft'))localStorage.removeItem(key);setDonorToken('');setCheckout(false);window.history.replaceState(null,'',window.location.pathname);setCampaigns(await listCampaigns());navigate('donor');setNotice('Demo records reset. Public blockchain transactions are preserved.');}catch(error){setNotice(errorText(error));}finally{setBusy(false);}}
  async function copy(value:string){try{await navigator.clipboard.writeText(value);setNotice('Receipt fingerprint copied.');}catch{setNotice('Could not copy the fingerprint.');}}
  const fundraiser=ngo?.campaign.fundraising,target=fundraiser?.targetInr||1500000,chain=ngo?.blockchain;
  const trail:TrustEvent[]=[...(chain?.donations.map(item=>({id:item.transaction,type:'chain_donation',title:'Public test donation',detail:'Confirmed in Sepolia escrow. Test funds only.',testEth:item.testEth,transaction:item.transaction,createdAt:item.createdAt}))||[]),...(ngo?.events.filter(item=>item.type!=='chain_donation')||[])];
  trail.sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  return <div className="lantern-shell">
    <header className="lantern-header"><button className="lantern-logo" onClick={()=>navigate('home')}><span>L</span> LANTERN</button><div className="lantern-header-right"><span className="demo-label">Testnet pilot</span><button className="chain-shortcut" onClick={()=>navigate('blockchain')}>Blockchain ↗</button><button className="mode" onClick={()=>navigate(view==='ngo'?'donor':'ngo')}>{view==='ngo'?'View as donor':'For NGOs'} <ArrowRight size={15}/></button></div></header>
    <main className="lantern-main">
      {view!=='home'&&<><div className="campaign-switcher"><button className="quiet-button" onClick={()=>navigate('home')}>← All campaigns</button><label>Campaign <select aria-label="Choose campaign" disabled={busy||checkout} value={ngo?.campaign.id||''} onChange={event=>openCampaign(event.target.value)}>{!ngo&&<option value="">Loading campaigns…</option>}{campaigns.map(campaign=><option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label></div>
      <nav className="pipeline" aria-label="How Lantern works"><button onClick={()=>navigate('donor','campaign')}><b>01</b> Request</button><ChevronRight size={14}/><button onClick={()=>{navigate('donor','campaign');openCheckout();}}><b>02</b> Donate</button><ChevronRight size={14}/><button onClick={()=>navigate('donor','proofs')}><b>03</b> See proof</button><ChevronRight size={14}/><button onClick={()=>navigate('donor','proofs')}><b>04</b> Review</button><ChevronRight size={14}/><button onClick={()=>navigate('donor','reputation')}><b>05</b> Track trust</button></nav></>}
      {view==='home'?<CampaignHome campaigns={campaigns} loading={campaignsLoading} error={campaignsError} onRetry={()=>void refreshCampaigns()} onCreate={()=>navigate('ngo')}/>:view==='blockchain'?<BlockchainPanel/>:view==='ngo'?<section className="ngo-editor">
        <div className="section-heading"><div><span className="section-eyebrow">NGO DESK</span><h1>Ask. Spend. Show proof.</h1><p>Publish a request, then explain each declared local expense.</p></div><button className="quiet-button" onClick={()=>navigate('donor')}>View public page <ArrowRight size={15}/></button></div>
        <CampaignCreator/>
        {ngo&&!ngo.blockchain?.campaignId&&<SepoliaDonation onReady={token=>void donorReady(token)} onDonation={()=>void refresh()}/>}
        <div className="ngo-status"><span>Trust <strong>{ngo?.score??'—'}/100</strong></span><span>Available for declared expenses <strong>{formatInr(ngo?.allowanceLeftInr||0)}</strong></span><span>Awaiting approval <strong>{formatInr(ngo?.outstandingInr||0)}</strong></span></div>
        {ngo?.frozen&&<p className="hold-banner">Spending records are paused: {ngo.hold?.reason}. This backend hold does not freeze the Solidity contract.</p>}
        <details className="request-editor"><summary>Edit funding request</summary><div className="edit-panel"><label>Project name<input value={requestName} onChange={e=>setRequestName(e.target.value)}/></label><label>Fundraising goal in rupees<input type="number" value={requestTarget} onChange={e=>setRequestTarget(e.target.value)}/></label><label>Why this work matters<textarea rows={4} value={requestStory} onChange={e=>setRequestStory(e.target.value)}/></label><button className="dark-button" disabled={busy} onClick={()=>void saveRequest()}>Publish funding request <ArrowRight size={15}/></button></div></details>
        <ReceiptVerifier onPublished={state=>{setNgo(state);navigate('donor',state.frozen?'reputation':'proofs');setNotice(state.frozen?'Duplicate evidence detected. Further declared spending is paused.':'Redacted proof published for donor review.');}}/>
      </section>:<>
        <section className="campaign-request" id="campaign"><span className="section-eyebrow">FUNDING REQUEST / {ngo?.country.toUpperCase()||'LOADING'}</span><div className="campaign-grid"><div><p className="ngo-name">{ngo?.name||'Loading NGO…'}</p><h1>{ngo?.campaign.name||'Loading campaign…'}</h1><p className="campaign-story">{fundraiser?.story}</p><div className="campaign-tags"><span>{ngo?.campaign.category}</span><span>{ngo?.frozen?'Local spending paused':'Fundraising open'}</span></div></div><div className="funding-box"><span>Confirmed Sepolia escrow donations</span><strong>{chain?.testEthDonated||'0'} test ETH</strong><div className="funding-meta"><span>Project budget {formatInr(target)}</span><span>Test network</span></div><button disabled={!ngo} onClick={()=>openCheckout()}>Support this project <ArrowRight size={17}/></button><small>{chain?.campaignId?'Donations transfer test ETH into this campaign escrow.':'Activate this campaign on Sepolia to accept test ETH.'}</small></div></div>
          {chain?.campaignId&&<div className="public-chain-strip"><div><strong>{chain.testEthDonated} test ETH</strong><span>Public Sepolia donations · campaign #{chain.campaignId}</span></div><a href={`https://sepolia.etherscan.io/address/${chain.contract}`} target="_blank" rel="noreferrer">View escrow ↗</a><button onClick={()=>navigate('blockchain')}>Inspect blockchain</button></div>}
        </section>
        <section className="proof-section" id="proofs"><div className="section-heading"><div><span className="section-eyebrow">PROOF FROM THE FIELD</span><h2>What the NGO has shown</h2><p>Review the public evidence and whether the cost is reasonable.</p></div><span className="section-count">{ngo?.proofs.length||0} RECEIPTS</span></div>
          {ngo?.donor&&<p className="donor-access">Voting access: {ngo.donor.source==='demo'?'simulated donor':`verified Sepolia donor ${short(ngo.donor.wallet||'')}`}. One review per donor per receipt.</p>}
          {!ngo?.proofs.length&&<div className="empty-proof">No receipts yet. The NGO can upload its first receipt from “For NGOs”.</div>}
          <div className="proof-feed">{ngo?.proofs.map(proof=><article className="public-proof" key={proof.id}><div className="proof-photo">{proof.publicImage?<button className="proof-image-button" onClick={()=>setPhoto({src:proof.publicImage!,title:proof.title})} aria-label={`Open redacted image: ${proof.title}`}><img src={proof.publicImage} alt={`Redacted proof for ${proof.title}`} loading="lazy"/></button>:<div className="no-photo"><ImagePlus size={25}/><span>{proof.verification?.privacy==='image_withheld'?'Image withheld for privacy':'No public photo'}</span></div>}<span>{proof.demo?'Sample / demo proof':'Redacted NGO submission'}</span></div><div className="proof-detail"><div className="proof-line"><span className={`proof-state ${proof.status}`}>{proof.status==='approved'?'Community approved':proof.status==='flagged'?'Needs review':'Review open'}</span><span>{date(proof.createdAt)}</span></div><h3>{proof.title}</h3><p>{proof.summary}</p><VerificationNote proof={proof}/><div className="proof-amount"><span>Consistency grade {proof.grade}/100</span><strong>{formatInr(proof.amountInr)}</strong></div><div className="fingerprint"><span>Receipt fingerprint</span><code>{short(proof.commitment)}</code><button title="Copy fingerprint" onClick={()=>void copy(proof.commitment)}><Copy size={14}/></button></div><div className="review-progress"><span>{proof.yes} fair · {proof.no} questioned</span><span>{proof.final?'Review closed':`${Math.max(0,3-proof.yes-proof.no)} more reviews needed`}</span></div><div className="proof-vote">{proof.final?<small>{proof.status==='approved'?'This evidence contributes to NGO reputation.':'This receipt requires further scrutiny.'}</small>:proof.voted?<small>Your vote counted</small>:<div><button disabled={busy} onClick={()=>void vote(proof,true)}><Check size={14}/> Fair cost</button><button disabled={busy} onClick={()=>void vote(proof,false)}>Question cost</button></div>}</div>{!!proof.walletVotes&&<small className="vote-source">{proof.walletVotes} verified wallet reviews · {proof.demoVotes||0} demo reviews</small>}</div></article>)}</div>
          <p className="proof-footnote">Reviewing is free. Your first review may ask for a donor-wallet signature; no ETH is sent. Three reviews close a receipt. At least 70% must support it, and receipt checks must pass, to raise trust.</p>
        </section>
        <div className="accountability-grid"><section className="money-trail" id="trail"><div className="section-heading"><div><span className="section-eyebrow">MONEY TRAIL</span><h2>Where the money went</h2></div></div><div className="trail-rows">{trail.slice(0,10).map(event=><div className="trail-row" key={event.id}><span className="trail-date">{date(event.createdAt)}</span><div><strong>{event.title}</strong><p>{event.detail}</p>{event.transaction&&<a className="trail-link" href={`https://sepolia.etherscan.io/tx/${event.transaction}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</div><b>{event.testEth?`${event.testEth} test ETH`:event.amountInr?formatInr(event.amountInr):'—'}</b></div>)}</div><small>Sepolia transactions are public. Local expenses and INR demonstration entries are backend records.</small></section>
          <section className="trust-history" id="reputation"><div className="section-heading"><div><span className="section-eyebrow">NGO REPUTATION</span><h2>Trust history</h2></div></div><div className="trust-current"><strong>{ngo?.score??'—'}<small>/100</small></strong><span>{ngo?.frozen?'Declared spending paused':'Declared spending available'}</span></div><div className="reputation-counts"><span>{ngo?.reputation.approved||0} approved</span><span>{ngo?.reputation.open||0} open</span><span>{ngo?.reputation.flagged||0} flagged</span></div><div className="history-rows">{ngo?.scoreHistory.map(item=><div key={item.id}><span>{date(item.createdAt)}</span><strong>{item.reason}<small>Score after event: {item.score}</small></strong><b>{item.delta>0?'+':''}{item.delta||'—'}</b></div>)}</div><p className="trust-explainer">Available for new declared expenses: <strong>{formatInr(ngo?.allowanceLeftInr||0)}</strong>.</p><details className="score-rules"><summary>How the score works</summary><p>Positive review +4. Rejected review −6. Duplicate receipt −12 and a spending pause. Community approval clears that expense’s outstanding exposure.</p><p>Allowance = INR ledger budget × (5% + 0.15% × score), capped by the unspent budget. This governs backend records, not Solidity payouts.</p></details></section></div>
      </>}
    </main>
    {checkout&&<div className="checkout-backdrop" onClick={closeCheckout}><div className="checkout" role="dialog" aria-modal="true" aria-label="Donation checkout" onClick={e=>e.stopPropagation()}><button className="checkout-close" disabled={busy} onClick={closeCheckout} aria-label="Close"><X size={18}/></button><span className="section-eyebrow">SUPPORT THIS PROJECT</span><h2>Support the campaign</h2><SepoliaDonation onReady={token=>void donorReady(token)} onDonation={()=>{void refresh();}}/></div></div>}
    {photo&&<div className="checkout-backdrop" onClick={()=>setPhoto(null)}><div className="proof-lightbox" role="dialog" aria-modal="true" aria-label="Redacted proof image" onClick={e=>e.stopPropagation()}><button onClick={()=>setPhoto(null)} aria-label="Close photo"><X size={20}/></button><img src={photo.src} alt={photo.title}/><p>{photo.title} · public redacted copy</p></div></div>}
    {notice&&<div className="lantern-toast" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss"><X size={14}/></button></div>}
    <footer className="lantern-footer"><span>LANTERN / TESTNET PILOT</span><span>Public claims. Private people.</span><button disabled={busy} onClick={()=>void reset()}><RotateCcw size={13}/> Reset demo records</button></footer>
  </div>;
}
