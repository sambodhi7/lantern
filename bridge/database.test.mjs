import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from './database.mjs';
import { TrustStore } from './trust.mjs';

test('PostgreSQL transactions serialize simultaneous claims and survive a fresh connection', {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const db=new Database(process.env.TEST_DATABASE_URL), schema=`test_${randomUUID().replaceAll('-','')}`;
  await db.pool.query(`CREATE SCHEMA ${schema}`);
  // Every pool connection gets the same isolated schema.
  await db.close();
  const url=new URL(process.env.TEST_DATABASE_URL); url.searchParams.set('options',`-c search_path=${schema}`);
  const first=new Database(url.toString()), second=new Database(url.toString());
  try {
    const a=new TrustStore(null), b=new TrustStore(null), ai=new Map(), bi=new Map();
    await first.init(a,ai); await second.init(b,bi);
    await Promise.all([first.run(a,ai,()=>a.donor(500)),second.run(b,bi,()=>b.donor(750))]);
    await second.run(b,bi,()=>assert.equal(b.get('harbor-hands').campaign.fundraising.raisedInr,1001250));
    await assert.rejects(first.run(a,ai,()=>{a.donor(900);throw new Error('abort transaction');}),/abort transaction/);
    await second.run(b,bi,()=>assert.equal(b.get('harbor-hands').campaign.fundraising.raisedInr,1001250));
    await Promise.all([first.run(a,ai,()=>a.demoAttack('harbor-hands')),second.run(b,bi,()=>b.demoAttack('harbor-hands'))]);
    await second.run(b,bi,()=>{assert.equal(b.get('harbor-hands').score,56);assert.equal(b.get('harbor-hands').scoreHistory.filter(i=>i.delta===-12).length,1);});
  } finally {
    await second.close();
    await first.pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await first.close();
  }
});
