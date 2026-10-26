import {ArrowRight} from 'lucide-react';
import {type CampaignSummary} from './trust';
import {formatInr} from './inr';
import {openCampaign} from './CampaignCreator';

export default function CampaignHome({campaigns,loading,error,onRetry,onCreate}:{campaigns:CampaignSummary[];loading:boolean;error:string;onRetry:()=>void;onCreate:()=>void}){
  const active=campaigns.filter(campaign=>campaign.status==='open');
  return <section className="campaign-directory">
    <div className="directory-heading"><div><span className="section-eyebrow">LANTERN / CROWDFUNDING</span><h1>Active campaigns</h1><p>Choose a project to see its funding, spending and proof.</p></div><button className="quiet-button" onClick={onCreate}>Start a campaign <ArrowRight size={16}/></button></div>
    <div className="directory-caption"><h2>Open funding requests</h2><span>{loading?'Loading…':`${active.length} open ${active.length===1?'request':'requests'}`}</span></div>
    {error?<div className="empty-proof" role="alert"><p>{error}</p><button className="quiet-button" onClick={onRetry}>Try again</button></div>:loading?<p role="status">Loading active campaigns…</p>:active.length===0?<div className="empty-proof">No active campaigns yet. Start the first funding request.</div>:<div className="campaign-directory-grid">{active.map((campaign,index)=>{
      return <article className="directory-card" key={campaign.id}>
        <div className="directory-card-top"><span>{String(index+1).padStart(2,'0')} / {campaign.category}</span><span>{campaign.country}</span></div>
        <p className="directory-ngo">{campaign.ngoName}</p><h3><a href={`?campaign=${encodeURIComponent(campaign.id)}`}>{campaign.name}</a></h3><p className="directory-story">{campaign.story}</p>
        <div className="directory-funding"><strong>{campaign.blockchain?.testEthDonated||'0'} test ETH</strong><span>Budget {formatInr(campaign.targetInr)}</span></div><p className="directory-records">{campaign.blockchain?.campaignId?`Sepolia campaign #${campaign.blockchain.campaignId}`:'Awaiting on-chain activation'}</p>
        <p className="directory-records">Trust {campaign.score}/100 <span>·</span> {campaign.proofCount} {campaign.proofCount===1?'receipt':'receipts'} published</p>
        <button className="directory-open" onClick={()=>{window.history.replaceState(null,'',window.location.pathname);openCampaign(campaign.id);}}>View campaign <ArrowRight size={17}/></button>
      </article>;
    })}</div>}
    <p className="directory-footnote">Donations transfer Sepolia test ETH on the public Ethereum test network. Rupee amounts describe project budgets; test ETH has no monetary value.</p>
  </section>;
}
