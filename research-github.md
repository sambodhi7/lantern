# GitHub research for The Black Hole Ledger

Research date: 25 October 2026. Public repository descriptions and selected source files were read. No repository code was executed, and this is not a security audit. This is a targeted comparison, not an exhaustive novelty search. A repository's claims of deployment, security, or awards are not independently verified here unless stated.

## Findings that change the pitch

- Outcome-conditioned escrow already exists in Alice's source code.
- Crisis Chain already implements receipt, location, peer, and beneficiary signals with a weighted score that can automatically trigger reimbursement. Therefore, “multiple signals + confidence score + automatic release” should not be presented as an unprecedented invention.
- ZKP2P already uses payment proofs/attestations and a payment-nullifier registry for fiat/crypto settlement. A payment nullifier is an established primitive.
- The useful project opportunity is the integration: connect supported multi-hop flows to authenticated evidence; distinguish independent sources from repeated assertions; enforce expense attribution across donor reports; produce a specific, reproducible explanation for each hold or fraud finding. This is a design recommendation, not an established claim of uniqueness.

## 1. Crisis Chain — closest application comparator

[Repository](https://github.com/aikhanjum/crisis-chain). Source snapshot inspected: `405420a14ee8828acc881c49b80356a684c5c47b`.

[ProofOfDelivery.sol](https://github.com/aikhanjum/crisis-chain/blob/405420a14ee8828acc881c49b80356a684c5c47b/contracts/src/ProofOfDelivery.sol) implements `submitClaim`, `attestOracle`, `attestPeer`, `attestBeneficiary`, and `_checkAndPayout`. Receipt and geographic oracles, a peer NGO, and beneficiary attestations contribute configurable weights. Crossing a threshold calls the vault. This directly overlaps the pasted proposal's confidence-based release idea.

Observed boundary: oracle submissions require `ORACLE_ROLE`; peer submissions require a credential; beneficiary submissions exclude the claiming NGO and repeated addresses but do not establish beneficiary eligibility in that function. Distinct addresses alone do not establish distinct real recipients. The file does not consume a receipt globally when claims are submitted. These observations describe the inspected contract, not every deployment or external service.

[EIP712Reimbursement.sol](https://github.com/aikhanjum/crisis-chain/blob/405420a14ee8828acc881c49b80356a684c5c47b/contracts/src/EIP712Reimbursement.sol) provides `executeApproval`: a typed approval binds pool, recipient, amount, payout reference, nonce, and deadline. It recovers the signer, checks the approver role and nonce, then calls the vault. This is useful prior art for authenticated, relayed submissions and replay protection; it is an authorization proof, not proof of a purchase.

[CrisisPoolVault.sol](https://github.com/aikhanjum/crisis-chain/blob/405420a14ee8828acc881c49b80356a684c5c47b/contracts/src/CrisisPoolVault.sol) provides pooled token donations and role-gated payouts. It includes a recipient cooldown and minimum reserve, with explicit admin bypasses. `payoutRef` is emitted but is not checked against a consumed-reference mapping in this file. All three inspected files declare MIT licensing. Do not infer production security from their presence.

Use as a comparator and a source of small patterns. For a 12-hour build, copying the entire application would introduce unnecessary integration work. The repository describes itself as an award winner; that award was not independently verified and should not be repeated as established fact.

## 2. Alice 2.0 — outcome agreements and escrow are established

[Repository](https://github.com/alice-si/alice-v2-monorepo). Source snapshot inspected: `6a3377eeb456145723c03f72999dce329281ef32`.

[Ida.sol](https://github.com/alice-si/alice-v2-monorepo/blob/6a3377eeb456145723c03f72999dce329281ef32/contracts/Ida.sol) implements funding, report registration, promise validation, rejection, and refunds. `validatePromise` is restricted by `onlyValidator`; it approves the claim and calls `escrow.unlock(promisePrice)`. This is concrete prior art for releasing funding against validated outcomes. Its validator address is a disclosed trust boundary.

[ClaimsRegistry.sol](https://github.com/alice-si/alice-v2-monorepo/blob/6a3377eeb456145723c03f72999dce329281ef32/contracts/ClaimsRegistry.sol) stores issuer/subject/key claims and approvals. Its methods include `setClaim`, `removeClaim`, `approveClaim`, and `isApproved`. It is useful for understanding explicit claim and approval separation; registry membership or approval alone does not independently establish physical delivery.

The repository reports GPL-3.0 licensing, and inspected contracts target Solidity `^0.5.2`. Treat it as architectural prior art, not a modern contract dependency to adopt casually during a 12-hour hackathon. Current production operation was not verified.

## 3. Semaphore — reusable private participation

[Repository and contract](https://github.com/semaphore-protocol/semaphore/blob/main/packages/contracts/contracts/Semaphore.sol), [license](https://github.com/semaphore-protocol/semaphore/blob/main/LICENSE).

Inspected `validateProof(groupId, proof)`: it checks whether the nullifier has already been used in that group, verifies the proof, stores the nullifier, and emits the validated proof event. `verifyProof` also checks group existence and acceptable Merkle roots. Group management determines who is eligible. The repository license is MIT.

Good fit: a privately enrolled recipient proves eligibility to submit one acknowledgement or challenge within a chosen scope. Bound the proof message to the intended claim and action.

Boundary: this does not authenticate invoices or guarantee that registered identities represent different humans. Its nullifier state is group-scoped, so it is not automatically a cross-campaign receipt registry. Designing scope and enrollment correctly remains the application's job.

12-hour advice: use an existing example/package only if the team already has a working toolchain. Do not combine first-time identity enrollment, a custom receipt circuit, and multiple proving systems in the critical demo path.

## 4. UMA Optimistic Oracle V3 — dispute mechanism, not a truth sensor

[Inspected implementation](https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/optimistic-oracle-v3/implementation/OptimisticOracleV3.sol).

`assertTruth` creates a bonded assertion with a liveness interval and optional callbacks/escalation manager. `disputeAssertion` accepts a challenge during the interval. `settleAssertion` accepts an unchallenged assertion after expiry, or uses the configured oracle result for a disputed assertion. Settlement invokes callbacks. The source header declares `AGPL-3.0-only`.

Good fit: explicitly defined factual disputes with evidence that challengers and the resolver can actually access. A callback can update milestone status.

Boundary: “unchallenged” is a settlement rule, not mathematical evidence that delivery occurred. Confidential evidence needs a workable disclosure/resolution policy. A configured escalation manager changes the trust model.

12-hour advice: a complete live resolution may exceed the presentation window. Keep any local mock or time-advanced demo visibly labeled; do not describe it as a real decentralized resolution.

## 5. ZKP2P — strongest payment-proof integration reference

[Repository](https://github.com/zkp2p/zkp2p-contracts), [inspected NullifierRegistryV2.sol](https://github.com/zkp2p/zkp2p-contracts/blob/main/contracts/registries/NullifierRegistryV2.sol).

The README describes fiat-payment attestation verification before crypto settlement. In the inspected registry, `addNullifier` is restricted to authorized writers, rejects already-used payment nullifiers, and binds one nullifier to one intent in both directions. `isNullified` also reads the predecessor registry. Writer authorization is owner-controlled. The file declares MIT licensing.

Useful pattern: authenticated payment evidence must be tied to a specific settlement intent, and replay history must survive registry migrations. This is more relevant to the fiat boundary than perceptual receipt hashes.

Boundary: the registry itself does not verify a bank payment; authorized verifier contracts must do that. Payment settlement also does not prove what goods were delivered. No claim of universal bank/off-ramp coverage is established here.

12-hour advice: study the interface and boundary; do not import its entire production stack. Use one supported payment-proof route if already available, or an explicitly labeled signed-provider sandbox for the demo.

## Scope recommendation for the now-known 12-hour limit

Build one traceable scenario end to end: donation, supported swap/bridge evidence, signed fiat-provider sandbox record, expense claim, duplicate or contradiction detection, and an actual persisted escrow hold. Clearly identify sandbox events and mocked external attestations.

The distinctive demo should let judges inspect the reason for a decision and attempt an attack. Show valid shared attribution, an authorized overclaim, a refund correction, and a harmless outsider replay. A single demonstrated invariant and a comprehensible evidence trail are more credible than ten unverified integrations.

Keep custom ZK receipt circuits, a new Bayesian calibration dataset, multiple live bridges, generic bank scraping, passkey account abstraction, and full oracle disputes off the critical path unless already working. They can remain explicitly scoped extensions in the complete design.
