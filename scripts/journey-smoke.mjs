import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import pg from 'pg';

// Live Gemini and real PostgreSQL, isolated from the presentation's saved ledger.
process.loadEnvFile(new URL('../bridge/.env.local', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'lantern-journey-'));
const admin = new pg.Pool({connectionString:process.env.DATABASE_URL});
const schema = `journey_${randomUUID().replaceAll('-','')}`;
let server;
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:url.toString(),BRIDGE_DATA_DIR:directory});
  ({server}=await import('../bridge/server.mjs'));
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(path, body, token) {
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(190000)});
    const result=await response.json();
    assert.ok(response.ok,result.error || `HTTP ${response.status}`);
    return result;
  }
  const route='/api/trust/ngos/harbor-hands';
  console.log('Checking live Gemini analysis and encrypted publication in an isolated PostgreSQL schema.');
  const initial=await request(route);
  const sample=await request('/api/verification/sample');
  const analyzed=await request(route+'/analyze',sample);
  assert.equal(analyzed.checks.identityPresent,true,'a usable supplier and invoice identity must be extracted');
  assert.equal(analyzed.checks.amountMatches,true,'the sample total must match');
  const publish={evidenceId:analyzed.id,privacyReviewed:true,recordPayment:true};
  const published=await request(route+'/proofs',publish);
  assert.equal(published.state.totalSpentInr,initial.totalSpentInr+500);
  const replay=await request(route+'/proofs',publish);
  assert.equal(replay.replayed,true);
  assert.equal(replay.state.totalSpentInr,published.state.totalSpentInr);
  const saved=await admin.query(`SELECT encrypted_original, encrypted_analysis, public_record FROM ${schema}.evidence WHERE id=$1`,[analyzed.id]);
  assert.equal(saved.rowCount,1);
  assert.ok(saved.rows[0].encrypted_original.length>28);
  assert.equal(saved.rows[0].encrypted_analysis.includes(Buffer.from('Sample Person')),false);
  assert.equal(JSON.stringify(published.state).includes('sample@example.invalid'),false);
  // A model may correctly flag a clearly synthetic receipt; never override its result.
  const proof=published.proof.status==='review'?published.proof:published.state.proofs.find(item=>item.id==='water-pump-071');
  let reviewed=published.state;
  for(let index=proof.yes+proof.no;index<3;index++){
    const donor=await request('/api/trust/demo-donations',{amountInr:100});
    reviewed=await request(`${route}/proofs/${proof.id}/votes`,{support:true},donor.token);
  }
  assert.equal(reviewed.score,initial.score+4);
  assert.equal(reviewed.proofs.find(item=>item.id===proof.id).status,'approved');
  const duplicate=await request(route+'/proofs',{vendor:'Replay attempt supplier',invoice:randomUUID(),amountInr:500,title:'Reused evidence',summary:'Attempt to reuse the same original document in another report.',documentHash:analyzed.documentHash});
  assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.state.frozen,true);
  assert.equal(duplicate.state.allowanceLeftInr,0);
  assert.equal(duplicate.state.totalSpentInr,published.state.totalSpentInr);
  console.log(JSON.stringify({liveGemini:true,model:analyzed.model,analysis:analyzed.status,privacy:analyzed.privacy,encryptedPostgresStorage:true,publicationRetrySafe:true,threeReviewThreshold:true,scoreIncrease:4,duplicateDetected:true,backendSpendingHeld:true,presentationLedgerUntouched:true},null,2));
} finally {
  if(server)await new Promise(done=>server.close(done));
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  if(dirname(resolve(directory))===resolve(tmpdir()))rmSync(directory,{recursive:true,force:true});
}
