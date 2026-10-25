import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { stringToHex } from "viem";

const { viem, networkHelpers } = await network.create();
const WATER = stringToHex("WATER", { size: 32 });
const HEALTH = stringToHex("HEALTH", { size: 32 });
const REF = stringToHex("payment-001", { size: 32 });
const EVIDENCE = stringToHex("encrypted-evidence", { size: 32 });
type CampaignView = readonly [string, string, bigint, bigint, bigint, bigint, bigint, number, boolean, bigint, bigint];

async function fixture() {
  const [owner, ngo, provider, donor, payout, outsider] = await viem.getWalletClients();
  const ledger = await viem.deployContract("LanternLedger", [owner.account.address]);
  await ledger.write.setProvider([provider.account.address, true]);
  await ledger.write.createCampaign([WATER], { account: ngo.account });
  await ledger.write.createCampaign([WATER], { account: ngo.account });
  await ledger.write.createCampaign([WATER], { account: ngo.account });
  await ledger.write.donate([1n], { account: donor.account, value: 100n });
  await ledger.write.donate([2n], { account: donor.account, value: 100n });
  await ledger.write.donate([3n], { account: donor.account, value: 100n });
  await ledger.write.registerPayment(
    [REF, ngo.account.address, payout.account.address, WATER, 100n, EVIDENCE],
    { account: provider.account },
  );
  const expenseId = await ledger.read.expenseIdFor([provider.account.address, REF]);
  return { ledger, owner, ngo, provider, donor, payout, outsider, expenseId };
}

describe("LanternLedger", () => {
  it("allows honest cofunding, then releases only allocated escrow", async () => {
    const { ledger, ngo, payout, expenseId } = await networkHelpers.loadFixture(fixture);
    const publicClient = await viem.getPublicClient();
    const before = await publicClient.getBalance({ address: payout.account.address });
    await ledger.write.allocate([1n, expenseId, 60n], { account: ngo.account });
    await ledger.write.allocate([2n, expenseId, 40n], { account: ngo.account });
    await ledger.write.release([1n, expenseId, 60n], { account: ngo.account });
    assert.equal(await ledger.read.allocations([2n, expenseId]), 40n);
    assert.equal(((await ledger.read.campaigns([1n])) as CampaignView)[3], 40n);
    assert.equal(await publicClient.getBalance({ address: payout.account.address }), before + 60n);
    await assert.rejects(ledger.write.release([1n, expenseId, 1n], { account: ngo.account }));
  });

  it("persists an authorized overclaim hold, but an outsider replay cannot hold a campaign", async () => {
    const { ledger, ngo, outsider, expenseId } = await networkHelpers.loadFixture(fixture);
    await ledger.write.allocate([1n, expenseId, 60n], { account: ngo.account });
    await ledger.write.allocate([2n, expenseId, 40n], { account: ngo.account });
    await assert.rejects(ledger.write.allocate([3n, expenseId, 1n], { account: outsider.account }));
    assert.equal(Number(((await ledger.read.campaigns([3n])) as CampaignView)[7]), 0);
    await ledger.write.allocate([3n, expenseId, 1n], { account: ngo.account });
    assert.equal(Number(((await ledger.read.campaigns([3n])) as CampaignView)[7]), 1);
    assert.equal(await ledger.read.allocations([3n, expenseId]), 0n);
    await assert.rejects(ledger.write.release([3n, expenseId, 1n], { account: ngo.account }));
  });

  it("holds linked campaigns when a provider refund invalidates prior allocations", async () => {
    const { ledger, ngo, provider, expenseId } = await networkHelpers.loadFixture(fixture);
    await ledger.write.allocate([1n, expenseId, 60n], { account: ngo.account });
    await ledger.write.allocate([2n, expenseId, 40n], { account: ngo.account });
    await ledger.write.recordRefund([expenseId, 30n], { account: provider.account });
    assert.equal(await ledger.read.netSettled([expenseId]), 70n);
    assert.equal(Number(((await ledger.read.campaigns([1n])) as CampaignView)[7]), 2);
    assert.equal(Number(((await ledger.read.campaigns([2n])) as CampaignView)[7]), 2);
    await assert.rejects(ledger.write.release([1n, expenseId, 1n], { account: ngo.account }));
  });

  it("requires provider-originated evidence, a unique payment ID, and purpose agreement", async () => {
    const { ledger, ngo, provider, outsider, payout, expenseId } = await networkHelpers.loadFixture(fixture);
    await assert.rejects(ledger.write.registerPayment(
      [stringToHex("fake", { size: 32 }), ngo.account.address, payout.account.address, WATER, 100n, EVIDENCE],
      { account: outsider.account },
    ));
    await assert.rejects(ledger.write.registerPayment(
      [REF, ngo.account.address, payout.account.address, WATER, 100n, EVIDENCE],
      { account: provider.account },
    ));
    await ledger.write.createCampaign([HEALTH], { account: ngo.account });
    await ledger.write.donate([4n], { account: outsider.account, value: 100n });
    await assert.rejects(ledger.write.allocate([4n, expenseId, 1n], { account: ngo.account }));
    assert.equal(Number(((await ledger.read.campaigns([4n])) as CampaignView)[7]), 0);
  });

  it("returns only the remaining ETH to donors after a hold", async () => {
    const { ledger, ngo, provider, donor, expenseId } = await networkHelpers.loadFixture(fixture);
    await ledger.write.allocate([1n, expenseId, 60n], { account: ngo.account });
    await ledger.write.release([1n, expenseId, 20n], { account: ngo.account });
    await ledger.write.recordRefund([expenseId, 50n], { account: provider.account });
    assert.equal(((await ledger.read.campaigns([1n])) as CampaignView)[6], 80n);
    await ledger.write.claimRefund([1n], { account: donor.account });
    assert.equal(((await ledger.read.campaigns([1n])) as CampaignView)[3], 0n);
    await assert.rejects(ledger.write.claimRefund([1n], { account: donor.account }));
    await assert.rejects(ledger.write.donate([1n], { account: donor.account, value: 1n }));
  });

  it("returns every remaining wei when several donors split a rounded refund", async () => {
    const { ledger, ngo, provider, donor, outsider, expenseId } = await networkHelpers.loadFixture(fixture);
    await ledger.write.createCampaign([WATER], { account: ngo.account });
    await ledger.write.donate([4n], { account: donor.account, value: 2n });
    await ledger.write.donate([4n], { account: outsider.account, value: 3n });
    await ledger.write.allocate([4n, expenseId, 1n], { account: ngo.account });
    await ledger.write.release([4n, expenseId, 1n], { account: ngo.account });
    await ledger.write.recordRefund([expenseId, 100n], { account: provider.account });
    await ledger.write.claimRefund([4n], { account: donor.account });
    await ledger.write.claimRefund([4n], { account: outsider.account });
    const campaign = (await ledger.read.campaigns([4n])) as CampaignView;
    assert.equal(campaign[3], 0n);
    assert.equal(campaign[10], 4n);
  });
});
