import { useEffect, useState } from 'react';
import { recordAdvance, submitTrustProof, type TrustNgo, type TrustProof } from './trust';

export function VerificationNote({ proof }: { proof: TrustProof }) {
  const verification=proof.verification;
  if(!verification) return null;
  return <details className="verification-note"><summary>{verification.status === 'checks_passed' ? 'AI consistency checks passed' : 'AI flagged this receipt for review'}</summary><p>Receipt total {verification.checks.amountMatches ? 'matches the claim' : 'needs review'}. Campaign purpose {verification.checks.categoryMatches ? 'matches' : 'needs review'}. {verification.privacy === 'image_withheld' ? 'Photo withheld for privacy.' : 'Private details masked; uploader reviewed the preview.'}</p><small>{verification.limitation}</small></details>;
}

type Analysis = { id: string; amountInr: number; publicImage: string; privacy: string; status: string; title: string; summary: string; checks: { amountMatches: boolean; categoryMatches: boolean; readable: boolean; suspicious: boolean; identityPresent: boolean }; limitation: string };
export default function ReceiptVerifier({ onPublished }: { onPublished: (state: TrustNgo) => void }) {
  const [configured, setConfigured] = useState(false);
  const [amount, setAmount] = useState('');
  const [image, setImage] = useState('');
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { void fetch('/api/verification/config').then(r => r.json()).then(c => setConfigured(c.configured === true)).catch(() => undefined); }, []);
  async function selectFile(file?: File) {
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 6_000_000) { setMessage('Choose a receipt image smaller than 6 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { setImage(String(reader.result)); setFileName(file.name); setAnalysis(null); setReviewed(false); };
    reader.onerror = () => setMessage('Could not read that receipt.');
    reader.readAsDataURL(file);
  }
  async function analyze() {
    setBusy(true); setMessage('Gemini is extracting receipt fields and covering private details…');
    try {
      const response = await fetch('/api/trust/ngos/harbor-hands/analyze', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ image, amountInr: Number(amount) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Receipt analysis failed.');
      setAnalysis(body); setReviewed(false); setMessage('Review the redacted preview. The original is stored encrypted.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Receipt analysis failed.'); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!analysis || !reviewed) return;
    setBusy(true);
    try {
      if (!recorded) { await recordAdvance(analysis.amountInr); setRecorded(true); }
      const result = await submitTrustProof({ vendor: '', invoice: '', amountInr: analysis.amountInr, title: '', summary: '', documentHash: '', evidenceId: analysis.id, privacyReviewed: true });
      if (result.duplicate) { onPublished(result.state); setMessage('Duplicate receipt detected. Further local spending is paused.'); return; }
      setImage(''); setFileName(''); setAnalysis(null); setReviewed(false); setRecorded(false);
      onPublished(result.state);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not publish this receipt.'); }
    finally { setBusy(false); }
  }
  return <section className="gemini-panel" aria-label="Receipt verification">
    <div><span className="section-eyebrow">RECEIPT VERIFICATION</span><h2>Upload. Check. Privatize.</h2><p>Gemini reads the receipt and finds private details. You review the redacted copy before donors see it.</p></div>
    {!configured && <p className="verification-message">Add GEMINI_API_KEY in the backend settings and restart the bridge to enable analysis.</p>}
    <div className="verification-inputs"><label>Claimed amount in rupees<input type="number" min="1" disabled={recorded || busy} value={amount} onChange={e => { setAmount(e.target.value); setAnalysis(null); }}/></label>
      <label>Private receipt image<input type="file" accept="image/jpeg,image/png,image/webp" disabled={recorded || busy} onChange={e => void selectFile(e.target.files?.[0])}/><small>{fileName || 'JPG, PNG or WebP. Up to 6 MB.'}</small></label>
      <button className="dark-button" disabled={!configured || !image || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0 || busy || recorded} onClick={() => void analyze()}>{busy ? 'Working…' : 'Analyze and redact'}</button></div>
    {analysis && <div className="verification-result">
      {analysis.publicImage ? <img src={analysis.publicImage} alt="Automatically redacted receipt preview"/> : <p>Image withheld: the privacy check could not clear it for public display. Only the generic summary will be published.</p>}
      <div><h3>{analysis.status === 'checks_passed' ? 'Consistency checks passed' : 'Receipt needs review'}</h3><ul><li>Claimed amount: {analysis.checks.amountMatches ? 'matches INR receipt total' : 'does not match, or currency is different'}</li><li>Campaign purpose: {analysis.checks.categoryMatches ? 'matches' : 'needs review'}</li><li>Readable: {analysis.checks.readable ? 'yes' : 'no'}</li><li>Visible inconsistencies: {analysis.checks.suspicious ? 'flagged' : 'none reported'}</li></ul><p>{analysis.limitation}</p>
        <label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)}/> I reviewed the preview and no private details are visible.</label>
        <button className="dark-button" disabled={!reviewed || busy || !analysis.checks.identityPresent} onClick={() => void publish()}>Record payment and publish proof</button></div>
    </div>}
    {message && <p role="status" className="verification-message">{message}</p>}
    <small>The receipt is sent to Google's Gemini API for processing. Original files and extracted private fields stay encrypted on the backend. AI checks do not prove delivery.</small>
  </section>;
}
