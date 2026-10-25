import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Banknote, Check, CheckCircle2, Clock3, Copy, FileCheck2, FileLock2, Fingerprint, Heart, Info, Landmark, LockKeyhole, RotateCcw, ShieldAlert, ShieldCheck, ThumbsDown, ThumbsUp, UploadCloud, Vote, Wallet, X } from 'lucide-react';
import { chainToInr, fetchMarketRate, formatInr, isFreshRate, readCachedRate, type MarketRate } from './inr';
import { confirmEscrowDeposit, createOnrampIntent, fetchOnrampConfig, fetchOnrampIntent, mountOnmetaWidget, type OnrampConfig, type OnrampIntent } from './onmeta';
import { createDemoDonor, fetchTrust, recordAdvance, resetTrust, runTrustAttack, submitTrustProof, voteProof, type TrustNgo } from './trust';

type Page = 'overview' | 'trail' | 'proofs' | 'ngo';
type Proof = {
  id: string; title: string; category: string; amount: number; fiatAmount?: number; date: string;
  commitment: string; documentHash: string; privateKey: string; summary: string;
  grade: number; checks: string[]; status: 'review' | 'flagged' | 'approved';
  yes: number; no: number; final: boolean; votedBy: string[];
};
type TrailItem = { id: string; kind: 'in' | 'move' | 'offchain' | 'proof' | 'alert'; title: string; detail: string; amount?: number; amountCurrency?: 'chain' | 'INR'; date: string; ref?: string };
type Donation = { id: string; amount: number; date: string };
type DemoState = { trust: number; exposure: number; frozen: boolean; demoRaised: number; donations: Donation[]; proofs: Proof[]; trail: TrailItem[] };

const ESCROW_ETH = 18.4;
const INITIAL_AVAILABLE_ETH = 9.7;
const projectName = 'Clean water for coastal Kenya';
const short = (value: string, length = 14) => value.length > length ? `${value.slice(0, length)}…${value.slice(-5)}` : value;
const dateNow = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
async function sha256(value: string | ArrayBuffer) {
  const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return '0x' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const seed: DemoState = {
  trust: 68, exposure: 0.9, frozen: false, demoRaised: 0, donations: [],
  proofs: [
    { id: 'water-pump-071', title: 'Water pump and pipe fittings', category: 'Water infrastructure', amount: 0.45, date: 'Oct 18, 2026', commitment: '0x6a92dba08d5415f0f3279535db463653d85610df8718660df68fd4e2e9bb54b2', documentHash: '0x80f783a9f2d04dbe9dff17307b4bafab9108349014f2706a6519293321db4c2d', privateKey: 'blue coast supplies|bcs-071', summary: 'Purchased a pump and pipe fittings for the coastal water station. Personal details are hidden.', grade: 91, checks: ['Category matches campaign', 'Receipt fields complete', 'No matching invoice ID found'], status: 'review', yes: 2, no: 0, final: false, votedBy: [] },
    { id: 'drilling-042', title: 'Borehole drilling services', category: 'Water infrastructure', amount: 0.31, date: 'Oct 16, 2026', commitment: '0x2e641dda38f02581465c88cb966a2e082adf311bc0ca37cc8bdb6b3789ff7820', documentHash: '0x57e0c398f030cb1d90e1db19e15d637e338c6e3291452a31dd42eaabca638be1', privateKey: 'tana drilling|td-042', summary: 'Drilling work completed at the community site. Beneficiary and location details are hidden.', grade: 86, checks: ['Category matches campaign', 'Invoice reference unique'], status: 'approved', yes: 12, no: 2, final: true, votedBy: [] },
  ],
  trail: [
    { id: 't5', kind: 'proof', title: 'Receipt fingerprint published', detail: 'Pump invoice linked to a local vendor expense. Private document stays private.', amount: 0.45, amountCurrency: 'chain', date: 'Oct 18, 2026', ref: '0x6a92…54b2' },
    { id: 't4', kind: 'offchain', title: 'Local spending allowance used', detail: 'Funds set aside for local vendor payments. A receipt is due.', amount: 0.9, amountCurrency: 'chain', date: 'Oct 17, 2026', ref: '0xa1c7…f903' },
    { id: 't3', kind: 'move', title: 'Funds moved between accounts', detail: 'The transfer path is linked to this campaign.', amount: 2.1, amountCurrency: 'chain', date: 'Oct 14, 2026', ref: '0x82f1…0a42' },
    { id: 't2', kind: 'proof', title: 'Vendor payment recorded', detail: 'A registered payment record supports the borehole expense.', amount: 0.31, amountCurrency: 'chain', date: 'Oct 12, 2026', ref: '0x7be6…51f9' },
    { id: 't1', kind: 'in', title: 'Donations protected for this cause', detail: 'Funds set aside for water infrastructure.', amount: 18.4, amountCurrency: 'chain', date: 'Oct 10, 2026', ref: '0x5fbd…80aa' },
  ],
};
function loadState(): DemoState {
  try {
    const raw = localStorage.getItem('lantern-demo-v2');
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState;
      if (typeof parsed.trust === 'number' && Array.isArray(parsed.proofs) && Array.isArray(parsed.trail)) return parsed;
    }
  } catch { /* start a fresh local demo */ }
  return seed;
}
declare global { interface Window { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } } }

export default function App() {
  const [state, setState] = useState<DemoState>(loadState);
  const [page, setPage] = useState<Page>('overview');
  const [donateOpen, setDonateOpen] = useState(false);
  const [donationAmount, setDonationAmount] = useState(500);
  const [toast, setToast] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [walletChain, setWalletChain] = useState('');
  const [contractAddress, setContractAddress] = useState(localStorage.getItem('lantern-contract-address') || '');
  const [contractBalance, setContractBalance] = useState<number | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState('10000');
  const [vendor, setVendor] = useState('');
  const [invoice, setInvoice] = useState('');
  const [proofAmount, setProofAmount] = useState('');
  const [proofTitle, setProofTitle] = useState('');
  const [proofSummary, setProofSummary] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [onrampConfig, setOnrampConfig] = useState<OnrampConfig | null>(null);
  const [onrampIntent, setOnrampIntent] = useState<OnrampIntent | null>(() => {
    try { const saved = localStorage.getItem('lantern-onramp-intent-v1'); return saved ? JSON.parse(saved) as OnrampIntent : null; }
    catch { return null; }
  });
  const [onrampBusy, setOnrampBusy] = useState(false);
  const [onrampError, setOnrampError] = useState('');
  const [fundingEscrow, setFundingEscrow] = useState(false);
  const [trustData, setTrustData] = useState<TrustNgo | null>(null);
  const [donorToken, setDonorToken] = useState(() => localStorage.getItem('lantern-demo-donor-token') || '');
  const [marketRate, setMarketRate] = useState<MarketRate | null>(readCachedRate);
  const [rateError, setRateError] = useState(false);
  const [now, setNow] = useState(Date.now());

  const allowance = useMemo(() => ESCROW_ETH * (0.05 + state.trust * 0.0015), [state.trust]);
  const allowanceLeft = Math.max(0, allowance - state.exposure);
  const rate = isFreshRate(marketRate, now) ? marketRate : null;
  const rupees = (amount: number) => chainToInr(amount, rate);
  const allowanceLabel = trustData ? formatInr(trustData.allowanceInr) : rupees(allowance);
  const allowanceLeftLabel = trustData ? formatInr(trustData.allowanceLeftInr) : rupees(allowanceLeft);
  const exposureLabel = trustData ? formatInr(trustData.exposureInr) : rupees(state.exposure);
  const budgetLabel = trustData ? formatInr(trustData.campaign.budgetInr) : rupees(ESCROW_ETH);
  const budgetRemainingLabel = trustData ? formatInr(trustData.campaign.budgetInr - trustData.exposureInr) : rupees(INITIAL_AVAILABLE_ETH - state.exposure);
  const receiptTotalLabel = trustData ? formatInr(trustData.proofs.reduce((total, proof) => total + proof.amountInr, 0)) : rupees(8.7);
  const progressPercent = trustData ? Math.min(100, trustData.exposureInr / trustData.allowanceInr * 100) : Math.min(100, state.exposure / allowance * 100);
  const receiptCoverage = trustData ? Math.min(100, Math.round(trustData.proofs.reduce((total, proof) => total + proof.amountInr, 0) / Math.max(1, trustData.exposureInr) * 100)) : 0;
  const donorId = donorToken ? state.donations.at(-1)?.id : undefined;
  useEffect(() => { localStorage.setItem('lantern-demo-v2', JSON.stringify(state)); }, [state]);
  useEffect(() => { if (onrampIntent) localStorage.setItem('lantern-onramp-intent-v1', JSON.stringify(onrampIntent)); }, [onrampIntent]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const next = await fetchMarketRate(); if (active) { setMarketRate(next); setRateError(false); setNow(Date.now()); } }
      catch { if (active) setRateError(true); }
    };
    void load();
    const timer = window.setInterval(() => { setNow(Date.now()); void load(); }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { void fetchOnrampConfig().then(setOnrampConfig).catch(() => setOnrampConfig(null)); }, []);
  useEffect(() => { void fetchTrust(donorToken).then(setTrustData).catch(() => notify('Trust engine is unavailable.')); }, []);
  useEffect(() => {
    if (!trustData) return;
    const liveProofs: Proof[] = trustData.proofs.map(proof => ({
      id: proof.id, title: proof.title, category: proof.category, amount: 0, fiatAmount: proof.amountInr,
      date: new Date(proof.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      commitment: proof.commitment, documentHash: '', privateKey: '', summary: proof.summary,
      grade: proof.grade, checks: proof.checks, status: proof.status, yes: proof.yes, no: proof.no,
      final: proof.final, votedBy: proof.voted && donorId ? [donorId] : [],
    }));
    const liveTrail: TrailItem[] = trustData.events.map(event => ({
      id: event.id, kind: event.type === 'hold' || event.type === 'flag' ? 'alert' : event.type === 'proof' ? 'proof' : 'offchain',
      title: event.title, detail: event.detail, amount: event.amountInr, amountCurrency: 'INR',
      date: new Date(event.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    }));
    setState(previous => ({ ...previous, trust: trustData.score, frozen: trustData.frozen,
      exposure: rate ? trustData.exposureInr / rate.inrPerEth : previous.exposure,
      proofs: liveProofs, trail: [...liveTrail, ...seed.trail],
    }));
  }, [trustData, rate?.inrPerEth, donorId]);
  useEffect(() => {
    if (!onrampIntent || onrampIntent.status === 'escrowed') return;
    const poll = () => { void fetchOnrampIntent(onrampIntent.id).then(setOnrampIntent).catch(() => undefined); };
    const timer = window.setInterval(poll, 5000);
    return () => window.clearInterval(timer);
  }, [onrampIntent?.id, onrampIntent?.status]);
  useEffect(() => {
    if (!donateOpen || !onrampConfig?.configured || !onrampIntent || onrampIntent.status !== 'checkout_open') return;
    let cancelled = false;
    void mountOnmetaWidget('onmeta-checkout', onrampConfig, onrampIntent, () => {
      if (!cancelled) notify('The provider is processing your order. Waiting for its signed confirmation.');
    }).catch(error => { if (!cancelled) setOnrampError(error.message); });
    return () => { cancelled = true; };
  }, [donateOpen, onrampConfig, onrampIntent?.id]);
  const notify = (message: string) => setToast(message);
  const navigate = (next: Page) => { setPage(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const donate = async () => {
    if (!Number.isSafeInteger(donationAmount) || donationAmount <= 0) { notify('Enter a positive whole-rupee amount.'); return; }
    try {
      const donor = await createDemoDonor(donationAmount);
      localStorage.setItem('lantern-demo-donor-token', donor.token);
      setDonorToken(donor.token);
      const receipt = { id: donor.donorId, amount: donationAmount, date: dateNow() };
      setState(previous => ({ ...previous, demoRaised: previous.demoRaised + donationAmount, donations: [...previous.donations, receipt] }));
      setTrustData(await fetchTrust(donor.token));
      setDonateOpen(false); setShowReceipt(true); notify('Demo receipt created. You can now review a proof.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create demo donation.'); }
  };
  const startOnramp = async () => {
    if (!onrampConfig?.configured) { notify('The real INR conversion provider has not been configured yet.'); return; }
    setOnrampBusy(true); setOnrampError('');
    try { setOnrampIntent(await createOnrampIntent(donationAmount)); }
    catch (error) { setOnrampError(error instanceof Error ? error.message : 'Could not open the INR checkout.'); }
    finally { setOnrampBusy(false); }
  };
  const fundCampaignEscrow = async () => {
    if (!onrampIntent?.receivedWei || onrampIntent.status !== 'converted_to_account' || !onrampConfig?.escrowConfigured || !onrampConfig.ledgerAddress || !window.ethereum) {
      notify('A confirmed conversion, connected account, and deployed contract are required.'); return;
    }
    setFundingEscrow(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      const chain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
      if (accounts[0]?.toLowerCase() !== onrampConfig.walletAddress?.toLowerCase()) throw new Error('Connect the account that received the converted funds.');
      if (Number(BigInt(chain)) !== onrampConfig.chainId) throw new Error('Switch the connected account to the conversion network.');
      const data = `0xf14faf6f${BigInt(onrampIntent.campaignId).toString(16).padStart(64, '0')}`;
      const txHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{
        from: accounts[0], to: onrampConfig.ledgerAddress,
        value: `0x${BigInt(onrampIntent.receivedWei).toString(16)}`, data,
      }] }) as string;
      notify('Deposit sent. Waiting for confirmation from the campaign contract.');
      for (let attempt = 0; attempt < 20; attempt++) {
        try { setOnrampIntent(await confirmEscrowDeposit(onrampIntent.id, txHash)); notify('Donation is now protected in the campaign contract.'); return; }
        catch (error) {
          if (!(error instanceof Error) || !error.message.includes('not confirmed')) throw error;
          await new Promise(resolve => window.setTimeout(resolve, 1500));
        }
      }
      throw new Error('Deposit is still pending. Check again after the transaction confirms.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not complete the campaign deposit.'); }
    finally { setFundingEscrow(false); }
  };
  const vote = async (proofId: string, yes: boolean) => {
    if (!donorToken) { notify('Make a demo donation first to unlock a review vote.'); setDonateOpen(true); return; }
    try { setTrustData(await voteProof(proofId, yes, donorToken)); notify('Your review was counted by the trust engine.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not count your review.'); }
  };
  const drawAdvance = async () => {
    try { setTrustData(await recordAdvance(Number(advanceAmount))); notify(`${formatInr(Number(advanceAmount))} recorded in the demo. Attach a receipt next.`); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not record payment.'); }
  };
  const submitProof = async () => {
    if (!vendor.trim() || !invoice.trim() || !proofTitle.trim() || !proofSummary.trim() || !proofAmount.trim()) { notify('Complete every invoice field and the public summary.'); return; }
    const amountInr = Number(proofAmount);
    setSubmitting(true);
    try {
      const documentHash = proofFile ? await sha256(await proofFile.arrayBuffer()) : '';
      const result = await submitTrustProof({ vendor, invoice, amountInr, title: proofTitle, summary: proofSummary, documentHash });
      setTrustData(result.state);
      if (result.duplicate) { notify('Duplicate detected. New demo payments are paused.'); return; }
      setVendor(''); setInvoice(''); setProofAmount(''); setProofTitle(''); setProofSummary(''); setProofFile(null);
      notify('Receipt recorded by the trust engine. Its checks are now public.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not record receipt.'); }
    finally { setSubmitting(false); }
  };
  const runAttack = async () => {
    try { const result = await runTrustAttack(); setTrustData(result.state); notify('Duplicate evidence caught. Demo local payments paused.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not run attack.'); }
  };
  const reset = async () => {
    try { localStorage.removeItem('lantern-demo-donor-token'); setDonorToken(''); setState(seed); setTrustData(await resetTrust()); setShowReceipt(false); notify('Backend demo reset to the starting scenario.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not reset demo.'); }
  };
  const connectWallet = async () => {
    if (!window.ethereum) { notify('A compatible secure account app was not found.'); return; }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      const chain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
      setWalletAddress(accounts[0] || ''); setWalletChain(chain === '0x14a34' ? 'Base Sepolia' : chain === '0x1' ? 'Ethereum mainnet' : `Chain ${parseInt(chain, 16)}`);
      notify('Organization account connected. Payments in this screen remain demo only.');
    } catch { notify('Wallet connection was cancelled or failed.'); }
  };
  const readContract = async () => {
    if (!window.ethereum || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) { notify('Connect organization account and enter a valid contract address.'); return; }
    try {
      const balance = await window.ethereum.request({ method: 'eth_getBalance', params: [contractAddress, 'latest'] }) as string;
      setContractBalance(Number(BigInt(balance)) / 1e18); localStorage.setItem('lantern-contract-address', contractAddress);
      notify('Live contract balance read from your connected network.');
    } catch { notify('Could not read the live balance. Check the connected account.'); }
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand" onClick={() => navigate('overview')}><div className="brand-mark">L</div><span>LANTERN<span className="brand-period">.</span></span></div>
      <div className="sidebar-label">Public record / 01</div>
      <nav>
        <button className={page === 'overview' ? 'nav-active' : ''} onClick={() => navigate('overview')}><Landmark size={19} /> Overview</button>
        <button className={page === 'trail' ? 'nav-active' : ''} onClick={() => navigate('trail')}><Activity size={19} /> Money trail</button>
        <button className={page === 'proofs' ? 'nav-active' : ''} onClick={() => navigate('proofs')}><FileCheck2 size={19} /> Receipts <span className="nav-count">{state.proofs.length}</span></button>
        <button className={page === 'ngo' ? 'nav-active' : ''} onClick={() => navigate('ngo')}><Wallet size={19} /> For NGOs</button>
      </nav>
      <div className="sidebar-bottom"><div className="demo-chip"><span className="pulse-dot" /> LIVE INTERACTIVE DEMO</div><p>Sample history and a persisted local trust backend. No real payment happens here.</p><button className="reset-button" onClick={reset}><RotateCcw size={15}/> Reset scenario</button></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumb">Case file <span>/</span> <strong>{page === 'ngo' ? 'NGO workspace' : projectName}</strong></div><div className="topbar-right"><span className="network-pill"><span /> Demo environment</span><button className="top-reset" onClick={reset}><RotateCcw size={14}/> Reset case</button></div></header>
      <div className="content-wrap"><div className={`rate-strip ${rate ? "" : "rate-unavailable"}`}><Info size={15}/>{rate ? <span>Rupee estimates use today’s market rate, updated {new Date(rate.updatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })} IST. Past values may differ.</span> : <span>{rateError ? "Live rupee estimates are temporarily unavailable. Please retry shortly." : "Loading live rupee estimates…"}</span>}<a href="https://www.coingecko.com/" target="_blank" rel="noreferrer">Rate source</a></div>
        {page === 'overview' && <>
          <section className="case-intro">
            <div className="case-kicker"><span>CASE FILE 01</span><span>WATER INFRASTRUCTURE / KENYA</span><span className={state.frozen ? 'case-flag' : ''}>{state.frozen ? 'ADVANCES PAUSED' : 'MONITORING ACTIVE'}</span></div>
            <div className="case-intro-grid">
              <div className="case-intro-copy"><span className="case-serial">LANTERN / FIELD RECORD</span><h1>{projectName}</h1><p>Follow the donations, the local spending and the receipts attached to each claim. Unexplained steps stay visible.</p><div className="case-byline"><strong>Harbor Hands Initiative</strong><span>Public demo record</span></div></div>
              <div className="case-actions"><span>YOUR PART IN THE RECORD</span><p>Support the project or examine where the money went.</p><button className="button button-accent" onClick={() => setDonateOpen(true)}>Support this project <ArrowUpRight size={17}/></button><button className="button button-outline-light" onClick={() => navigate('trail')}>Inspect the money trail <ArrowRight size={17}/></button></div>
            </div>
          </section>
          {onrampIntent && <section className="donation-progress"><div className="donation-progress-icon"><ShieldCheck size={21}/></div><div><strong>Your {formatInr(onrampIntent.amountInr)} payment: {onrampIntent.status === 'escrowed' ? 'protected in the campaign' : onrampIntent.status === 'converted_to_account' ? 'converted, awaiting campaign deposit' : 'checkout in progress'}</strong><p>{onrampIntent.status === 'escrowed' ? 'The campaign contract has received the funds.' : onrampIntent.status === 'converted_to_account' ? 'The provider confirmed conversion. The funds still need to enter the campaign contract.' : 'We will update this after the conversion provider confirms the payment.'}</p></div></section>}
          <section className="instrument-grid" aria-label="Campaign instruments">
            <article className="instrument trust-instrument"><div className="instrument-head"><span>01 / TRUST METER</span><span>RULE-BASED</span></div><div className="dial"><svg viewBox="0 0 200 200" aria-hidden="true"><g className="dial-ticks">{Array.from({ length: 48 }, (_, index) => <line key={index} x1="100" y1="4" x2="100" y2={index % 4 === 0 ? '19' : '13'} transform={`rotate(${index * 7.5} 100 100)`}/>)}</g><circle className="dial-track" cx="100" cy="100" r="69"/><circle className="dial-progress" cx="100" cy="100" r="69" transform="rotate(-90 100 100)" strokeDasharray={`${state.trust * 4.335} 433.5`}/></svg><div className="dial-center"><strong>{state.trust}</strong><span>OUT OF 100</span></div></div><div className="instrument-foot"><strong>{state.frozen ? 'Paused after duplicate evidence' : 'Local payments available'}</strong><p>Donor reviews move this score. A repeated receipt pauses new demo advances.</p></div></article>
            <article className="instrument ledger-instrument"><div className="instrument-head"><span>02 / CAMPAIGN LEDGER</span><span>AMOUNTS IN INR</span></div><div className="ledger-table"><div><span>Campaign budget</span><strong>{budgetLabel}</strong></div><div><span>Local payments recorded</span><strong>{exposureLabel}</strong></div><div><span>Receipt claims submitted</span><strong>{receiptTotalLabel}</strong></div><div><span>Remaining demo budget</span><strong>{budgetRemainingLabel}</strong></div></div><div className="coverage"><div><span>Receipt claims / recorded advances</span><strong>{receiptCoverage}%</strong></div><div className="coverage-line"><i style={{ width: `${receiptCoverage}%` }}/></div><small>A submitted receipt is not proof that goods were delivered.</small></div><div className="ledger-footer"><span>LOCAL SPENDING LIMIT</span><strong>{allowanceLeftLabel} available</strong><button onClick={() => navigate('ngo')}>View controls <ArrowRight size={15}/></button></div></article>
          </section>
          <section className="case-lower"><div className="workflow-card"><div className="case-section-head"><span>03 / THE METHOD</span><h2>Three checks. One record.</h2></div><ol><li><b>01</b><div><strong>Give</strong><p>Donors use a familiar checkout.</p></div></li><li><b>02</b><div><strong>Account</strong><p>Local payments stay within the spending limit.</p></div></li><li><b>03</b><div><strong>Review</strong><p>Receipts and donor feedback sit beside each payment.</p></div></li></ol></div><div className="activity-card"><div className="case-section-head"><span>04 / RECENT ENTRIES</span><h2>Latest activity</h2><button onClick={() => navigate('trail')}>Full record <ArrowRight size={15}/></button></div><TrailList items={state.trail.slice(0, 4)} rate={rate}/></div></section>
          <section className="privacy-note"><div><span>PRIVATE DOCUMENTS / PUBLIC ACCOUNTABILITY</span><p>People stay private. Donors can inspect receipt fingerprints and plain-language summaries.</p></div><button onClick={() => navigate('proofs')}>Open receipts <ArrowRight size={16}/></button></section>
        </>}

        {page === 'trail' && <><PageHeading eyebrow="WHERE THE MONEY GOES" title="Follow every step." subtitle="See when donations arrived, where they moved and which receipts support the spending. Earlier events are sample data; new actions are saved by the local backend."/><div className="trail-layout"><section className="panel trail-main"><div className="panel-header"><div><h3>Campaign timeline</h3><p>Newest activity first</p></div><span className="small-badge">{state.trail.length} EVENTS</span></div><TrailList items={state.trail} rate={rate} detailed /></section><aside className="side-stack"><section className="panel"><span className="eyebrow muted">THE MONEY PATH</span><h3>What is accounted for?</h3><div className="path-node"><span className="node-icon green-bg"><ArrowDownLeft size={18}/></span><div><strong>{budgetLabel}</strong><small>Synthetic budget for this scenario</small></div></div><div className="path-connector"/><div className="path-node"><span className="node-icon orange-bg"><Check size={18}/></span><div><strong>{receiptTotalLabel}</strong><small>Receipts submitted in this scenario</small></div></div><div className="path-connector"/><div className="path-node"><span className="node-icon blue-bg"><Banknote size={18}/></span><div><strong>{exposureLabel}</strong><small>Local payments awaiting receipts</small></div></div><div className="path-connector"/><div className="path-node"><span className="node-icon gray-bg"><LockKeyhole size={18}/></span><div><strong>{budgetRemainingLabel}</strong><small>Remaining demo budget</small></div></div></section><section className="insight-box"><ShieldCheck size={23}/><h4>What “verified” means here</h4><p>A recorded payment can be matched to an approved provider record. A receipt fingerprint identifies the document submitted; it cannot prove the work happened.</p></section></aside></div></>}

        {page === 'proofs' && <><PageHeading eyebrow="PUBLIC EVIDENCE ROOM" title="See the proof. Protect the people." subtitle="Read plain-language spending summaries, see receipt fingerprints and tell the organization if a cost looks fair."/><div className="proof-intro"><div className="proof-intro-icon"><FileLock2 size={24}/></div><div><strong>Private by design</strong><p>Uploaded files stay in the NGO’s browser in this demo. Only a unique document fingerprint and a summary with basic personal details hidden are shown.</p></div><span>PRIVATE RECEIPTS</span></div><div className="proof-grid">{state.proofs.map(proof => <ProofCard key={proof.id} proof={proof} donorId={donorId} rate={rate} onVote={vote} onDonate={() => setDonateOpen(true)}/>)}</div><section className="challenge-card"><div className="challenge-icon"><ShieldAlert size={22}/></div><div><h3>Try the double-counting attack</h3><p>Reuse invoice <strong>BCS-071</strong> from Blue Coast Supplies in the NGO workspace. Its invoice number already appears above. The duplicate is detected and new advances freeze.</p></div><button className="button button-white" onClick={runAttack}>Run demo attack <ArrowRight size={17}/></button></section></>}

        {page === 'ngo' && <><PageHeading eyebrow="NGO OPERATIONS" title="Move funds. Show your work." subtitle="Request local supplier payments, attach receipts and see how donor feedback affects your spending limit. Actions are simulated unless marked as a live read."/><section className="panel onramp-escrow-panel"><div><span className="eyebrow muted">CONVERSION TO CAMPAIGN</span><h3>{onrampIntent?.status === 'escrowed' ? 'Donation protected in the campaign' : onrampIntent?.status === 'converted_to_account' ? 'Converted funds are waiting to be locked' : 'No converted payment is ready yet'}</h3><p>{onrampIntent ? 'Payment ' + formatInr(onrampIntent.amountInr) + ' · ' + (onrampIntent.status === 'checkout_open' ? 'waiting for the payment provider' : onrampIntent.status === 'converted_to_account' ? 'received by the organization account, not yet in escrow' : 'confirmed in the campaign contract') : 'A real UPI conversion will appear here after the provider confirms it.'}</p></div>{onrampIntent?.status === 'converted_to_account' && <button className="button button-dark" disabled={fundingEscrow || !onrampConfig?.escrowConfigured} onClick={fundCampaignEscrow}>{fundingEscrow ? 'Confirming deposit…' : 'Deposit into campaign'} <ArrowRight size={17}/></button>}</section><div className="ngo-top"><section className="panel wallet-panel"><div className="panel-header"><div><span className="eyebrow muted">ORGANIZATION ACCOUNT</span><h3>Harbor Hands Initiative</h3></div><span className="wallet-icon"><Wallet size={20}/></span></div><div className="wallet-display"><span>{walletAddress ? short(walletAddress, 20) : 'Secure account not connected'}</span><small>{walletAddress ? (walletChain === 'Ethereum mainnet' ? 'Live account connected' : 'Test account connected') : 'Optional: connect to inspect a live balance'}</small></div><button className="button button-dark full-button" onClick={connectWallet}>{walletAddress ? 'Reconnect organization account' : 'Connect organization account'} <ArrowRight size={17}/></button><div className="contract-read"><label htmlFor="contract-address">Advanced: account record ID for live balance</label><div><input id="contract-address" value={contractAddress} onChange={event => setContractAddress(event.target.value)} placeholder="0x…"/><button onClick={readContract}>Read</button></div>{contractBalance !== null && <p><CheckCircle2 size={15}/> Live account balance: {walletChain === 'Ethereum mainnet' ? rupees(contractBalance) : 'Test account — no INR value'}</p>}</div></section><section className="panel trust-panel"><div className="panel-header"><div><span className="eyebrow muted">TRUST-BASED SPENDING LIMIT</span><h3>Local payment limit</h3></div><span className="trust-score">{state.trust}<small>/100</small></span></div><div className="trust-big">{allowanceLeftLabel} <span>left for local payments</span></div><div className="progress-track"><div style={{ width: `${progressPercent}%` }}/></div><div className="progress-label"><span>{exposureLabel} already used</span><strong>{allowanceLabel} total limit</strong></div><p>A higher trust score allows more local spending. Donor reviews adjust the score. Reusing a receipt freezes new payments.</p><span className={`inline-status ${state.frozen ? 'danger' : ''}`}><span/>{state.frozen ? 'Paused — duplicate receipt' : 'Local payments available'}</span></section></div><div className="ngo-grid"><section className="panel form-panel"><div className="form-heading"><div className="number-step">1</div><div><h3>Request a local payment</h3><p>For suppliers who need payment in rupees.</p></div></div><label htmlFor="advance">Amount in rupees</label><div className="input-with-suffix"><input id="advance" type="number" min="1" step="1" value={advanceAmount} onChange={event => setAdvanceAmount(event.target.value)}/><span>₹</span></div><div className="form-hint"><LockKeyhole size={15}/> Limit today: {allowanceLeftLabel}</div><button className="button button-accent full-button" onClick={drawAdvance} disabled={state.frozen || !trustData}>Record demo payment <ArrowRight size={17}/></button><small className="action-disclaimer">Demo state only. No real money moves when you press this button.</small></section><section className="panel form-panel"><div className="form-heading"><div className="number-step">2</div><div><h3>Attach spending evidence</h3><p>Your receipt stays private; we save its fingerprint.</p></div></div><div className="form-row"><div><label htmlFor="vendor">Vendor name</label><input id="vendor" value={vendor} onChange={event => setVendor(event.target.value)} placeholder="e.g. Blue Coast Supplies"/></div><div><label htmlFor="invoice">Invoice ID</label><input id="invoice" value={invoice} onChange={event => setInvoice(event.target.value)} placeholder="e.g. BCS-071"/></div></div><div className="form-row"><div><label htmlFor="proof-amount">Receipt amount (rupees)</label><input id="proof-amount" type="number" min="1" step="1" value={proofAmount} onChange={event => setProofAmount(event.target.value)} placeholder="10000"/></div><div><label htmlFor="proof-title">Public title</label><input id="proof-title" value={proofTitle} onChange={event => setProofTitle(event.target.value)} placeholder="Water pump installation"/></div></div><label htmlFor="proof-summary">Public summary</label><textarea id="proof-summary" rows={3} value={proofSummary} onChange={event => setProofSummary(event.target.value)} placeholder="What was purchased and why? Emails, phone and long account numbers are hidden automatically."/><label className="upload-zone" htmlFor="proof-file"><UploadCloud size={22}/><strong>{proofFile ? proofFile.name : 'Choose a receipt file'}</strong><span>Checked in your browser. The file is not uploaded.</span><input id="proof-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" onChange={event => setProofFile(event.target.files?.[0] || null)}/></label><button className="button button-dark full-button" disabled={submitting || !trustData} onClick={submitProof}>{submitting ? 'Checking…' : 'Check and publish receipt summary'} <ArrowRight size={17}/></button><small className="action-disclaimer">Automated checks flag duplicates and inconsistencies; they cannot prove a receipt is authentic.</small></section></div><section className="panel demo-controls"><div><span className="eyebrow muted">ADVERSARIAL DEMO</span><h3>Show the judges an attack</h3><p>The same invoice used in two reports triggers a match and pauses new local payments in this demo.</p></div><button className="button button-danger" onClick={runAttack} disabled={state.frozen}><ShieldAlert size={18}/> Simulate duplicate receipt</button></section></>}
      </div>
    </main>
    {donateOpen && <div className="modal-backdrop" onClick={() => setDonateOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Donation checkout" onClick={event => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setDonateOpen(false)}><X size={19}/></button>
        <div className="modal-icon"><Heart size={24}/></div>
        <span className="eyebrow muted">NO CRYPTO APP NEEDED</span>
        <h2>Support clean water.</h2>
        <p>{onrampConfig?.configured ? 'Pay in rupees by UPI. The conversion provider may ask you to verify your identity. Your donation is only marked protected after the funds reach the campaign contract.' : 'Choose an amount to explore the demo. No payment is taken until a conversion provider is connected.'}</p>
        <div className="amount-grid">{[500, 1000, 2500, 5000].map(amount => <button key={amount} disabled={!!onrampIntent} className={donationAmount === amount ? 'selected' : ''} onClick={() => setDonationAmount(amount)}>{formatInr(amount)}</button>)}</div>
        <label htmlFor="donation-amount">Donation amount (rupees)</label>
        <div className="input-with-prefix"><span>₹</span><input id="donation-amount" type="number" min="100" max="20000" disabled={!!onrampIntent} value={donationAmount} onChange={event => setDonationAmount(Number(event.target.value))}/></div>
        {onrampConfig?.configured ? <>
          {!onrampIntent && <button className="button button-accent full-button" disabled={onrampBusy} onClick={startOnramp}>{onrampBusy ? 'Opening checkout…' : 'Continue to UPI checkout'} <ArrowRight size={18}/></button>}
          {onrampIntent && <div className="onramp-panel">{onrampIntent.status === 'checkout_open' && <div id="onmeta-checkout"/>}<div className="onramp-status"><strong>{onrampIntent.status === 'escrowed' ? 'Donation protected' : onrampIntent.status === 'converted_to_account' ? 'Conversion confirmed' : 'Waiting for provider confirmation'}</strong><span>{onrampIntent.status === 'escrowed' ? 'Funds are confirmed in the campaign contract.' : onrampIntent.status === 'converted_to_account' ? 'Funds reached the secure receiving account. They are not yet in campaign escrow.' : 'Payment and conversion must be confirmed by the provider before this donation can move forward.'}</span></div></div>}
        </> : <div className="provider-note"><Info size={16}/> Live UPI conversion is not connected yet. The demo below does not charge you.</div>}
        {onrampError && <div className="provider-error">{onrampError}</div>}
        <button className="demo-link" onClick={donate}>Try demo donation without paying <ArrowRight size={15}/></button>
      </div>
    </div>}
    {showReceipt && !donateOpen && <div className="receipt-toast"><button onClick={() => setShowReceipt(false)}><X size={16}/></button><CheckCircle2 size={23}/><div><strong>Demo receipt created</strong><span>Go to Proof room to cast your review vote.</span></div><button className="receipt-link" onClick={() => { setShowReceipt(false); navigate('proofs'); }}>View proofs <ArrowRight size={15}/></button></div>}
    {toast && <div className="toast"><Info size={17}/>{toast}<button onClick={() => setToast('')}><X size={15}/></button></div>}
  </div>;
}

function PageHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) { return <section className="page-heading"><span className="eyebrow muted">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></section>; }
function TrailList({ items, rate, detailed = false }: { items: TrailItem[]; rate: MarketRate | null; detailed?: boolean }) { const icons = { in: <ArrowDownLeft size={19}/>, move: <ArrowRight size={19}/>, offchain: <Banknote size={19}/>, proof: <FileCheck2 size={19}/>, alert: <ShieldAlert size={19}/> }; return <div className={`trail-list ${detailed ? 'detailed' : ''}`}>{items.map(item => <div className="trail-item" key={item.id}><div className={`trail-icon ${item.kind}`}>{icons[item.kind]}</div><div className="trail-body"><div className="trail-title-row"><strong>{item.title}</strong>{item.amount !== undefined && <span className="trail-amount">{item.amountCurrency === 'INR' ? formatInr(item.amount) : chainToInr(item.amount, rate)}</span>}</div><p>{item.detail}</p><div className="trail-meta"><span><Clock3 size={13}/>{item.date}</span>{item.ref && <span><Fingerprint size={13}/>{item.ref}</span>}{item.kind === 'alert' && <span className="alert-label">NEEDS ATTENTION</span>}</div></div></div>)}</div>; }
function ProofCard({ proof, donorId, rate, onVote, onDonate }: { proof: Proof; donorId?: string; rate: MarketRate | null; onVote: (id: string, yes: boolean) => void; onDonate: () => void }) {
  const voted = !!donorId && proof.votedBy.includes(donorId);
  const total = proof.yes + proof.no;
  return <article className="proof-card">
    <div className="proof-top"><div className={`proof-status ${proof.status}`}><span/>{proof.status === 'review' ? 'REVIEW OPEN' : proof.status === 'approved' ? 'COMMUNITY APPROVED' : 'NEEDS REVIEW'}</div><span className="proof-date">{proof.date}</span></div>
    <div className="proof-record-body">
      <div className="proof-record-story"><span className="proof-record-label">RECEIPT / {short(proof.id, 18)}</span><h3>{proof.title}</h3><div className="proof-meta"><span>{proof.category}</span><span>·</span><strong>{proof.fiatAmount ? formatInr(proof.fiatAmount) : chainToInr(proof.amount, rate)}</strong></div><p className="proof-summary">{proof.summary}</p><div className="commitment-box"><div><Fingerprint size={16}/><span>Document fingerprint</span></div><code title={proof.commitment}>{short(proof.commitment, 29)}</code><Copy size={15} className="copy-icon" onClick={() => navigator.clipboard?.writeText(proof.commitment)}/></div></div>
      <div className="proof-record-review"><div className="proof-checks"><div><strong>Automated checks / {proof.grade} of 100</strong></div>{proof.checks.map(check => <span key={check}><Check size={13}/>{check}</span>)}</div><div className="vote-section"><div className="vote-head"><span><Vote size={16}/> Donor review</span><strong>{total ? Math.round(proof.yes / total * 100) : 0}% reasonable</strong></div><div className="vote-bar"><div style={{ width: `${total ? proof.yes / total * 100 : 0}%` }}/></div><div className="vote-actions"><span>{proof.yes} fair · {proof.no} questioned</span>{proof.final ? <span className="closed-vote">Review closed</span> : voted ? <span className="closed-vote">Your vote counted</span> : !donorId ? <button onClick={onDonate}>Donate to review <ArrowRight size={14}/></button> : <div><button aria-label="Support expense" onClick={() => onVote(proof.id, true)}><ThumbsUp size={15}/> Fair</button><button aria-label="Question expense" onClick={() => onVote(proof.id, false)}><ThumbsDown size={15}/> Question</button></div>}</div></div></div>
    </div>
  </article>;
}
