# Existing solutions relevant to the Black Hole Ledger

Research date: 25 October 2026. Sources are the projects' own documentation, repositories, and official organizational publications. This is a focused comparison, not an exhaustive novelty search or a security audit. A feature not established in these sources is marked as unverified rather than presumed absent.

## What the research changes

Donation tracing, conditional escrow, independent attestations, and aid deduplication all have substantial prior art. A credible hackathon pitch should claim a specific integration and demonstrable security properties, rather than that nobody has used these technologies for charity. The strongest proposed combination is cross-chain fund reconstruction plus authenticated off-chain evidence, private allocation accounting, explicit uncertainty, and contract-enforced responses to proven contradictions.

## WFP Building Blocks

**Verified:** WFP describes a privately managed blockchain network connecting humanitarian organizations, with member organizations sharing ownership and management. It coordinates assistance across organizations and detects unintended overlaps. Its 2026 innovations article describes privacy protection and use across Ukraine, Syria, and Palestine. The older landing page and newer articles contain different operational totals; avoid combining those totals as one contemporaneous measurement. [WFP product page](https://www.wfp.org/building-blocks), [WFP 2026 innovations article](https://www.wfp.org/stories/5-innovations-transforming-how-wfp-delivers-food-assistance).

**Code access:** The product page offers code and knowledge to reputable humanitarian organizations that join. That statement does not establish a generally accessible public GitHub codebase. No authoritative public application repository was verified in this research.

**Relevance:** Shared humanitarian records and duplication prevention are established. These sources do not establish a public, permissionless receipt-nullifier registry across arbitrary crypto chains and fiat off-ramps. Treat that as a boundary of this research, not proof that the organization has no such capability.

## Giveth: distinguish current product from historical TRACE

**Current product:** Official verification guidance says a project can become Verified through three attestations from Giveth Verifiers or team approval. GIVbacks eligibility has additional team review. The guidance asks for project evidence, managing wallet addresses, and periodic updates, and addresses recirculated donations and purpose deviations. This establishes a project reputation and verification workflow; it does not itself establish cryptographic validation of every vendor invoice. [Current verification guidance](https://docs.giveth.io/projectverification).

**Historical tracing:** Giveth's own history identifies TRACE as its earlier donation-tracing platform. An official forum thread documents sunset planning in 2022 and resource shutdown in April 2024. It should not be presented as the current maintained Giveth product. [Giveth history](https://www.giveth.io/about), [TRACE sunset discussion](https://forum.giveth.io/t/the-future-of-giveth-trace/842).

**GitHub:** [giveth-dapp](https://github.com/Giveth/giveth-dapp) and [liquidpledging](https://github.com/Giveth/liquidpledging) both show archive dates of 31 December 2024 and GPL-3.0 licensing. The former includes campaign and milestone configuration, reviewer addresses, and fiat-denominated milestone amounts. The latter describes delegated donation distribution while retaining donor ownership. These are useful historical design references; their archive status and old documented tooling make them poor default starting points for a new hackathon application.

**Design lesson:** Do not pitch milestone donation tracking or donor-controlled allocation alone as new. Show how the proposed system verifies evidence links and prevents specific adversarial actions.

## Alice: verified-outcome escrow is established prior art

**Verified:** [Alice v2's repository](https://github.com/alice-si/alice-v2-monorepo) describes Impact Delivery Agreements, payment-rights tokens, escrow, a claim registry, and refunds after the agreement deadline. Its README explicitly defines a validator Ethereum address authorized to approve fulfilled promises; those approvals unlock funds. The code is GPL-3.0. This is direct prior art for outcome-gated charitable disbursement.

The historical team-authored [Gnosis funded-project proposal](https://github.com/gnosis/GECO/blob/master/Proposals/Funded%20Projects/SocialImpactPredictionMarkets.md) describes donation-by-results, independent human or machine validation, and advance financing. Its statements about pilots are historical, not evidence of current operational activity.

**Boundary:** Current service availability and production maintenance were not verified. The v2 README's validator design does not establish the proposed decentralized contradiction-proof and privacy model.

**Design lesson:** Conditional release and refunds are useful components, not sufficient headline novelty. Compare who can authorize releases, how false evidence is challenged, and what happens when a claim is contradicted.

## Hypercerts: reusable evidence and independent assessments

**Verified:** Current Hypercerts documentation describes activity claims, evidence, measurements, separately authored evaluations, and funding records. Its website and GitHub organization now describe records built on AT Protocol. It explicitly warns that separately published evaluations are not automatically independent: readers must consider relationships and expertise. [Current overview](https://hypercerts.org/), [Evaluation concepts](https://docs.hypercerts.org/core-concepts/evaluations).

**GitHub:** The [official organization](https://github.com/hypercerts-org) and [repository list](https://github.com/orgs/hypercerts-org/repositories) expose current documentation, lexicons, API, and indexing components. The list labels `hypercerts-sdk` deprecated as of early 2026, and the older `hypercerts-v1` monorepo archived. Do not assume an old NFT/SDK integration is the current supported route.

**Relevance:** Authored evidence and relationship-aware evaluations already have a thoughtful data model. Reuse or align with that model when practical. The inspected sources do not establish the proposed escrow enforcement, cross-chain nullifier, or bank-settlement reconciliation implementation.

## Consensix Labs: particularly close proof of concept

**Verified from the publisher:** The 30 March 2026 article describes a local Hardhat proof of concept with ETH escrow, campaign purposes, invoice hashes, delivery-evidence hashes, and refund scenarios. It explicitly states that document hashes do not prove truthful evidence, that its allocation index is a label rather than purpose enforcement, and that fiat integration remains future work. It also says the code has not been audited for production. [Publisher article](https://consensixlabs.com/blog/2026-03-30/transparent-charitable-donation-tracking-an-accountability-layer-for-charitable-giving/).

**GitHub:** The article links [Transparent-Charitable-Donation-Tracking](https://github.com/Consensix-Labs/Transparent-Charitable-Donation-Tracking). The web fetch of that repository failed in this research, so these implementation statements remain publisher-reported; source code was not independently inspected here.

**Design lesson:** A donation-to-invoice-to-delivery-hash timeline is close existing work. The proposed project's contribution should be the checks and enforcement beyond merely attaching hashes.

## Defensible differentiation to test

The following is a proposal inferred from the comparison, not a proven claim of worldwide novelty:

1. A linked money-and-evidence graph that distinguishes authenticated links, accounting allocations, and unknown gaps.
2. Global private expense allocation accounting that permits legitimate donor splits while preventing cumulative overclaims across supported chains.
3. Authentication and verification of payment records, with disclosed issuer trust, rather than treating document hashes or visual similarity as truth.
4. An evidence-dependency view that identifies when several records rely on the same source, then selects a targeted independent check.
5. A contract-verifiable fraud case that freezes affected remaining escrow while resisting malicious replay and accusation-based shutdown.
6. Refund-aware reporting and deadlines for unresolved evidence, with privacy-preserving beneficiary or delivery acknowledgements where credible enrollment exists.

The demo should show an attacker defeating a simple hashed-receipt tracker and then failing a concrete verification rule in the proposed system. Each successful rejection should point to the actual contradictory evidence or contract invariant. Unknown real-world truth should remain unknown rather than receive an invented confidence percentage.
