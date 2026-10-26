// keccak256('DonationReceived(uint256,address,uint256)') from LanternLedger.sol.
export const donationTopic = '0x0b5b4c52969ff7329ecf7ee536409fda87812b15a8622bc6e8cdeab3aee14a26';
export function assertDonationEvent(receipt, { ledger, wallet, campaignId, amountWei }) {
  const campaignTopic=`0x${BigInt(campaignId).toString(16).padStart(64,'0')}`;
  const donorTopic=`0x${wallet.slice(2).toLowerCase().padStart(64,'0')}`;
  const found=receipt.logs?.some(log => log.removed !== true &&
    String(log.address).toLowerCase()===ledger.toLowerCase() &&
    String(log.topics?.[0]).toLowerCase()===donationTopic &&
    String(log.topics?.[1]).toLowerCase()===campaignTopic &&
    String(log.topics?.[2]).toLowerCase()===donorTopic &&
    /^0x[0-9a-f]{64}$/i.test(log.data || '') && BigInt(log.data)===BigInt(amountWei));
  if(!found)throw new Error('Campaign contract did not emit the matching donation event');
}
