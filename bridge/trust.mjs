import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const clamp = value => Math.max(0, Math.min(100, value));
const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
const keyText = value => clean(value).toLowerCase();
const redact = value => clean(value)
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email hidden]')
  .replace(/\b(?:\+?\d[\d\s().-]{8,}\d)\b/g, '[phone hidden]')
  .replace(/\b\d{10,18}\b/g, '[account hidden]');
const money = value => Number.isSafeInteger(value) && value > 0 && value <= 20_000_000;
const now = () => new Date().toISOString();
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };

export class TrustStore {
  constructor(file) {
    this.file = file;
    if (!file) { this.data = this.seed(); return; }
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) { this.data = JSON.parse(readFileSync(file, 'utf8')); this.migrate(); }
    else { this.data = this.seed(); this.save(); }
  }
  digest(value) { return createHmac('sha256', this.data.fingerprintKey).update(value).digest('hex'); }
  seed() {
    const fingerprintKey = randomBytes(32).toString('hex');
    const digest = value => createHmac('sha256', fingerprintKey).update(value).digest('hex');
    return {
      version: 2, fingerprintKey, donors: [],
      ngos: [{
        id: 'harbor-hands', name: 'Harbor Hands Initiative', country: 'Kenya', walletAddress: '',
        campaigns: [{ id: 'water-infrastructure', name: 'Clean water for coastal Kenya', category: 'Water infrastructure', budgetInr: 1_000_000, score: 68, hold: null,
          fundraising: { targetInr: 1_500_000, raisedInr: 1_000_000, story: 'Help fund a reliable water point and pipe network for coastal communities. Follow each local payment and the evidence submitted for it.', status: 'open', requestedAt: now() },
          scoreHistory: [{ id: randomUUID(), score: 68, delta: 0, reason: 'Starting reputation for this demo', createdAt: now() }],
          advances: [{ id: 'seed-advance', amountInr: 50_000, createdAt: now(), demo: true }],
          proofs: [
            { id: 'water-pump-071', title: 'Water pump and pipe fittings', summary: 'Purchased a pump and pipe fittings for the coastal water station. Personal details are hidden.', category: 'Water infrastructure', amountInr: 30_000, invoiceKey: digest('blue coast supplies|bcs-071'), documentKey: '', commitment: `0x${digest('seed|bcs-071')}`, publicImage: '/proof-water-pump.png', grade: 91, checks: ['Invoice identity registered', 'Category matches campaign'], status: 'review', yes: 2, no: 0, final: false, voters: ['sample-donor-1', 'sample-donor-2'], createdAt: now(), demo: true },
            { id: 'drilling-042', title: 'Borehole drilling services', summary: 'Drilling work completed at the community site. Beneficiary details are hidden.', category: 'Water infrastructure', amountInr: 20_000, invoiceKey: digest('tana drilling|td-042'), documentKey: '', commitment: `0x${digest('seed|td-042')}`, grade: 86, checks: ['Invoice identity registered', 'Category matches campaign'], status: 'approved', yes: 12, no: 2, final: true, voters: [], createdAt: now(), demo: true },
          ],
          events: [
            { id: randomUUID(), type: 'proof', title: 'Pump receipt submitted', detail: 'Sample public photo and redacted spending summary.', amountInr: 30_000, createdAt: now(), demo: true },
            { id: randomUUID(), type: 'proof', title: 'Drilling receipt submitted', detail: 'Sample record for drilling work.', amountInr: 20_000, createdAt: now(), demo: true },
            { id: randomUUID(), type: 'advance', title: 'Local payment recorded', detail: 'Synthetic advance to local suppliers.', amountInr: 50_000, createdAt: now(), demo: true },
            { id: randomUUID(), type: 'donation', title: 'Campaign funds raised', detail: 'Synthetic starting balance for the demo.', amountInr: 1_000_000, createdAt: now(), demo: true },
          ],
        }],
      }],
    };
  }
  migrate() {
    if (this.data.version >= 2) return;
    for (const ngo of this.data.ngos) for (const campaign of ngo.campaigns) {
      campaign.fundraising ||= { targetInr: Math.max(campaign.budgetInr, 1_500_000), raisedInr: campaign.budgetInr, story: ngo.id === 'harbor-hands' ? 'Help fund a reliable water point and pipe network for coastal communities. Follow each local payment and the evidence submitted for it.' : `Support ${campaign.name}. Follow the payments and evidence.`, status: 'open', requestedAt: now() };
      campaign.scoreHistory ||= [{ id: randomUUID(), score: campaign.score, delta: 0, reason: 'Starting reputation for this demo', createdAt: now() }];
      if (ngo.id === 'harbor-hands') {
        const pump = campaign.proofs.find(item => item.id === 'water-pump-071');
        if (pump) pump.publicImage ||= '/proof-water-pump.png';
        if (campaign.events.length === 1 && campaign.events[0].type === 'seed') campaign.events = this.seed().ngos[0].campaigns[0].events;
      }
    }
    this.data.version = 2; this.save();
  }
  save() { if (!this.file) return; const temporary = `${this.file}.tmp`; writeFileSync(temporary, JSON.stringify(this.data, null, 2)); renameSync(temporary, this.file); }
  reset() { this.data = this.seed(); this.save(); return this.get('harbor-hands'); }
  ngo(id) { const ngo = this.data.ngos.find(item => item.id === id); if (!ngo) fail(404, 'NGO not found.'); return ngo; }
  campaign(ngo) { return ngo.campaigns[0]; }
  allowance(campaign) { return Math.floor(campaign.budgetInr * (0.05 + campaign.score * 0.0015)); }
  publicProof(proof, donorId) {
    const { invoiceKey, documentKey, voters, ...visible } = proof;
    return { ...visible, voted: Boolean(donorId && voters.includes(donorId)) };
  }
  get(id, donorId) {
    const ngo = this.ngo(id), campaign = this.campaign(ngo);
    const exposureInr = campaign.advances.reduce((sum, item) => sum + item.amountInr, 0);
    const allowanceInr = this.allowance(campaign);
    return { id: ngo.id, name: ngo.name, country: ngo.country, walletAddress: ngo.walletAddress,
      campaign: { id: campaign.id, name: campaign.name, category: campaign.category, budgetInr: campaign.budgetInr, fundraising: campaign.fundraising },
      score: campaign.score, hold: campaign.hold, frozen: Boolean(campaign.hold), allowanceInr, exposureInr,
      allowanceLeftInr: Math.max(0, Math.min(allowanceInr - exposureInr, campaign.budgetInr - exposureInr)),
      proofs: campaign.proofs.map(item => this.publicProof(item, donorId)),
      advances: campaign.advances.map(({ id: advanceId, amountInr, createdAt, demo }) => ({ id: advanceId, amountInr, createdAt, demo })),
      events: campaign.events, scoreHistory: campaign.scoreHistory,
      reputation: { approved: campaign.proofs.filter(item => item.status === 'approved').length, open: campaign.proofs.filter(item => item.status === 'review').length, flagged: campaign.proofs.filter(item => item.status === 'flagged').length },
      demo: true,
    };
  }
  list() { return this.data.ngos.map(ngo => this.get(ngo.id)); }
  register(input) {
    const name = clean(input.name), country = clean(input.country), category = clean(input.category || 'General');
    const budgetInr = Number(input.budgetInr);
    if (name.length < 3 || name.length > 100 || country.length < 2 || country.length > 80 || category.length > 80 || !money(budgetInr)) fail(400, 'Enter a valid NGO name, country, category, and positive rupee budget.');
    const id = randomUUID();
    this.data.ngos.push({ id, name, country, walletAddress: /^0x[\da-f]{40}$/i.test(input.walletAddress || '') ? input.walletAddress : '', campaigns: [{ id: randomUUID(), name: clean(input.campaignName || name), category, budgetInr, score: 50, hold: null, fundraising: { targetInr: budgetInr, raisedInr: budgetInr, story: `Support ${name}. Follow the payments and evidence.`, status: 'open', requestedAt: now() }, scoreHistory: [{ id: randomUUID(), score: 50, delta: 0, reason: 'New NGO demo profile', createdAt: now() }], advances: [], proofs: [], events: [] }] });
    this.save(); return this.get(id);
  }
  requestFunding(id, input) {
    const campaign = this.campaign(this.ngo(id));
    const name = redact(input.name), story = redact(input.story), targetInr = Number(input.targetInr);
    if (name.length < 8 || name.length > 120 || story.length < 30 || story.length > 1200 || !money(targetInr) || targetInr < campaign.fundraising.raisedInr) fail(400, 'Enter a campaign name, a description of at least 30 characters, and a target above funds already raised.');
    campaign.name = name;
    campaign.fundraising = { ...campaign.fundraising, targetInr, story, requestedAt: now() };
    campaign.events.unshift({ id: randomUUID(), type: 'request', title: 'Funding request updated', detail: 'NGO updated the public campaign request.', createdAt: now(), demo: true });
    this.save(); return this.get(id);
  }
  advance(id, input) {
    const ngo = this.ngo(id), campaign = this.campaign(ngo), amountInr = Number(input.amountInr);
    if (!money(amountInr)) fail(400, 'Enter a positive whole-rupee amount.');
    if (campaign.hold) fail(423, 'Local payments are paused: ' + campaign.hold.reason);
    const exposure = campaign.advances.reduce((sum, item) => sum + item.amountInr, 0);
    if (amountInr > this.allowance(campaign) - exposure || amountInr > campaign.budgetInr - exposure) fail(422, 'This payment exceeds the current trust-based limit.');
    const advance = { id: randomUUID(), amountInr, createdAt: now(), demo: true };
    campaign.advances.push(advance);
    campaign.events.unshift({ id: randomUUID(), type: 'advance', title: 'Local payment recorded', detail: `₹${amountInr.toLocaleString('en-IN')} reserved within trust limit. Demo only.`, amountInr, createdAt: now() });
    this.save(); return this.get(id);
  }
  proof(id, input) {
    const ngo = this.ngo(id), campaign = this.campaign(ngo);
    const vendor = keyText(input.vendor), invoice = keyText(input.invoice), amountInr = Number(input.amountInr);
    const title = redact(input.title), summary = redact(input.summary), category = clean(input.category || campaign.category);
    const documentHash = clean(input.documentHash).toLowerCase();
    const publicImage = String(input.publicImage || '');
    if (vendor.length < 2 || vendor.length > 120 || invoice.length < 2 || invoice.length > 120 || !money(amountInr) || title.length < 3 || title.length > 120 || summary.length < 12 || summary.length > 1000) fail(400, 'Complete the receipt details and public summary.');
    if (documentHash && !/^0x[\da-f]{64}$/.test(documentHash)) fail(400, 'Invalid document fingerprint.');
    if (publicImage && (publicImage.length > 450_000 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(publicImage))) fail(400, 'Public image must be a small redacted JPEG, PNG, or WebP.');
    const invoiceKey = this.digest(`${vendor}|${invoice}`);
    const documentKey = documentHash ? this.digest(documentHash) : '';
    const duplicate = this.data.ngos.flatMap(item => item.campaigns).flatMap(item => item.proofs).find(item => item.invoiceKey === invoiceKey || (documentKey && item.documentKey === documentKey));
    if (duplicate) {
      if (!campaign.hold) {
        campaign.hold = { reason: 'Repeated invoice or document fingerprint', proofId: duplicate.id, createdAt: now(), scope: 'demo-local-advances' };
        campaign.events.unshift({ id: randomUUID(), type: 'hold', title: 'Duplicate evidence detected', detail: `A receipt identity was already used in proof ${duplicate.id}. New local advances paused in the demo.`, amountInr, createdAt: now() });
        campaign.score = clamp(campaign.score - 12);
        campaign.scoreHistory.unshift({ id: randomUUID(), score: campaign.score, delta: -12, reason: 'Duplicate receipt identity', createdAt: now() });
        this.save();
      }
      return { duplicate: true, state: this.get(id) };
    }
    const provedTotal = campaign.proofs.reduce((sum, item) => sum + item.amountInr, 0);
    const advancedTotal = campaign.advances.reduce((sum, item) => sum + item.amountInr, 0);
    const overclaim = provedTotal + amountInr > advancedTotal;
    const wrongCategory = keyText(category) !== keyText(campaign.category);
    const checks = ['Invoice identity unique across NGOs and campaigns', documentHash ? 'Document fingerprint recorded' : 'No document fingerprint supplied', wrongCategory ? 'Category differs from campaign' : 'Category matches campaign', overclaim ? 'Claim exceeds recorded local payments' : 'Claim fits recorded local payments'];
    const grade = clamp(95 - (documentHash ? 0 : 20) - (overclaim ? 35 : 0) - (wrongCategory ? 30 : 0) - (summary.length < 35 ? 15 : 0));
    const flagged = overclaim || wrongCategory || !documentHash || grade < 70 || input.verification?.status === 'needs_review';
    const proof = { id: randomUUID(), title, summary, category, amountInr, invoiceKey, documentKey, commitment: `0x${this.digest(`${invoiceKey}|${amountInr}|${category}`)}`, publicImage, grade, checks, status: flagged ? 'flagged' : 'review', yes: 0, no: 0, final: flagged, voters: [], createdAt: now(), demo: true };
    campaign.proofs.unshift(proof);
    if (input.verification) {
      proof.evidenceId = input.verification.id;
      proof.verification = { model: input.verification.model, status: input.verification.status, privacy: input.verification.privacy, checks: input.verification.checks, limitation: input.verification.limitation };
    }
    campaign.events.unshift({ id: randomUUID(), type: flagged ? 'flag' : 'proof', title: flagged ? 'Receipt needs review' : 'Receipt fingerprint published', detail: flagged ? 'Consistency checks flagged the submission.' : 'Only a redacted summary and commitment are public.', amountInr, createdAt: now() });
    this.save(); return { duplicate: false, proof: this.publicProof(proof), state: this.get(id) };
  }
  donor(amountInr, ngoId = 'harbor-hands') {
    if (!money(amountInr)) fail(400, 'Enter a positive whole-rupee demo donation.');
    const campaign = this.campaign(this.ngo(ngoId));
    const token = randomBytes(32).toString('hex');
    const donor = { id: randomUUID(), tokenHash: this.digest(token), ngoId, amountInr, createdAt: now(), demo: true };
    this.data.donors.push(donor);
    campaign.budgetInr += amountInr;
    campaign.fundraising.raisedInr += amountInr;
    campaign.events.unshift({ id: randomUUID(), type: 'donation', title: 'Demo donation added', detail: 'Simulated contribution; no money was charged.', amountInr, createdAt: now(), demo: true });
    this.save();
    return { donorId: donor.id, token, amountInr, demo: true };
  }
  creditPayment(intentId, amountInr, transaction) {
    const campaign = this.campaign(this.ngo('harbor-hands'));
    campaign.creditedPayments ||= [];
    if (campaign.creditedPayments.includes(intentId)) return;
    campaign.creditedPayments.push(intentId);
    campaign.budgetInr += amountInr;
    campaign.fundraising.raisedInr += amountInr;
    campaign.events.unshift({ id: randomUUID(), type: 'donation', title: 'Campaign deposit confirmed', detail: 'Provider conversion and campaign deposit independently verified on-chain.', amountInr, transaction, createdAt: now(), demo: false });
    this.save();
  }
  findDonor(token) {
    if (!/^[\da-f]{64}$/.test(token || '')) fail(401, 'A demo donation token is required to vote.');
    const digest = Buffer.from(this.digest(token), 'hex');
    const donor = this.data.donors.find(item => timingSafeEqual(Buffer.from(item.tokenHash, 'hex'), digest));
    if (!donor) fail(401, 'Demo donation token is invalid.');
    return donor;
  }
  vote(id, proofId, token, support) {
    const donor = this.findDonor(token), campaign = this.campaign(this.ngo(id));
    if (donor.ngoId !== id) fail(403, 'Only donors to this NGO can review its receipts.');
    const proof = campaign.proofs.find(item => item.id === proofId);
    if (!proof) fail(404, 'Receipt not found.');
    if (proof.final) fail(409, 'This review is closed.');
    if (proof.voters.includes(donor.id)) fail(409, 'This donation has already voted on this receipt.');
    if (typeof support !== 'boolean') fail(400, 'Choose fair or question.');
    proof.voters.push(donor.id);
    if (support) proof.yes++; else proof.no++;
    if (proof.voters.length >= 3) {
      proof.final = true;
      const approved = proof.yes / (proof.yes + proof.no) >= 0.7;
      proof.status = approved ? 'approved' : 'flagged';
      campaign.score = clamp(campaign.score + (approved ? 4 : -6));
      campaign.scoreHistory.unshift({ id: randomUUID(), score: campaign.score, delta: approved ? 4 : -6, reason: approved ? 'Positive donor review' : 'Donors questioned a receipt', createdAt: now() });
      campaign.events.unshift({ id: randomUUID(), type: 'vote', title: approved ? 'Donor review raised trust' : 'Donor review reduced trust', detail: `${proof.yes} fair, ${proof.no} questioned. Score ${approved ? '+4' : '-6'}. Demo votes.`, createdAt: now() });
    }
    this.save(); return this.get(id, donor.id);
  }
  demoAttack(id) { return this.proof(id, { vendor: 'Blue Coast Supplies', invoice: 'BCS-071', amountInr: 30_000, title: 'Reused pump invoice', summary: 'The same invoice is submitted again for another donor report.', documentHash: `0x${'a'.repeat(64)}` }); }
}

export function trustStoreFromEnvironment() { return new TrustStore(join(process.env.BRIDGE_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '.data'), 'trust.json')); }
