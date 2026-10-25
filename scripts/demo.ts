import { network } from "hardhat";
import { formatEther, parseEther, stringToHex } from "viem";

const { viem } = await network.create();
const [owner, ngo, provider, donor, vendor, attacker] = await viem.getWalletClients();
const publicClient = await viem.getPublicClient();
const water = stringToHex("WATER", { size: 32 });
const paymentRef = stringToHex("sandbox-payment-001", { size: 32 });
const evidenceCommitment = stringToHex("private-evidence-commitment", { size: 32 });
const amount = (eth: string) => parseEther(eth);
type CampaignView = readonly [string, string, bigint, bigint, bigint, bigint, bigint, number, boolean, bigint, bigint];
type ExpenseView = readonly [string, string, string, string, string, bigint, bigint, bigint, boolean];

const ledger = await viem.deployContract("LanternLedger", [owner.account.address]);
await ledger.write.setProvider([provider.account.address, true]);
for (let i = 0; i < 3; i++) {
  await ledger.write.createCampaign([water], { account: ngo.account });
  await ledger.write.donate([BigInt(i + 1)], { account: donor.account, value: amount("3") });
}

await ledger.write.registerPayment(
  [paymentRef, ngo.account.address, vendor.account.address, water, amount("3"), evidenceCommitment],
  { account: provider.account },
);
const expenseId = await ledger.read.expenseIdFor([provider.account.address, paymentRef]);

await ledger.write.allocate([1n, expenseId, amount("2")], { account: ngo.account });
await ledger.write.allocate([2n, expenseId, amount("1")], { account: ngo.account });
const releaseHash = await ledger.write.release([1n, expenseId, amount("1")], { account: ngo.account });
await publicClient.waitForTransactionReceipt({ hash: releaseHash });

let outsiderRejected = false;
try {
  await ledger.write.allocate([3n, expenseId, amount("0.1")], { account: attacker.account });
} catch {
  outsiderRejected = true;
}

const holdHash = await ledger.write.allocate([3n, expenseId, amount("0.1")], { account: ngo.account });
await publicClient.waitForTransactionReceipt({ hash: holdHash });

let nextReleaseBlocked = false;
try {
  await ledger.write.release([3n, expenseId, amount("0.1")], { account: ngo.account });
} catch {
  nextReleaseBlocked = true;
}

const campaign = (await ledger.read.campaigns([3n])) as CampaignView;
const expense = (await ledger.read.expenses([expenseId])) as ExpenseView;
const refundHash = await ledger.write.claimRefund([3n], { account: donor.account });
await publicClient.waitForTransactionReceipt({ hash: refundHash });
const afterRefund = (await ledger.read.campaigns([3n])) as CampaignView;
console.log("\nLANTERN ETH ESCROW | LOCAL DEMO");
console.log("1. Donor funded three water campaigns with 3 ETH each.");
console.log("2. Approved provider registered one 3 ETH expense.");
console.log("3. NGO assigned 2 ETH and 1 ETH to separate campaigns; a valid release paid 1 ETH.");
console.log("4. Outsider claim was rejected. NGO overclaim persisted as a hold.");
console.log("5. Next release was blocked; donor recovered the 3 ETH still in held escrow.\n");
console.log(JSON.stringify({
  network: "local Hardhat simulation",
  contract: ledger.address,
  expenseId,
  authenticatedPaymentEther: formatEther(expense[5]),
  allocatedEther: formatEther(expense[7]),
  validReleaseTransaction: releaseHash,
  outsiderReplayRejected: outsiderRejected,
  ngoOverclaimTransaction: holdHash,
  heldCampaign: 3,
  persistedHoldReason: Number(campaign[7]),
  nextReleaseBlocked,
  donorRefundTransaction: refundHash,
  remainingHeldEscrowEther: formatEther(afterRefund[3]),
}, null, 2));
