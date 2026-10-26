import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronRight, Copy, ImagePlus, RotateCcw, X } from 'lucide-react';
import { confirmEscrowDeposit, createOnrampIntent, fetchOnrampConfig, fetchOnrampIntent, mountOnmetaWidget, type OnrampConfig, type OnrampIntent } from './onmeta';
import { createDemoDonor, fetchTrust, recordAdvance, requestFunding, resetTrust, submitTrustProof, voteProof, type TrustNgo, type TrustProof } from './trust';
import { formatInr } from './inr';
import ReceiptVerifier, { VerificationNote } from './ReceiptVerifier';
import BlockchainPanel from './BlockchainPanel';

type Mark = { x: number; y: number; w: number; h: number };
type View = 'donor' | 'ngo' | 'blockchain';
const seedName = 'Clean water for coastal Kenya';
const seedStory = 'Help fund a reliable water point and pipe network for coastal communities. Follow each local payment and the evidence submitted for it.';
const short = (value: string, length = 18) => value.length > length ? `${value.slice(0, length)}…${value.slice(-5)}` : value;
const date = (value: string) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
async function fingerprint(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return '0x' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export default function SimpleApp() {
  const [view, setView] = useState<View>(window.location.hash === '#blockchain' ? 'blockchain' : 'donor');
  const [ngo, setNgo] = useState<TrustNgo | null>(null);
  const [donorToken, setDonorToken] = useState(() => localStorage.getItem('lantern-demo-donor-token') || '');
  const [pendingVote, setPendingVote] = useState<{ proofId: string; support: boolean } | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [amount, setAmount] = useState(500);
  const [onrampConfig, setOnrampConfig] = useState<OnrampConfig | null>(null);
  const [intent, setIntent] = useState<OnrampIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [requestName, setRequestName] = useState(seedName);
  const [requestStory, setRequestStory] = useState(seedStory);
  const [requestTarget, setRequestTarget] = useState('1500000');
  const [vendor, setVendor] = useState('');
  const [invoice, setInvoice] = useState('');
  const [proofTitle, setProofTitle] = useState('');
  const [proofSummary, setProofSummary] = useState('');
  const [proofAmount, setProofAmount] = useState('');
  const [recordedAmount, setRecordedAmount] = useState<number | null>(null);
  const [photoName, setPhotoName] = useState('');
  const [publicImage, setPublicImage] = useState('');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [photoReviewed, setPhotoReviewed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);

  useEffect(() => {
    const onHashChange = () => {
      setView(window.location.hash === '#blockchain' ? 'blockchain' : 'donor');
      window.scrollTo({top:0});
    };
    window.addEventListener('hashchange',onHashChange);
    return () => window.removeEventListener('hashchange',onHashChange);
  }, []);

  const refresh = async (token = donorToken) => setNgo(await fetchTrust(token));
  function navigate(next: View, section?: string) {
    setView(next);
    window.history.replaceState(null,'',next==='blockchain'?'#blockchain':window.location.pathname);
    window.setTimeout(() => {
      if (section) document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 0);
  }
  function openCheckout(vote?: { proofId: string; support: boolean }) {
    setPendingVote(vote || null);
    setCheckoutOpen(true);
  }
  function closeCheckout() {
    setCheckoutOpen(false);
    setPendingVote(null);
  }
  async function copyFingerprint(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice('Receipt fingerprint copied.'); }
    catch { setNotice('Could not copy the fingerprint.'); }
  }
  useEffect(() => {
    void refresh().catch(async () => {
      localStorage.removeItem('lantern-demo-donor-token');
      setDonorToken('');
      try { await refresh(''); } catch { setNotice('The local trust service is unavailable.'); }
    });
    void fetchOnrampConfig().then(setOnrampConfig).catch(() => setOnrampConfig(null));
    const savedIntent = localStorage.getItem('lantern-onramp-intent');
    if (savedIntent) void fetchOnrampIntent(savedIntent).then(setIntent).catch(() => localStorage.removeItem('lantern-onramp-intent'));
  }, []);
  useEffect(() => { if (intent) localStorage.setItem('lantern-onramp-intent', intent.id); }, [intent?.id]);
  useEffect(() => {
    if (!intent || intent.status === 'escrowed') return;
    const timer = window.setInterval(() => { void fetchOnrampIntent(intent.id).then(setIntent).catch(() => undefined); }, 5000);
    return () => window.clearInterval(timer);
  }, [intent?.id, intent?.status]);
  useEffect(() => {
    if (!checkoutOpen || !onrampConfig?.configured || intent?.status !== 'checkout_open') return;
    let active = true;
    void mountOnmetaWidget('simple-onmeta-checkout', onrampConfig, intent, () => {
      if (active) setNotice('Payment submitted. Waiting for the provider’s confirmation.');
    }).catch(error => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [checkoutOpen, onrampConfig, intent?.id]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 5500); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => () => bitmapRef.current?.close(), []);

  const fundraiser = ngo?.campaign.fundraising;
  useEffect(() => {
    if (!ngo) return;
    setRequestName(ngo.campaign.name);
    setRequestStory(ngo.campaign.fundraising.story);
    setRequestTarget(String(ngo.campaign.fundraising.targetInr));
  }, [ngo?.campaign.name, ngo?.campaign.fundraising.story, ngo?.campaign.fundraising.targetInr]);
  const raised = fundraiser?.raisedInr ?? 0;
  const target = fundraiser?.targetInr ?? 1_500_000;
  const progress = Math.min(100, Math.round(raised / Math.max(1, target) * 100));

  async function donateDemo() {
    if (!Number.isSafeInteger(amount) || amount < 100 || amount > 20_000) { setNotice('Choose ₹100–₹20,000 for this demo.'); return; }
    setBusy(true);
    try {
      const donor = await createDemoDonor(amount);
      localStorage.setItem('lantern-demo-donor-token', donor.token);
      setDonorToken(donor.token);
      let reviewCounted = false;
      if (pendingVote) {
        try { setNgo(await voteProof(pendingVote.proofId, pendingVote.support, donor.token)); reviewCounted = true; }
        catch { await refresh(donor.token); }
        setPendingVote(null);
      } else await refresh(donor.token);
      setCheckoutOpen(false);
      navigate('donor', pendingVote ? 'proofs' : 'campaign');
      setNotice(reviewCounted ? 'Demo donation recorded and your review counted. No money was charged.' : pendingVote ? 'Demo donation recorded. The review is no longer open.' : 'Demo donation recorded. You can now review a receipt. No money was charged.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Donation could not be recorded.'); }
    finally { setBusy(false); }
  }
  async function startUpi() {
    if (!onrampConfig?.configured) return;
    setBusy(true);
    try { setIntent(await createOnrampIntent(amount)); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not open the UPI checkout.'); }
    finally { setBusy(false); }
  }
  async function lockConverted() {
    if (!intent?.receivedWei || intent.status !== 'converted_to_account' || !onrampConfig?.ledgerAddress || !window.ethereum) { setNotice('A confirmed conversion and the receiving MetaMask account are required.'); return; }
    setBusy(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      const chain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
      if (accounts[0]?.toLowerCase() !== onrampConfig.walletAddress?.toLowerCase()) throw new Error('Connect the account that received the converted funds.');
      if (Number(BigInt(chain)) !== onrampConfig.chainId) throw new Error('Switch MetaMask to the conversion network.');
      const data = `0xf14faf6f${BigInt(intent.campaignId).toString(16).padStart(64, '0')}`;
      const txHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: accounts[0], to: onrampConfig.ledgerAddress, value: `0x${BigInt(intent.receivedWei).toString(16)}`, data }] }) as string;
      for (let i = 0; i < 20; i++) {
        try { setIntent(await confirmEscrowDeposit(intent.id, txHash)); setNotice('The campaign deposit was independently confirmed.'); return; }
        catch (error) { if (!(error instanceof Error) || !error.message.includes('not confirmed')) throw error; await new Promise(resolve => window.setTimeout(resolve, 1500)); }
      }
      throw new Error('Deposit is pending. Check again after it confirms.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not deposit into the campaign.'); }
    finally { setBusy(false); }
  }
  async function vote(proof: TrustProof, support: boolean) {
    if (!donorToken) { openCheckout({ proofId: proof.id, support }); setNotice('Complete a demo donation to count your review.'); return; }
    try { setNgo(await voteProof(proof.id, support, donorToken)); setNotice('Your review was counted.'); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Could not count the review.';
      if (/token|Only donors/i.test(message)) { localStorage.removeItem('lantern-demo-donor-token'); setDonorToken(''); openCheckout({ proofId: proof.id, support }); setNotice('Make a donation to this campaign to review its proof.'); }
      else setNotice(message);
    }
  }
  async function saveRequest() {
    setBusy(true);
    try { setNgo(await requestFunding({ name: requestName, story: requestStory, targetInr: Number(requestTarget) })); navigate('donor', 'campaign'); setNotice('Funding request updated on the public page.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not update the request.'); }
    finally { setBusy(false); }
  }
  async function recordSpend() {
    const amountInr = Number(proofAmount);
    if (recordedAmount !== null) { setNotice('This payment is already recorded. Publish its proof next.'); return; }
    setBusy(true);
    try { setNgo(await recordAdvance(amountInr)); setRecordedAmount(amountInr); setNotice('Local payment recorded. Publish its proof next.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not record spending.'); }
    finally { setBusy(false); }
  }
  function drawPhoto(nextMarks: Mark[], image = bitmapRef.current) {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.fillStyle = '#202420';
    for (const mark of nextMarks) context.fillRect(mark.x, mark.y, mark.w, mark.h);
    setPublicImage(canvas.toDataURL('image/jpeg', .62));
  }
  async function choosePhoto(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setNotice('Choose a JPG, PNG or WebP photo.'); return; }
    try {
      const bitmap = await createImageBitmap(file);
      bitmapRef.current?.close(); bitmapRef.current = bitmap;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(1, 720 / bitmap.width, 480 / bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      setMarks([]); setPhotoReviewed(false); setPhotoName(file.name); drawPhoto([], bitmap);
    } catch { setNotice('Could not open that photo.'); }
  }
  function coverPhoto(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !bitmapRef.current) return;
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * canvas.width / bounds.width;
    const y = (event.clientY - bounds.top) * canvas.height / bounds.height;
    const w = Math.max(65, canvas.width * .14), h = Math.max(36, canvas.height * .09);
    const next = [...marks, { x: Math.max(0, x - w / 2), y: Math.max(0, y - h / 2), w, h }];
    setMarks(next); drawPhoto(next); setPhotoReviewed(false);
  }
  async function publishProof() {
    if (recordedAmount === null || recordedAmount !== Number(proofAmount)) { setNotice('Record this payment before publishing its proof.'); return; }
    if (publicImage && !photoReviewed) { setNotice('Confirm that names, faces and private details are covered before publishing.'); return; }
    setBusy(true);
    try {
      const documentHash = publicImage ? await fingerprint(publicImage) : '';
      const result = await submitTrustProof({ vendor, invoice, amountInr: Number(proofAmount), title: proofTitle, summary: proofSummary, documentHash, publicImage });
      setNgo(result.state);
      if (result.duplicate) { setNotice('Repeated receipt found. New demo spending is paused.'); return; }
      setVendor(''); setInvoice(''); setProofTitle(''); setProofSummary(''); setProofAmount(''); setRecordedAmount(null); setPhotoName(''); setPublicImage(''); setPhotoReviewed(false); setMarks([]);
      bitmapRef.current?.close(); bitmapRef.current = null;
      navigate('donor', 'proofs');
      setNotice('Public proof published. Check the photo and text on the donor page.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not publish proof.'); }
    finally { setBusy(false); }
  }
  async function reset() {
    try {
      setNgo(await resetTrust());
      localStorage.removeItem('lantern-demo-donor-token');
      localStorage.removeItem('lantern-onramp-intent');
      setDonorToken(''); setPendingVote(null); setRecordedAmount(null); setIntent(null); setCheckoutOpen(false);
      setVendor(''); setInvoice(''); setProofTitle(''); setProofSummary(''); setProofAmount('');
      setPhotoName(''); setPublicImage(''); setPhotoReviewed(false); setMarks([]);
      bitmapRef.current?.close(); bitmapRef.current = null;
      navigate('donor'); setNotice('Demo reset.');
    }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not reset demo.'); }
  }

  return <div className="lantern-shell">
    <header className="lantern-header"><button className="lantern-logo" onClick={() => navigate('donor')}><span>L</span> LANTERN</button><div className="lantern-header-right"><span className="demo-label">Local demo</span><button className="chain-shortcut" onClick={() => navigate('blockchain')}>Blockchain demo ↗</button><button className={view === 'ngo' ? 'mode active' : 'mode'} onClick={() => navigate(view === 'ngo' ? 'donor' : 'ngo')}>{view === 'ngo' ? 'View as donor' : 'For NGOs'} <ArrowRight size={15}/></button></div></header>
    <main className="lantern-main">
      {view === 'ngo' && <ReceiptVerifier onPublished={state => { setNgo(state); navigate('donor', 'proofs'); setNotice('Receipt processed. The public page shows the redacted record.'); }}/>}
      <nav className="pipeline" aria-label="How Lantern works"><button onClick={() => navigate('donor', 'campaign')}><b>01</b> Request</button><ChevronRight size={14}/><button onClick={() => { navigate('donor', 'campaign'); openCheckout(); }}><b>02</b> Donate</button><ChevronRight size={14}/><button onClick={() => navigate('donor', 'proofs')}><b>03</b> Show proof</button><ChevronRight size={14}/><button onClick={() => navigate('donor', 'proofs')}><b>04</b> Review</button><ChevronRight size={14}/><button onClick={() => navigate('donor', 'reputation')}><b>05</b> Track trust</button></nav>
      {view === 'blockchain' ? <BlockchainPanel/> : view === 'donor' ? <>
        <section className="campaign-request" id="campaign"><div className="section-eyebrow">FUNDING REQUEST / {ngo?.country.toUpperCase() || 'KENYA'}</div><div className="campaign-grid"><div><p className="ngo-name">{ngo?.name || 'Harbor Hands Initiative'}</p><h1>{ngo?.campaign.name || seedName}</h1><p className="campaign-story">{fundraiser?.story || seedStory}</p><div className="campaign-tags"><span>{ngo?.campaign.category || 'Water infrastructure'}</span><span>{ngo?.frozen ? 'Local payments paused' : 'Fundraising open'}</span></div></div><div className="funding-box"><span>Raised for this project</span><strong>{formatInr(raised)}</strong><div className="funding-bar"><i style={{ width: `${progress}%` }}/></div><div className="funding-meta"><span>{progress}% of {formatInr(target)} goal</span><span>Demo figures</span></div><button onClick={() => openCheckout()}>Donate in rupees <ArrowRight size={17}/></button><small>No crypto wallet needed. Demo payments are simulated.</small></div></div></section>
        {intent && <div className="payment-line"><strong>Your {formatInr(intent.amountInr)} payment:</strong><span>{intent.status === 'escrowed' ? 'Protected in campaign' : intent.status === 'converted_to_account' ? 'Converted; awaiting campaign deposit' : 'Checkout in progress'}</span></div>}
        <section className="proof-section" id="proofs"><div className="section-heading"><div><span className="section-eyebrow">PROOF FROM THE FIELD</span><h2>What the NGO has shown</h2><p>Public photos and summaries leave private documents out of view.</p></div><span className="section-count">{ngo?.proofs.length || 0} RECEIPTS</span></div><div className="proof-feed">{ngo?.proofs.map(proof => <article className="public-proof" key={proof.id}><div className="proof-photo">{proof.publicImage ? <img src={proof.publicImage} alt={`Public proof for ${proof.title}`} loading="lazy"/> : <div className="no-photo"><ImagePlus size={25}/><span>No public photo</span></div>}<span>{proof.demo ? 'Sample / demo proof' : 'NGO submitted photo'}</span></div><div className="proof-detail"><div className="proof-line"><span className={`proof-state ${proof.status}`}>{proof.status === 'approved' ? 'Community approved' : proof.status === 'flagged' ? 'Needs review' : 'Review open'}</span><span>{date(proof.createdAt)}</span></div><h3>{proof.title}</h3><p>{proof.summary}</p><VerificationNote proof={proof}/><div className="proof-amount"><span>{proof.category}</span><strong>{formatInr(proof.amountInr)}</strong></div><div className="fingerprint"><span>Receipt fingerprint</span><code>{short(proof.commitment, 26)}</code><button title="Copy fingerprint" onClick={() => void copyFingerprint(proof.commitment)}><Copy size={14}/></button></div><div className="proof-vote"><span>{proof.yes} fair · {proof.no} questioned</span>{proof.final ? <small>Review closed</small> : proof.voted ? <small>Your vote counted</small> : <div><button onClick={() => void vote(proof, true)}><Check size={14}/> Fair cost</button><button onClick={() => void vote(proof, false)}>Question cost</button></div>}</div></div></article>)}</div><p className="proof-footnote">Fingerprints detect reuse. Photos and votes help people judge a claim; they do not prove delivery by themselves.</p></section>
        <div className="accountability-grid"><section className="money-trail" id="trail"><div className="section-heading"><div><span className="section-eyebrow">MONEY TRAIL</span><h2>Where the money went</h2></div></div><div className="trail-rows">{ngo?.events.slice(0, 7).map(event => <div className="trail-row" key={event.id}><span className="trail-date">{date(event.createdAt)}</span><div><strong>{event.title}</strong><p>{event.detail}</p></div><b>{event.amountInr ? formatInr(event.amountInr) : '—'}</b></div>)}</div><small>Sample entries are marked in their descriptions. New demo actions are saved by the backend.</small></section><section className="trust-history" id="reputation"><div className="section-heading"><div><span className="section-eyebrow">NGO REPUTATION</span><h2>Trust history</h2></div></div><div className="trust-current"><strong>{ngo?.score ?? 68}<small>/100</small></strong><span>{ngo?.frozen ? 'Local spending paused' : 'Local spending available'}</span></div><div className="reputation-counts"><span>{ngo?.reputation.approved ?? 0} approved</span><span>{ngo?.reputation.open ?? 0} open</span><span>{ngo?.reputation.flagged ?? 0} flagged</span></div><div className="history-rows">{ngo?.scoreHistory.map(item => <div key={item.id}><span>{date(item.createdAt)}</span><strong>{item.reason}</strong><b>{item.delta > 0 ? '+' : ''}{item.delta || '—'}</b></div>)}</div><p className="trust-explainer">The score sets the demo limit for local spending. Donor reviews and repeated evidence change it.</p></section></div>
      </> : <section className="ngo-editor"><div className="section-heading"><div><span className="section-eyebrow">NGO DESK</span><h1>Ask. Spend. Show proof.</h1><p>These controls update the local demo record shown to donors.</p></div><button className="quiet-button" onClick={() => navigate('donor')}>View public page <ArrowRight size={15}/></button></div><div className="ngo-edit-grid"><div className="edit-panel"><span className="edit-step">01 / FUNDING REQUEST</span><h2>Tell donors what you need</h2><label>Project name<input value={requestName} onChange={event => setRequestName(event.target.value)}/></label><label>Fundraising goal in rupees<input type="number" value={requestTarget} onChange={event => setRequestTarget(event.target.value)}/></label><label>Why this work matters<textarea rows={5} value={requestStory} onChange={event => setRequestStory(event.target.value)}/></label><button className="dark-button" disabled={busy} onClick={() => void saveRequest()}>Publish funding request <ArrowRight size={16}/></button></div><div className="edit-panel"><span className="edit-step">02 / SPENDING & PROOF</span><h2>Show where funds went</h2><div className="limit-note">Local spending available: <strong>{formatInr(ngo?.allowanceLeftInr ?? 0)}</strong>{ngo?.frozen && <em> · paused after duplicate evidence</em>}</div><div className="form-pair"><label>Supplier<input value={vendor} onChange={event => setVendor(event.target.value)} placeholder="e.g. Blue Coast Supplies"/></label><label>Invoice ID<input value={invoice} onChange={event => setInvoice(event.target.value)} placeholder="e.g. BCS-072"/></label></div><div className="form-pair"><label>Amount in rupees<input type="number" value={proofAmount} onChange={event => { setProofAmount(event.target.value); if (recordedAmount !== null && Number(event.target.value) !== recordedAmount) setRecordedAmount(null); }}/></label><label>Public title<input value={proofTitle} onChange={event => setProofTitle(event.target.value)}/></label></div><label>Public summary<textarea rows={3} value={proofSummary} onChange={event => setProofSummary(event.target.value)} placeholder="What was bought? Do not include private names or addresses."/></label><div className="proof-upload"><label className="upload-button"><ImagePlus size={16}/> {photoName || 'Add a proof photo'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void choosePhoto(event.target.files?.[0])}/></label><span>Optional. Original stays in your browser.</span></div><canvas className={publicImage ? 'redactor visible' : 'redactor'} ref={canvasRef} onClick={coverPhoto} aria-label="Click private details in the photo to cover them"/>{publicImage && <div className="redaction-help"><span>Tap names, faces or documents to cover them before publishing.</span><button onClick={() => { setMarks([]); drawPhoto([]); setPhotoReviewed(false); }}>Clear covers</button><label><input type="checkbox" checked={photoReviewed} onChange={event => setPhotoReviewed(event.target.checked)}/> I covered private details</label></div>}<div className="proof-actions"><button disabled={busy || !!ngo?.frozen || recordedAmount !== null} onClick={() => void recordSpend()}>{recordedAmount !== null ? '✓ Payment recorded' : '1. Record local payment'}</button><button className="dark-button" disabled={busy} onClick={() => void publishProof()}>2. Publish redacted proof <ArrowRight size={16}/></button></div><small>Only the redacted image, a receipt fingerprint and the redacted summary are saved.</small></div></div>{intent?.status === 'converted_to_account' && <div className="converted-note"><span>A converted payment is waiting in the receiving account.</span><button onClick={() => void lockConverted()} disabled={busy}>Deposit into campaign</button></div>}</section>}
    </main>
    {checkoutOpen && <div className="checkout-backdrop" onClick={closeCheckout}><div className="checkout" role="dialog" aria-modal="true" aria-label="Donation checkout" onClick={event => event.stopPropagation()}><button className="checkout-close" onClick={closeCheckout} aria-label="Close"><X size={18}/></button><span className="section-eyebrow">{pendingVote ? 'DONATE TO SUBMIT YOUR REVIEW' : 'SUPPORT THIS PROJECT'}</span><h2>Donate in rupees</h2><p>No crypto wallet is needed. The live provider may ask for identity verification.</p><div className="amount-options">{[500, 1000, 2500, 5000].map(value => <button key={value} className={amount === value ? 'chosen' : ''} onClick={() => setAmount(value)}>{formatInr(value)}</button>)}</div><label>Custom amount<input type="number" min="100" max="20000" value={amount} onChange={event => setAmount(Number(event.target.value))}/></label>{onrampConfig?.configured && !intent && <button className="dark-button wide" disabled={busy} onClick={() => void startUpi()}>Continue to UPI checkout <ArrowRight size={16}/></button>}{intent?.status === 'checkout_open' && <div id="simple-onmeta-checkout"/>}{intent && <p className="checkout-status">{intent.status === 'escrowed' ? 'Donation protected in the campaign.' : intent.status === 'converted_to_account' ? 'Converted payment awaits campaign deposit.' : 'Waiting for provider confirmation.'}</p>}<button className="demo-donate" disabled={busy} onClick={() => void donateDemo()}>Try a demo donation · no money charged <ArrowRight size={15}/></button></div></div>}
    {notice && <div className="lantern-toast" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={14}/></button></div>}
    <footer className="lantern-footer"><span>LANTERN / DEMO</span><span>Public claims. Private people.</span><button onClick={() => void reset()}><RotateCcw size={13}/> Reset scenario</button></footer>
  </div>;
}
