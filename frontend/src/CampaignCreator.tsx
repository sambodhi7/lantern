import {useState} from 'react';
import {createCampaign} from './trust';

export function openCampaign(id:string){window.location.assign(`${window.location.pathname}?campaign=${encodeURIComponent(id)}${window.location.hash}`);}

export default function CampaignCreator(){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [name,setName]=useState(''),[story,setStory]=useState(''),[category,setCategory]=useState('Water infrastructure'),[target,setTarget]=useState('100000');
  return <section className="campaign-creator"><button className="dark-button" disabled={busy} onClick={()=>setOpen(!open)}>{open?'Close new campaign form':'+ Create new campaign'}</button>
    {open&&<form className="edit-panel" onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{const created=await createCampaign({name,story,category,targetInr:Number(target)});openCampaign(created.campaign.id);}catch(reason){setError(reason instanceof Error?reason.message:'Could not create campaign.');setBusy(false);}}}>
      <h2>A new funding request</h2><p>Starts with ₹0 raised. Donations, receipts and review history stay separate from your other campaigns.</p>
      <label>Campaign name<input required minLength={8} maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Clean water for another community"/></label>
      <label>Funding goal in rupees<input type="number" required min="1" max="20000000" step="1" value={target} onChange={e=>setTarget(e.target.value)}/></label>
      <label>Spending purpose<select value={category} onChange={e=>setCategory(e.target.value)}>{['Water infrastructure','Education','Healthcare','Food and nutrition','Disaster relief','General'].map(item=><option key={item}>{item}</option>)}</select></label>
      <label>What will this campaign do?<textarea required minLength={30} maxLength={1200} rows={4} value={story} onChange={e=>setStory(e.target.value)} placeholder="Explain who the project helps and how the funds will be used."/></label>
      <p>After publishing, activate this campaign on Sepolia with MetaMask to accept test ETH in its own escrow balance. Your rupee goal describes the project budget.</p>
      <button className="dark-button" disabled={busy} type="submit">{busy?'Creating…':'Publish new campaign'}</button>{error&&<p role="alert">{error}</p>}
    </form>}
  </section>;
}
