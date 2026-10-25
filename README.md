# LANTERN demo

This is the first working blockchain slice of LANTERN. It uses **ETH** in a local Hardhat chain. A donor funds a water campaign, an authorized payment provider records a settled expense, the NGO allocates that expense to two campaigns, and the contract releases only the allocated ETH. An NGO overclaim leaves a persistent hold. An outsider cannot create that hold. Donors can reclaim their proportional share of ETH still in escrow after a hold.

## Run the donor-friendly frontend

```powershell
cd frontend
npm ci
cd ..
.\scripts\start-app.ps1
```

Open <http://127.0.0.1:5173/>. The donor page follows one path: NGO funding request, rupee donation, public proof photos and votes, money trail, and trust history. Choose **For NGOs** to edit the funding request, record a local payment, and publish a proof. The interface shows rupees throughout. Trust limits, local payment records, receipt amounts, and demo donations are stored in INR.

The demo checkout is simulated, but the NGO profiles, trust scores, local payment limits, receipt fingerprints, reviews, and duplicate holds run in the local backend and persist in `bridge/.data/trust.json`. A sample proof photo is synthetic and labeled as such. NGO operators can upload a photo, click areas to cover private details, and confirm their review before publishing; the browser exports only the edited image and strips original file metadata. This is manual redaction, not an automatic identity detector. The on-ramp path below appears when provider credentials are configured. The trust backend does **not** yet enforce its limit or hold in the Solidity contract; local payments are labeled as demo records.

### Trust backend

The bridge exposes a local JSON API at `/api/trust`. `GET /api/trust/ngos` lists NGO profiles; `GET /api/trust/ngos/harbor-hands` returns the featured NGO, its campaign budget, trust score, allowance, receipts, hold reason, and event history. `POST /api/trust/ngos` adds a demo NGO. The frontend uses the API to record advances and receipts, vote, run the duplicate attack, and reset the scenario. A demo donation receives a random vote token; the backend permits one vote per token per receipt. The sample pump receipt has two sample votes, so one new donor vote closes its review and changes the score.

The trust rule is explicit: the local spending allowance is `budget × (5% + 0.15% × trust score)`, capped by the remaining budget. A majority of at least 70% after three unique demo votes adds four trust points; a failed review subtracts six. Reusing a normalized vendor/invoice identity or identical document fingerprint across any NGO or campaign subtracts twelve and persists a hold on further demo advances. The server stores keyed receipt identities, redacted public summaries, and document fingerprints; it does not store uploaded receipt files. Its checks find duplication and accounting inconsistencies, not whether a vendor actually delivered goods.

This API is bound to `127.0.0.1` for a hackathon demonstration. Demo donor tokens and NGO mutations are not production identity or authorization. Do not expose the bridge publicly as an NGO payment service without proper wallet or account authentication and contract enforcement. Run `npm run bridge:test` for its tests.

### Real INR-to-crypto staging path

The easiest conversion integration we found for this INR-first prototype is the [Onmeta widget](https://docs.onmeta.in/docs/widget/widget-creation/). It takes an INR/UPI payment and sends the purchased asset to a configured receiving account. This is a provider checkout, not a Razorpay conversion. Onmeta requires user identity checks and partner credentials. Its staging dashboard supplies test credentials; production access requires onboarding.

1. Create a staging partner account at <https://stg.dashboard.onmeta.in/>. Fill in the prepared `bridge/.env.local` with the staging API key and secret, a receiving account **you control**, the asset/network that your Onmeta account supports, and a deployed `LanternLedger` address plus JSON-RPC URL on that network. Never put the API secret in the frontend. Run `.\scripts\restart-bridge.ps1` after editing this file; its last line reports whether the provider is configured.
2. Run `.\scripts\start-app.ps1` from the repository root to start both local services. The local UI uses `/api/onramp` through Vite's proxy. Onmeta's signed webhook endpoint is `POST /webhooks/onmeta` on the bridge server; a real provider callback needs a public HTTPS URL or tunnel to that endpoint.
3. In the donor checkout, choose rupees and continue to Onmeta's UPI widget. The app creates a unique donation intent. A signed `completed` webhook records the provider's order, exact crypto amount, and conversion transaction. The donor status is **converted, awaiting campaign deposit**.
4. The organization connects the receiving account through MetaMask and presses **Deposit into campaign**. The bridge independently checks the confirmed blockchain transaction's sender, destination, amount, network, and campaign call. Only then does donor status become **protected in the campaign**.

The integration code and signed-webhook tests are present, but no Onmeta account, staging purchase, or public-chain deployment has been completed in this workspace. The live checkout stays disabled until the provider credentials, receiving account, deployed campaign contract, and RPC are all configured. Until then, the UI shows a clearly labeled demo checkout. A single configured receiving account is suitable for a controlled demo; production donor scale and refund routing require dedicated account design and provider approval.

## Run the five-minute demo

On this Windows machine, open PowerShell in this folder and run:

```powershell
.\scripts\demo.ps1
```

The script uses the bundled Node.js 24 runtime if available. Otherwise install Node.js 22.13 or newer, then run `npm ci` and `npm run demo`. The local chain resets on each run. Transaction hashes printed by the script belong to that local simulation, so they are not viewable on a public explorer.

To run the contract tests:

```powershell
npm test
```

## What the demo proves

1. ETH enters purpose-labeled campaign escrow.
2. An owner-approved provider account registers one payment record and its evidence commitment. The payment reference yields one expense ID independent of campaign ID.
3. The NGO allocates that one expense across two campaigns without exceeding its registered value.
4. A valid release transfers ETH to the provider-designated payout recipient.
5. A stranger's attempt to file an NGO claim fails without creating a hold.
6. An NGO overclaim creates a hold in a **successful transaction**. Subsequent release attempts fail.
7. The donor withdraws remaining escrow ETH after the hold.

The tests also cover a provider-recorded refund that makes earlier allocations unsupported, mismatched purposes, duplicate payment IDs, unauthorized evidence registration, and rounding in multi-donor refunds.

## Trust boundaries

The provider is chosen by the contract owner. This is a sandbox evidence issuer for the prototype. Its on-chain record is authenticated as coming from that approved address; the contract does not independently inspect a bank, verify a real-world invoice, establish delivery, or prove impact. The `settledWei` amount is the provider's ETH-denominated claim. Real fiat conversion and independent payment evidence are later integrations.

The evidence commitment is a hash-like opaque value in the contract demo, not a zero-knowledge proof and not an actual encrypted document upload. The contract currently runs on one canonical chain. It has no bridge adapter, UMA dispute integration, or gasless wallet flow. The frontend has a read-only MetaMask connection. Those features can attach to the core registry and escrow after this slice.

Holds in this prototype are terminal: donors recover remaining escrow, and released ETH cannot be pulled back. The contract is unaudited and should only be used with test ETH.

See [LANTERN-PROJECT-BLUEPRINT.md](LANTERN-PROJECT-BLUEPRINT.md) for the complete architecture and [research-github.md](research-github.md) for prior art.
