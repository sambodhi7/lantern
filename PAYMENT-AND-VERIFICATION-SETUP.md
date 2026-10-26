# Running LANTERN with PostgreSQL and Gemini

Run from the project folder:

```powershell
.\scripts\start-postgres.ps1
.\scripts\restart-bridge.ps1
.\scripts\start-app.ps1
```

The dedicated PostgreSQL 17 cluster lives in `bridge/.data/postgres`, binds only to `127.0.0.1:55432`, and uses the `lantern` database and role. Existing PostgreSQL services on other ports are untouched. This development cluster uses local trust authentication; use a password, TLS and network restrictions for a hosted database. Database access is separate from application sign-in, which remains omitted by request.

`DATABASE_URL` and `GEMINI_API_KEY` live in the ignored `bridge/.env.local`. `GEMINI_MODEL` selects the model; this account uses `gemini-3.6-flash`, verified with a synthetic receipt. No Gemini credential is sent to the frontend. `/health` reports the active storage and provider configuration.

The first PostgreSQL initialization imports existing local trust data when present. The ledger is persisted as one locked JSONB accounting aggregate, with relational payment and encrypted evidence tables. Requests commit before returning success. Database locks serialize changes across processes. This is a deliberate pilot design, with one ledger lock; it does not claim high-throughput scaling or a fully normalized NGO schema.

## Receipt verification and privacy

### Presentation flow

Receipt review buttons never open donation checkout. Existing verified donors submit reviews directly; missing or expired review access prompts only wallet account access and a free ownership signature, without network switching or an ETH transaction. A wallet with no contribution is told to switch to its donor wallet. Regression check: `cd frontend; node --test scripts/review-wallet.test.mjs`.

The home page `/` lists active campaigns. Each card links to its own `?campaign=...` public page with donations, proof reviews, money trail and trust history. The logo and **All campaigns** return to the directory. Campaign descriptions, funding totals, trust scores and receipt counts are loaded from the backend; closed funding requests are excluded.

Use **For NGOs → + Create new campaign** to publish another funding request. Choose a name, goal, purpose and description. Then choose **Activate this campaign on Sepolia** and approve the one-time creation transaction in MetaMask. This creates a separate campaign ID in the existing deployed contract; a new contract deployment is unnecessary. The backend verifies the creation calldata, sender, purpose and emitted ID before binding that ID to the funding request. A creation transaction cannot be reused for a second request.

Every campaign now uses MetaMask ETH donations. The simulated INR donation control has been removed from the public UI. Home cards and campaign totals show confirmed Sepolia test ETH, with INR project budgets separately labeled. Test ETH is valueless; these are real public-chain transactions with test assets, not real INR payments. Existing synthetic accounting entries remain labeled in the historical demo ledger.

The selector switches between requests and keeps the selected campaign in the URL. Donations, receipts and voting rights remain scoped to each campaign; receipt duplication is checked globally. Confirmation validates the exact campaign ID and matching donation event, so a transfer to one campaign cannot fund another. Pending transaction references are stored per campaign. Additional on-chain campaign records disable destructive demo resets so escrow links cannot be discarded.

Open `http://127.0.0.1:5173/` in Chrome with MetaMask. The public campaign shows the saved Sepolia contract and confirmed test donations, alongside a separately labeled INR demonstration ledger.

1. **Support this project** opens the MetaMask testnet donation dialog. If needed, activate the selected campaign first. Existing donors can choose **Already donated? Enable receipt reviews**, sign a free ownership message, and review without another transfer. The backend checks their actual contract contribution to that specific campaign before issuing voting access. One wallet has one review per receipt even after renewing its session.
2. **For NGOs → Edit funding request** changes the public campaign request. Under receipt verification, upload an image or use the synthetic sample, enter its claimed rupee amount, then analyze it with Gemini.
3. Review the redacted preview and publish. Recording the declared expense and publishing its proof happen together. Retrying publication of the same evidence ID returns the saved proof without reserving more allowance.
4. Donors see the safe image, consistency assessment, amount and fingerprint. Three reviews close the receipt; at least 70% support raises trust by four points. A rejected receipt lowers it by six. Simulated donor reviews are labeled separately from verified wallet reviews. This is a small demo quorum, not a Sybil-resistant governance mechanism.
5. Approved expense amounts clear outstanding declared spending. The allowance is campaign funds × (5% + score × 0.15%); available spending is capped by both remaining funds and allowance minus outstanding expenses. These are backend accounting records, not bank transfers.
6. Reusing an invoice identity or original file hash under a new evidence submission creates a hold and lowers trust by 12 once. The hold makes available backend spending zero. It does not send a freeze transaction to the Sepolia contract.

The sample is fictional and labeled as such. Gemini can flag an uncertain sample or withhold its photo; the application preserves that assessment. The **Reset demo records** control preserves the existing public Sepolia deployment and transactions.

Choose **For NGOs**. In **Receipt verification**, enter the claimed INR amount, choose a receipt image and press **Analyze and redact**. The backend:

1. Hashes the original bytes for duplicate detection.
2. Strips image metadata and sends a resized image to Google's Gemini API.
3. Extracts supplier, invoice, amount and currency; checks campaign purpose, readability and visible inconsistencies.
4. Covers identified private regions with opaque pixels, then re-encodes the image.
5. Asks Gemini to inspect the edited image for remaining private information. A failed or uncertain privacy check withholds the image.
6. Encrypts the original and extracted private record with AES-256-GCM and stores them in PostgreSQL.
7. Returns only a generic public summary, redacted preview, check outcomes and evidence ID.

Review the preview, tick the privacy review checkbox and publish. The server loads extracted fields from its own encrypted record, rather than trusting replacement fields from the browser. Invoice identities and original-document hashes go through the global duplicate registry. Failed consistency checks mark a proof for review; they do not silently approve it. Model failures publish nothing.

The original receipt is visible to Google's API during processing. Encryption protects stored records; it does not hide the image from the model provider. Assess provider data retention before using real beneficiary records. AI can miss details: the preview review remains required. The original document cannot be downloaded through any public API. Preserve `bridge/.data/evidence.key` with encrypted backups, or supply a base64 32-byte `EVIDENCE_ENCRYPTION_KEY`. Losing that key makes originals unreadable. AI assessments do not prove authenticity or delivery. Rephotographed or altered receipts can evade byte hashes and supplier/invoice extraction; there is no promise to catch a fixed percentage of forgeries.

## Make the payment pipeline real

### Present on public Sepolia without Onmeta

Open `http://127.0.0.1:5173/#blockchain` in the Chrome profile where MetaMask is installed. Choose **Connect MetaMask**, then **Deploy on Sepolia** and review the deployment in MetaMask. After confirmation, choose **Create campaign** and approve that transaction. Finally send a small test donation such as `0.001` Sepolia ETH. The page links to each transaction on Sepolia Etherscan. Test tokens have no monetary value and do not increase the INR fundraising figure.

All signatures stay inside MetaMask. The backend verifies contract deployment calldata, the campaign creation event, and the donation event using its own Sepolia RPC. The verified deployment and test donation trail persist in PostgreSQL. Pending transaction references survive browser refreshes, and **Check confirmation** recovers a delayed result without resending the transaction. **Reset scenario** preserves the public contract link. Override the public RPC using `SEPOLIA_RPC_URL` if needed.

This screen currently covers deployment, campaign creation, and donations. Expense allocation, provider authorization, payout and escrow-hold actions remain in the existing contract demo; they are not yet controls on the public testnet page.

The current fiat provider adapter is Onmeta. Razorpay alone does not convert rupees to crypto. You need an Onmeta partner account with explicit approval for this donation flow, its API key and API secret, a supported native ETH network, and a receiving wallet you control. Start in staging. Provider account creation, KYC and production approval require you.

1. Obtain partner access from the [Onmeta staging dashboard](https://stg.dashboard.onmeta.in/). Ask which native ETH networks and donation use cases are enabled for your account. This adapter verifies native ETH transfers; it does not accept ERC-20 transfers or internal contract ETH transfers.
2. Deploy `LanternLedger` on the same network. Create the intended campaign. Set `LANTERN_LEDGER_ADDRESS`, `LANTERN_CAMPAIGN_ID`, `LANTERN_RPC_URL`, `ONMETA_CHAIN_ID`, `ONMETA_TOKEN_SYMBOL=ETH`, and `ONMETA_TREASURY_ADDRESS` in `bridge/.env.local`. Use the provider's supported staging network; do not assume Sepolia is supported.
3. Add `ONMETA_API_KEY` and `ONMETA_API_SECRET`. Restart the bridge. `/api/onramp/config` returns `configured:true` only once the required receiving wallet, ETH asset, contract, RPC and provider credentials are present. This flag checks configuration, not provider onboarding approval.
4. Run `node bridge/webhook-gateway.mjs`. Expose **only port 8788** through a public HTTPS tunnel. Register `https://YOUR-TUNNEL/webhooks/onmeta` in Onmeta's dashboard. The gateway forwards only this signed webhook route. Keep the no-auth application API on loopback.
5. A donor creates an INR intent and completes the provider widget's payment and KYC. The provider converts INR and sends native ETH to the receiving wallet. LANTERN checks the signed webhook, expected INR amount, receiver, asset, chain, order identity and conversion reference. It independently checks the conversion transaction and confirmation depth. Unknown orders and conflicting duplicates are rejected.
6. The donor sees **converted, awaiting campaign deposit**. Under **For NGOs**, connect the receiving wallet in MetaMask and choose **Deposit into campaign**. The amount and campaign call are built from the confirmed conversion record.
7. LANTERN checks the actual sender, contract destination, value, campaign calldata, transaction success and confirmations. Only then does the intent become **escrowed** and increase funds raised once. Repeated webhooks and repeated confirmation requests do not credit the campaign twice.
8. Test successful payments, pending confirmations, wrong amounts/networks, provider retries, duplicate transfers and restart recovery before asking the provider for production access.

The receiving-wallet deposit requires a separate gas balance. The current contract records the receiving wallet as its depositor, so donor refunds need a separate payout/reconciliation design before live public fundraising. The trust allowance still controls backend local-spending records; it is not yet enforced inside the escrow contract. Do not describe this pilot as a fully autonomous mainnet donation service.

Official integration references: [Onmeta widget creation](https://docs.onmeta.in/docs/widget/widget-creation/), [signed webhook configuration](https://docs.onmeta.in/docs/webhooks/onramp-webhook-configuration/), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini generation endpoint](https://ai.google.dev/api/generate-content).

## Verification commands

```powershell
$env:TEST_DATABASE_URL='postgresql://lantern@127.0.0.1:55432/lantern'
npm run bridge:test
node scripts/verify-gemini.mjs
node scripts/journey-smoke.mjs
cd frontend
npm run build
```

The test suite checks live PostgreSQL locking and rollback, duplicate holds, exactly-once settlement, encryption authentication, pixel replacement and withholding unsafe images. The live Gemini smoke command sends a generated synthetic receipt; it does not upload private user records.

`journey-smoke.mjs` additionally exercises live Gemini analysis, encrypted PostgreSQL publication, safe retries, donor reviews, score changes and duplicate holds through HTTP. It creates and removes its own isolated database schema and leaves the presentation ledger untouched. Its synthetic donor sessions test the review workflow; wallet ownership verification is covered separately against actual local contract execution in `bridge/testnet.test.mjs`.

For the full payment protocol demonstration, run `npm run payment:demo` after starting PostgreSQL. It deploys the actual Solidity contract on a local Hardhat blockchain, uses a simulated provider callback, enforces confirmation depth, deposits into escrow, and verifies the resulting PostgreSQL credit. Its isolated database schema is removed afterward. The result is written to `bridge/.data/payment-chain-demo.json`. This demonstrates the protocol with local test funds; it does not perform an INR purchase.
