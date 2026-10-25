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
    assert.throws(() => store.advance('harbor-hands', { amountInr: 102001 }), /exceeds/);
    const advanced = store.advance('harbor-hands', { amountInr: 10000 });
    assert.equal(advanced.exposureInr, 60000);
    const attack = store.demoAttack('harbor-hands');
    assert.equal(attack.duplicate, true);
    assert.equal(attack.state.frozen, true);
    assert.equal(attack.state.score, 56);
    assert.equal(store.demoAttack('harbor-hands').state.score, 56);
    assert.throws(() => store.advance('harbor-hands', { amountInr: 1 }), /paused/);
    assert.equal(new TrustStore(file).get('harbor-hands').frozen, true);
  } finally { cleanup(); }
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
    assert.throws(() => store.vote('harbor-hands', 'water-pump-071', first.token, 'yes'), /Choose fair/);
    const reviewed = store.vote('harbor-hands', 'water-pump-071', first.token, true);
    assert.equal(reviewed.score, 72);
    assert.equal(reviewed.proofs.find(item => item.id === 'water-pump-071').status, 'approved');
    assert.throws(() => store.vote('harbor-hands', 'water-pump-071', first.token, true), /closed/);
    assert.equal(JSON.stringify(reviewed).includes('tokenHash'), false);
  } finally { cleanup(); }
});
