import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TrustStore } from './trust.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'lantern-trust-'));
  const file = join(dir, 'trust.json');
  const store = new TrustStore(file);
  return { store, file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('server controls the limit, persists it, and rejects spending after a duplicate hold', () => {
  const { store, file, cleanup } = fixture();
  try {
    assert.equal(store.get('harbor-hands').allowanceInr, 152000);
    assert.throws(() => store.advance('harbor-hands', { amountInr: 122001 }), /exceeds/);
    const advanced = store.advance('harbor-hands', { amountInr: 10000 });
    assert.equal(advanced.exposureInr, 40000);
    const attack = store.demoAttack('harbor-hands');
    assert.equal(attack.duplicate, true);
    assert.equal(attack.state.frozen, true);
    assert.equal(attack.state.score, 56);
    assert.equal(store.demoAttack('harbor-hands').state.score, 56);
    assert.throws(() => store.advance('harbor-hands', { amountInr: 1 }), /paused/);
    assert.equal(new TrustStore(file).get('harbor-hands').frozen, true);
  } finally { cleanup(); }
});

test('new campaigns start empty and keep funding, donor rights and evidence separate',()=>{
  const {store,file,cleanup}=fixture();
  try{
    const original=store.get('harbor-hands');
    const created=store.createCampaign('harbor-hands',{name:'School water station',story:'Install a clean drinking water station for the village primary school.',category:'Water infrastructure',targetInr:50000});
    const id=created.campaign.id;
    assert.equal(created.campaign.fundraising.raisedInr,0);
    assert.equal(created.campaign.budgetInr,0);
    assert.equal(created.allowanceLeftInr,0);
    assert.equal(created.proofs.length,0);
    assert.equal(created.blockchain,null);
    assert.equal(new TrustStore(file).get('harbor-hands',undefined,id).campaign.name,'School water station');
    const donor=store.donor(10000,'harbor-hands',id);
    assert.equal(store.get('harbor-hands',undefined,id).campaign.fundraising.raisedInr,10000);
    assert.equal(store.get('harbor-hands').campaign.fundraising.raisedInr,original.campaign.fundraising.raisedInr);
    assert.throws(()=>store.vote('harbor-hands','water-pump-071',donor.token,true),/Only donors to this campaign/);
    store.advance('harbor-hands',{amountInr:500},id);
    const proof=store.proof('harbor-hands',{vendor:'School supplier',invoice:'SCHOOL-001',amountInr:500,title:'School water supplies',summary:'Water connectors purchased for the primary school station.',documentHash:`0x${'d'.repeat(64)}`},id);
    assert.equal(proof.state.campaign.id,id);
    assert.equal(proof.proof.status,'review');
    store.vote('harbor-hands',proof.proof.id,donor.token,true,id);
    const second=store.donor(100,'harbor-hands',id),third=store.donor(100,'harbor-hands',id);
    store.vote('harbor-hands',proof.proof.id,second.token,true,id);
    assert.equal(store.vote('harbor-hands',proof.proof.id,third.token,true,id).score,54);
    assert.equal(store.get('harbor-hands').score,original.score);
    assert.throws(()=>store.publishVerified('harbor-hands',{}, {analysis:{},publicRecord:{campaignId:'water-infrastructure'}},id),/another campaign/);
    const duplicate=store.proof('harbor-hands',{vendor:'Blue Coast Supplies',invoice:'BCS-071',amountInr:100,title:'Reused water receipt',summary:'Attempt to reuse an invoice from the original campaign.',documentHash:`0x${'e'.repeat(64)}`},id);
    assert.equal(duplicate.state.frozen,true);
    assert.equal(store.get('harbor-hands').frozen,false);
    assert.throws(()=>store.get('harbor-hands',undefined,'missing'),/Campaign not found/);
  }finally{cleanup();}
});

test('flagged receipts remain reviewable, including legacy records, without earning trust for unresolved checks',()=>{
  const {store,cleanup}=fixture();
  try{
    const result=store.proof('harbor-hands',{vendor:'Mismatch supplier',invoice:'MISMATCH-020',amountInr:20,title:'Tables receipt mismatch',summary:'This receipt is submitted for community dining tables.',documentHash:`0x${'f'.repeat(64)}`,verification:{id:'flagged-test',status:'needs_review',checks:{amountMatches:false,categoryMatches:true,readable:true,suspicious:false,identityPresent:true}}});
    const stored=store.campaign(store.ngo('harbor-hands')).proofs.find(p=>p.id===result.proof.id);
    assert.equal(result.proof.final,false);
    stored.final=true; // Legacy AI flags were incorrectly closed before any votes.
    assert.equal(store.get('harbor-hands').proofs.find(p=>p.id===stored.id).final,false);
    const startingScore=store.get('harbor-hands').score;
    for(const wallet of ['0x1','0x2','0x3']){const donor=store.walletDonor(wallet,11155111);store.vote('harbor-hands',stored.id,donor.token,true);}
    const state=store.get('harbor-hands'),proof=state.proofs.find(p=>p.id===stored.id);
    assert.equal(proof.yes,3);assert.equal(proof.final,true);assert.equal(proof.status,'flagged');
    assert.equal(state.score,startingScore);
    assert.equal(state.approvedSpendInr,20000,'a mismatched receipt does not clear expense exposure');
    const extra=store.walletDonor('0x4',11155111);
    assert.throws(()=>store.vote('harbor-hands',stored.id,extra.token,true),/closed/);
  }finally{cleanup();}
});

test('atomic receipt publication reserves once, detects new duplicate evidence before spending, and clears approved exposure',()=>{
  const {store,cleanup}=fixture();
  try{
    const record={analysis:{vendor:'Example supplier',invoice:'ATOMIC-001'},publicRecord:{id:'evidence-atomic-1',amountInr:500,title:'Water connector supplies',summary:'Water fittings purchased for the community water station.',documentHash:`0x${'c'.repeat(64)}`,publicImage:'',model:'test-model',status:'checks_passed',privacy:'image_withheld',checks:{amountMatches:true,categoryMatches:true,readable:true,suspicious:false,identityPresent:true}}};
    const initial=store.get('harbor-hands');
    const published=store.publishVerified('harbor-hands',{recordPayment:true},record);
    assert.equal(published.proof.status,'review');
    assert.equal(published.state.totalSpentInr,initial.totalSpentInr+500);
    const repeated=store.publishVerified('harbor-hands',{recordPayment:true},record);
    assert.equal(repeated.replayed,true);
    assert.equal(repeated.state.totalSpentInr,published.state.totalSpentInr);
    const accounts=['0x1','0x2','0x3'].map(wallet=>store.walletDonor(wallet,11155111));
    store.vote('harbor-hands',published.proof.id,accounts[0].token,true);
    const refreshed=store.walletDonor('0x1',11155111);
    assert.throws(()=>store.vote('harbor-hands',published.proof.id,refreshed.token,true),/already voted/);
    store.vote('harbor-hands',published.proof.id,accounts[1].token,true);
    const reviewed=store.vote('harbor-hands',published.proof.id,accounts[2].token,true);
    assert.equal(reviewed.score,initial.score+4);
    assert.equal(reviewed.outstandingInr,initial.outstandingInr);
    assert.equal(reviewed.proofs.find(item=>item.id===published.proof.id).walletVotes,3);
    const duplicate=store.publishVerified('harbor-hands',{recordPayment:true},{...record,publicRecord:{...record.publicRecord,id:'evidence-atomic-2'}});
    assert.equal(duplicate.duplicate,true);
    assert.equal(duplicate.state.totalSpentInr,reviewed.totalSpentInr);
    assert.equal(duplicate.state.frozen,true);
    assert.equal(duplicate.state.allowanceLeftInr,0);
  }finally{cleanup();}
});

test('receipt identities are global, private fields are absent, and unique demo donors change trust once', () => {
  const { store, file, cleanup } = fixture();
  try {
    const second = store.register({ name: 'River Aid', country: 'India', category: 'Water infrastructure', budgetInr: 100000 });
    const duplicate = store.proof(second.id, { vendor: ' Blue  Coast Supplies ', invoice: 'BCS-071', amountInr: 100, title: 'Duplicate pump', summary: 'A repeated invoice from another campaign', documentHash: `0x${'1'.repeat(64)}` });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.state.frozen, true);
    assert.equal(readFileSync(file, 'utf8').includes('Blue  Coast Supplies'), false);

    const first = store.donor(500);
    const otherNgoDonor = store.donor(500, second.id);
    assert.throws(() => store.vote('harbor-hands', 'water-pump-071', otherNgoDonor.token, true), /Only donors/);
    assert.throws(() => store.vote('harbor-hands', 'water-pump-071', first.token, 'yes'), /Choose fair/);
    const reviewed = store.vote('harbor-hands', 'water-pump-071', first.token, true);
    assert.equal(reviewed.score, 72);
    assert.equal(reviewed.proofs.find(item => item.id === 'water-pump-071').status, 'approved');
    assert.throws(() => store.vote('harbor-hands', 'water-pump-071', first.token, true), /closed/);
    assert.equal(JSON.stringify(reviewed).includes('tokenHash'), false);
  } finally { cleanup(); }
});

test('funding request, donation, public photo, and trust history survive reload without publishing private receipt fields', () => {
  const { store, file, cleanup } = fixture();
  try {
    const requested = store.requestFunding('harbor-hands', { name: 'Community water station', story: 'Fund the next water station for families in the coastal area.', targetInr: 1_600_000 });
    assert.equal(requested.campaign.fundraising.targetInr, 1_600_000);
    const donor = store.donor(750);
    assert.equal(store.get('harbor-hands').campaign.fundraising.raisedInr, 1_000_750);
    const photo = 'data:image/jpeg;base64,' + Buffer.from('redacted sample image').toString('base64');
    const result = store.proof('harbor-hands', { vendor: 'Example supplier', invoice: 'INV-099', amountInr: 1000, title: 'Pipe fittings', summary: 'Supplies delivered to the community water station.', documentHash: `0x${'b'.repeat(64)}`, publicImage: photo });
    assert.equal(result.duplicate, false);
    assert.equal(result.proof.publicImage, photo);
    assert.equal(JSON.stringify(result.state).includes('Example supplier'), false);
    assert.equal(JSON.stringify(result.state).includes('INV-099'), false);
    const voted = store.vote('harbor-hands', 'water-pump-071', donor.token, true);
    assert.equal(voted.scoreHistory[0].score, 72);
    const reloaded = new TrustStore(file).get('harbor-hands');
    assert.equal(reloaded.campaign.fundraising.raisedInr, 1_000_750);
    assert.equal(reloaded.proofs[0].publicImage, photo);
  } finally { cleanup(); }
});
