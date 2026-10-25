// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Hackathon contract core. A configured provider authenticates external
/// payment records; this contract does not determine whether goods were delivered.
contract LanternLedger is Ownable, ReentrancyGuard {
    enum HoldReason { None, AuthorizedOverclaim, ProviderRefund }

    struct Campaign {
        address ngo;
        bytes32 purpose;
        uint256 deposited;
        uint256 escrow;
        uint256 released;
        uint256 allocated;
        uint256 refundPool;
        HoldReason holdReason;
        bool exists;
        uint256 refundContributionClaimed;
        uint256 refundsPaid;
    }

    struct Expense {
        address provider;
        address ngo;
        address payable payoutRecipient;
        bytes32 purpose;
        bytes32 evidenceCommitment;
        uint256 grossSettled;
        uint256 refunded;
        uint256 allocated;
        bool exists;
    }

    uint256 public nextCampaignId = 1;
    uint256 public constant MAX_CAMPAIGNS_PER_EXPENSE = 32;

    mapping(address => bool) public trustedProviders;
    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(uint256 => mapping(address => bool)) public refundClaimed;
    mapping(bytes32 => Expense) public expenses;
    mapping(uint256 => mapping(bytes32 => uint256)) public allocations;
    mapping(uint256 => mapping(bytes32 => uint256)) public releasedForExpense;
    mapping(bytes32 => uint256[]) private expenseCampaigns;
    mapping(bytes32 => mapping(uint256 => bool)) private expenseCampaignSeen;

    error ZeroValue();
    error InvalidCampaign();
    error InvalidExpense();
    error Unauthorized();
    error PurposeMismatch();
    error CampaignHeld();
    error NoCapacity();
    error TooManyCampaigns();
    error TransferFailed();

    event ProviderSet(address indexed provider, bool trusted);
    event CampaignCreated(uint256 indexed campaignId, address indexed ngo, bytes32 indexed purpose);
    event DonationReceived(uint256 indexed campaignId, address indexed donor, uint256 amount);
    event PaymentRegistered(bytes32 indexed expenseId, address indexed provider, address indexed ngo, bytes32 paymentRef, uint256 amount, bytes32 evidenceCommitment);
    event ExpenseAllocated(uint256 indexed campaignId, bytes32 indexed expenseId, uint256 amount);
    event CampaignHeldEvent(uint256 indexed campaignId, bytes32 indexed expenseId, HoldReason reason, uint256 claimed, uint256 supported);
    event ProviderRefundRecorded(bytes32 indexed expenseId, uint256 amount, uint256 remainingNetSettlement);
    event ExpenseReleased(uint256 indexed campaignId, bytes32 indexed expenseId, address indexed recipient, uint256 amount);
    event DonorRefunded(uint256 indexed campaignId, address indexed donor, uint256 amount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setProvider(address provider, bool trusted) external onlyOwner {
        if (provider == address(0)) revert ZeroValue();
        trustedProviders[provider] = trusted;
        emit ProviderSet(provider, trusted);
    }

    function createCampaign(bytes32 purpose) external returns (uint256 campaignId) {
        if (purpose == bytes32(0)) revert ZeroValue();
        campaignId = nextCampaignId++;
        campaigns[campaignId] = Campaign({
            ngo: msg.sender,
            purpose: purpose,
            deposited: 0,
            escrow: 0,
            released: 0,
            allocated: 0,
            refundPool: 0,
            holdReason: HoldReason.None,
            exists: true,
            refundContributionClaimed: 0,
            refundsPaid: 0
        });
        emit CampaignCreated(campaignId, msg.sender, purpose);
    }

    function donate(uint256 campaignId) external payable {
        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert InvalidCampaign();
        if (campaign.holdReason != HoldReason.None) revert CampaignHeld();
        if (campaign.allocated != 0) revert NoCapacity();
        if (msg.value == 0) revert ZeroValue();
        campaign.deposited += msg.value;
        campaign.escrow += msg.value;
        contributions[campaignId][msg.sender] += msg.value;
        emit DonationReceived(campaignId, msg.sender, msg.value);
    }

    /// @dev The caller is the configured payment provider. paymentRef identifies
    /// the economic payment globally within this canonical registry, not a campaign.
    function registerPayment(
        bytes32 paymentRef,
        address ngo,
        address payable payoutRecipient,
        bytes32 purpose,
        uint256 settledWei,
        bytes32 evidenceCommitment
    ) external returns (bytes32 expenseId) {
        if (!trustedProviders[msg.sender]) revert Unauthorized();
        if (paymentRef == bytes32(0) || ngo == address(0) || payoutRecipient == address(0) || purpose == bytes32(0) || settledWei == 0 || evidenceCommitment == bytes32(0)) revert ZeroValue();
        expenseId = expenseIdFor(msg.sender, paymentRef);
        if (expenses[expenseId].exists) revert InvalidExpense();
        expenses[expenseId] = Expense({
            provider: msg.sender,
            ngo: ngo,
            payoutRecipient: payoutRecipient,
            purpose: purpose,
            evidenceCommitment: evidenceCommitment,
            grossSettled: settledWei,
            refunded: 0,
            allocated: 0,
            exists: true
        });
        emit PaymentRegistered(expenseId, msg.sender, ngo, paymentRef, settledWei, evidenceCommitment);
    }

    function expenseIdFor(address provider, bytes32 paymentRef) public pure returns (bytes32) {
        return keccak256(abi.encode(provider, paymentRef));
    }

    /// @notice An NGO submission that exceeds a verified payment records a hold
    /// and returns without reverting, so the state change persists.
    function allocate(uint256 campaignId, bytes32 expenseId, uint256 amount) external {
        Campaign storage campaign = campaigns[campaignId];
        Expense storage expense = expenses[expenseId];
        if (!campaign.exists) revert InvalidCampaign();
        if (!expense.exists) revert InvalidExpense();
        if (msg.sender != campaign.ngo || campaign.ngo != expense.ngo) revert Unauthorized();
        if (campaign.purpose != expense.purpose) revert PurposeMismatch();
        if (campaign.holdReason != HoldReason.None) revert CampaignHeld();
        if (amount == 0) revert ZeroValue();
        if (amount > campaign.deposited - campaign.allocated) revert NoCapacity();

        uint256 netAmount = expense.grossSettled - expense.refunded;
        if (amount > netAmount || expense.allocated > netAmount - amount) {
            _hold(campaignId, expenseId, HoldReason.AuthorizedOverclaim, expense.allocated + amount, netAmount);
            return;
        }

        if (!expenseCampaignSeen[expenseId][campaignId]) {
            if (expenseCampaigns[expenseId].length == MAX_CAMPAIGNS_PER_EXPENSE) revert TooManyCampaigns();
            expenseCampaignSeen[expenseId][campaignId] = true;
            expenseCampaigns[expenseId].push(campaignId);
        }
        expense.allocated += amount;
        campaign.allocated += amount;
        allocations[campaignId][expenseId] += amount;
        emit ExpenseAllocated(campaignId, expenseId, amount);
    }

    /// @notice A provider refund reduces supported spending. Affected campaigns
    /// are held for reconciliation; a refund by itself is not called fraud.
    function recordRefund(bytes32 expenseId, uint256 amount) external {
        Expense storage expense = expenses[expenseId];
        if (!expense.exists) revert InvalidExpense();
        if (msg.sender != expense.provider || !trustedProviders[msg.sender]) revert Unauthorized();
        if (amount == 0 || amount > expense.grossSettled - expense.refunded) revert NoCapacity();
        expense.refunded += amount;
        uint256 netAmount = expense.grossSettled - expense.refunded;
        emit ProviderRefundRecorded(expenseId, amount, netAmount);
        if (expense.allocated > netAmount) {
            uint256[] storage affected = expenseCampaigns[expenseId];
            for (uint256 i = 0; i < affected.length; i++) {
                uint256 campaignId = affected[i];
                Campaign storage campaign = campaigns[campaignId];
                if (campaign.holdReason == HoldReason.None) {
                    _hold(campaignId, expenseId, HoldReason.ProviderRefund, expense.allocated, netAmount);
                }
            }
        }
    }

    function release(uint256 campaignId, bytes32 expenseId, uint256 amount) external nonReentrant {
        Campaign storage campaign = campaigns[campaignId];
        Expense storage expense = expenses[expenseId];
        if (!campaign.exists) revert InvalidCampaign();
        if (!expense.exists) revert InvalidExpense();
        if (msg.sender != campaign.ngo || campaign.ngo != expense.ngo) revert Unauthorized();
        if (campaign.holdReason != HoldReason.None) revert CampaignHeld();
        if (amount == 0 || amount > campaign.escrow) revert NoCapacity();
        if (expense.allocated > expense.grossSettled - expense.refunded) revert CampaignHeld();
        uint256 authorized = allocations[campaignId][expenseId];
        if (amount > authorized - releasedForExpense[campaignId][expenseId]) revert NoCapacity();

        releasedForExpense[campaignId][expenseId] += amount;
        campaign.escrow -= amount;
        campaign.released += amount;
        (bool ok,) = expense.payoutRecipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit ExpenseReleased(campaignId, expenseId, expense.payoutRecipient, amount);
    }

    function netSettled(bytes32 expenseId) external view returns (uint256) {
        Expense storage expense = expenses[expenseId];
        if (!expense.exists) revert InvalidExpense();
        return expense.grossSettled - expense.refunded;
    }

    function linkedCampaigns(bytes32 expenseId) external view returns (uint256[] memory) {
        if (!expenses[expenseId].exists) revert InvalidExpense();
        return expenseCampaigns[expenseId];
    }

    /// @notice Donors recover their proportional share of ETH left at the hold.
    /// Releases made before the hold are shared pro rata among all contributors.
    function claimRefund(uint256 campaignId) external nonReentrant {
        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert InvalidCampaign();
        if (campaign.holdReason == HoldReason.None) revert NoCapacity();
        uint256 contributed = contributions[campaignId][msg.sender];
        if (contributed == 0 || refundClaimed[campaignId][msg.sender]) revert NoCapacity();
        refundClaimed[campaignId][msg.sender] = true;
        campaign.refundContributionClaimed += contributed;
        uint256 amount = campaign.refundContributionClaimed == campaign.deposited
            ? campaign.refundPool - campaign.refundsPaid
            : contributed * campaign.refundPool / campaign.deposited;
        campaign.refundsPaid += amount;
        campaign.escrow -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit DonorRefunded(campaignId, msg.sender, amount);
    }

    function _hold(uint256 campaignId, bytes32 expenseId, HoldReason reason, uint256 claimed, uint256 supported) internal {
        Campaign storage campaign = campaigns[campaignId];
        campaign.holdReason = reason;
        campaign.refundPool = campaign.escrow;
        emit CampaignHeldEvent(campaignId, expenseId, reason, claimed, supported);
    }
}
