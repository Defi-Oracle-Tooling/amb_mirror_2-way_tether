// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./libraries/LibDiamond.sol";
import "../interfaces/IGovernanceFacet.sol";
import "./BridgeErrors.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title GovernanceFacet
 * @dev Implementation of governance functions for the bridge
 * This facet allows for decentralized decision-making including proposing, voting, and executing governance actions
 */
contract GovernanceFacet is IGovernanceFacet, EIP712 {
    using ECDSA for bytes32;

    bytes32 constant STORAGE_POSITION = keccak256("diamond.standard.governance.storage");
    bytes32 private constant PROPOSAL_TYPEHASH = 
        keccak256("Proposal(uint256 proposalId,address proposer,address[] targets,uint256[] values,bytes[] calldatas,string description)");
    bytes32 private constant VOTE_TYPEHASH = 
        keccak256("Vote(uint256 proposalId,address voter,uint8 support,string reason)");

    enum ProposalState {
        Pending,
        Active,
        Canceled,
        Defeated,
        Succeeded,
        Queued,
        Expired,
        Executed
    }

    enum VoteType {
        Against,
        For,
        Abstain
    }

    struct Proposal {
        uint256 id;
        address proposer;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        string description;
        uint256 startBlock;
        uint256 endBlock;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool canceled;
        bool executed;
        mapping(address => Receipt) receipts;
    }

    struct Receipt {
        bool hasVoted;
        VoteType support;
        uint256 votes;
    }

    struct GovernanceStorage {
        // The number of votes required in order for a voter to become a proposer
        uint256 proposalThreshold;
        
        // The delay before voting on a proposal may take place, once proposed
        uint256 votingDelay;
        
        // The duration of voting on a proposal, in blocks
        uint256 votingPeriod;
        
        // The number of votes required for a proposal to succeed
        uint256 quorumVotes;
        
        // The minimum timelock delay for proposal execution in seconds
        uint256 timelockDelay;
        
        // Total number of proposals created
        uint256 proposalCount;
        
        // Mapping of proposal IDs to proposals
        mapping(uint256 => Proposal) proposals;
        
        // Mapping of addresses to their voting power
        mapping(address => uint256) votingPower;

        // The timestamp after which proposals can be executed
        mapping(uint256 => uint256) proposalTimelocks;
    }

    event ProposalCreated(
        uint256 proposalId,
        address proposer,
        address[] targets,
        uint256[] values,
        bytes[] calldatas,
        string description,
        uint256 startBlock,
        uint256 endBlock
    );

    event VoteCast(
        address indexed voter,
        uint256 proposalId,
        VoteType support,
        uint256 weight,
        string reason
    );

    event ProposalCanceled(uint256 proposalId);
    event ProposalQueued(uint256 proposalId, uint256 eta);
    event ProposalExecuted(uint256 proposalId);
    event VotingDelaySet(uint256 oldVotingDelay, uint256 newVotingDelay);
    event VotingPeriodSet(uint256 oldVotingPeriod, uint256 newVotingPeriod);
    event ProposalThresholdSet(uint256 oldProposalThreshold, uint256 newProposalThreshold);
    event QuorumVotesSet(uint256 oldQuorumVotes, uint256 newQuorumVotes);
    event TimelockDelaySet(uint256 oldTimelockDelay, uint256 newTimelockDelay);

    modifier onlyOwner() {
        LibDiamond.enforceIsContractOwner();
        _;
    }

    constructor() EIP712("BridgeGovernance", "1") {}

    function getGovernanceStorage() internal pure returns (GovernanceStorage storage gs) {
        bytes32 position = STORAGE_POSITION;
        assembly {
            gs.slot := position
        }
    }

    /**
     * @notice Initialize the governance parameters
     * @param votingDelay_ The delay before voting on a proposal may take place, once proposed, in blocks
     * @param votingPeriod_ The duration of voting on a proposal, in blocks
     * @param proposalThreshold_ The number of votes required in order for a voter to become a proposer
     * @param quorumVotes_ The number of votes required for a proposal to succeed
     * @param timelockDelay_ The minimum timelock delay for proposal execution in seconds
     */
    function initialize(
        uint256 votingDelay_,
        uint256 votingPeriod_,
        uint256 proposalThreshold_,
        uint256 quorumVotes_,
        uint256 timelockDelay_
    ) external override onlyOwner {
        GovernanceStorage storage gs = getGovernanceStorage();
        
        gs.votingDelay = votingDelay_;
        gs.votingPeriod = votingPeriod_;
        gs.proposalThreshold = proposalThreshold_;
        gs.quorumVotes = quorumVotes_;
        gs.timelockDelay = timelockDelay_;
    }

    /**
     * @notice Create a new governance proposal
     * @param targets The ordered list of target addresses for calls to be made during proposal execution
     * @param values The ordered list of values to be passed to the calls made during proposal execution
     * @param calldatas The ordered list of calldata to be passed to each call
     * @param description String description of the proposal
     * @return Unique ID of the proposal
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override returns (uint256) {
        GovernanceStorage storage gs = getGovernanceStorage();
        
        uint256 proposerVotes = gs.votingPower[msg.sender];
        if (proposerVotes < gs.proposalThreshold) {
            revert BridgeErrors.InsufficientProposalThreshold(proposerVotes, gs.proposalThreshold);
        }

        if (targets.length != values.length || targets.length != calldatas.length) {
            revert BridgeErrors.GovernanceInvalidProposalLength();
        }

        if (targets.length == 0) {
            revert BridgeErrors.GovernanceEmptyProposal();
        }

        uint256 startBlock = block.number + gs.votingDelay;
        uint256 endBlock = startBlock + gs.votingPeriod;
        
        gs.proposalCount++;
        uint256 proposalId = gs.proposalCount;

        Proposal storage newProposal = gs.proposals[proposalId];
        newProposal.id = proposalId;
        newProposal.proposer = msg.sender;
        newProposal.targets = targets;
        newProposal.values = values;
        newProposal.calldatas = calldatas;
        newProposal.description = description;
        newProposal.startBlock = startBlock;
        newProposal.endBlock = endBlock;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            targets,
            values,
            calldatas,
            description,
            startBlock,
            endBlock
        );

        return proposalId;
    }

    /**
     * @notice Queue a proposal that has been successfully voted on for execution
     * @param proposalId The ID of the proposal to queue
     */
    function queue(uint256 proposalId) external override {
        GovernanceStorage storage gs = getGovernanceStorage();
        
        if (state(proposalId) != ProposalState.Succeeded) {
            revert BridgeErrors.GovernanceProposalNotSucceeded();
        }

        uint256 eta = block.timestamp + gs.timelockDelay;
        gs.proposalTimelocks[proposalId] = eta;
        
        emit ProposalQueued(proposalId, eta);
    }

    /**
     * @notice Execute a queued proposal
     * @param proposalId The ID of the proposal to execute
     */
    function execute(uint256 proposalId) external override {
        GovernanceStorage storage gs = getGovernanceStorage();
        
        if (state(proposalId) != ProposalState.Queued) {
            revert BridgeErrors.GovernanceProposalNotQueued();
        }
        
        Proposal storage proposal = gs.proposals[proposalId];
        proposal.executed = true;

        for (uint256 i = 0; i < proposal.targets.length; i++) {
            (bool success, bytes memory returndata) = proposal.targets[i].call{value: proposal.values[i]}(proposal.calldatas[i]);
            if (!success) {
                if (returndata.length > 0) {
                    // bubble up any errors
                    assembly {
                        let returndata_size := mload(returndata)
                        revert(add(32, returndata), returndata_size)
                    }
                } else {
                    revert BridgeErrors.GovernanceTransactionFailed();
                }
            }
        }

        emit ProposalExecuted(proposalId);
    }

    /**
     * @notice Cancel a proposal
     * @param proposalId The ID of the proposal to cancel
     */
    function cancel(uint256 proposalId) external override {
        GovernanceStorage storage gs = getGovernanceStorage();
        
        if (state(proposalId) == ProposalState.Executed) {
            revert BridgeErrors.GovernanceProposalAlreadyExecuted();
        }
        
        Proposal storage proposal = gs.proposals[proposalId];
        
        // Only proposal creator or contract owner can cancel
        if (msg.sender != proposal.proposer && msg.sender != LibDiamond.contractOwner()) {
            revert BridgeErrors.GovernanceOnlyProposerOrOwner();
        }

        proposal.canceled = true;
        
        emit ProposalCanceled(proposalId);
    }

    /**
     * @notice Cast a vote on a proposal
     * @param proposalId The ID of the proposal to vote on
     * @param support The support value for the vote (0=against, 1=for, 2=abstain)
     * @param reason The reason given for the vote by the voter
     * @return The number of votes cast
     */
    function castVote(
        uint256 proposalId,
        uint8 support,
        string memory reason
    ) public override returns (uint256) {
        GovernanceStorage storage gs = getGovernanceStorage();
        
        if (state(proposalId) != ProposalState.Active) {
            revert BridgeErrors.GovernanceVotingClosed();
        }
        
        VoteType voteType;
        if (support == 0) {
            voteType = VoteType.Against;
        } else if (support == 1) {
            voteType = VoteType.For;
        } else if (support == 2) {
            voteType = VoteType.Abstain;
        } else {
            revert BridgeErrors.GovernanceInvalidVoteType();
        }

        Proposal storage proposal = gs.proposals[proposalId];
        Receipt storage receipt = proposal.receipts[msg.sender];

        if (receipt.hasVoted) {
            revert BridgeErrors.GovernanceAlreadyVoted();
        }

        uint256 votes = gs.votingPower[msg.sender];

        if (voteType == VoteType.Against) {
            proposal.againstVotes += votes;
        } else if (voteType == VoteType.For) {
            proposal.forVotes += votes;
        } else if (voteType == VoteType.Abstain) {
            proposal.abstainVotes += votes;
        }

        receipt.hasVoted = true;
        receipt.support = voteType;
        receipt.votes = votes;

        emit VoteCast(msg.sender, proposalId, voteType, votes, reason);

        return votes;
    }

    /**
     * @notice Cast a vote by signature on a proposal
     * @param proposalId The ID of the proposal to vote on
     * @param support The support value for the vote (0=against, 1=for, 2=abstain)
     * @param reason The reason given for the vote by the voter
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     * @return The number of votes cast
     */
    function castVoteBySig(
        uint256 proposalId,
        uint8 support,
        string memory reason,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override returns (uint256) {
        bytes32 domainSeparator = _domainSeparatorV4();
        bytes32 structHash = keccak256(abi.encode(VOTE_TYPEHASH, proposalId, support, keccak256(bytes(reason))));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signatory = ecrecover(digest, v, r, s);
        
        if (signatory == address(0)) {
            revert BridgeErrors.GovernanceInvalidSignature();
        }
        
        return _castVote(signatory, proposalId, support, reason);
    }

    /**
     * @notice Cast a vote by signature on a proposal using the EIP-712 typed data standard
     * @param voter The address of the voter
     * @param proposalId The ID of the proposal to vote on
     * @param support The support value for the vote (0=against, 1=for, 2=abstain)
     * @param reason The reason given for the vote by the voter
     * @param signature The EIP-712 signature of the vote
     * @return The number of votes cast
     */
    function castVoteBySignature(
        address voter,
        uint256 proposalId,
        uint8 support,
        string memory reason,
        bytes memory signature
    ) external override returns (uint256) {
        bytes32 structHash = keccak256(abi.encode(VOTE_TYPEHASH, proposalId, support, keccak256(bytes(reason))));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signatory = digest.recover(signature);
        
        if (signatory != voter) {
            revert BridgeErrors.GovernanceInvalidSignature();
        }
        
        return _castVote(signatory, proposalId, support, reason);
    }

    /**
     * @notice Internal function to cast a vote
     * @param voter The address of the voter
     * @param proposalId The ID of the proposal to vote on
     * @param support The support value for the vote (0=against, 1=for, 2=abstain)
     * @param reason The reason given for the vote by the voter
     * @return The number of votes cast
     */
    function _castVote(
        address voter,
        uint256 proposalId,
        uint8 support,
        string memory reason
    ) internal returns (uint256) {
        GovernanceStorage storage gs = getGovernanceStorage();
        
        if (state(proposalId) != ProposalState.Active) {
            revert BridgeErrors.GovernanceVotingClosed();
        }
        
        VoteType voteType;
        if (support == 0) {
            voteType = VoteType.Against;
        } else if (support == 1) {
            voteType = VoteType.For;
        } else if (support == 2) {
            voteType = VoteType.Abstain;
        } else {
            revert BridgeErrors.GovernanceInvalidVoteType();
        }

        Proposal storage proposal = gs.proposals[proposalId];
        Receipt storage receipt = proposal.receipts[voter];

        if (receipt.hasVoted) {
            revert BridgeErrors.GovernanceAlreadyVoted();
        }

        uint256 votes = gs.votingPower[voter];

        if (voteType == VoteType.Against) {
            proposal.againstVotes += votes;
        } else if (voteType == VoteType.For) {
            proposal.forVotes += votes;
        } else if (voteType == VoteType.Abstain) {
            proposal.abstainVotes += votes;
        }

        receipt.hasVoted = true;
        receipt.support = voteType;
        receipt.votes = votes;

        emit VoteCast(voter, proposalId, voteType, votes, reason);

        return votes;
    }

    /**
     * @notice Get the current state of a proposal
     * @param proposalId The ID of the proposal to get the state of
     * @return The current state of the proposal
     */
    function state(uint256 proposalId) public view override returns (ProposalState) {
        GovernanceStorage storage gs = getGovernanceStorage();
        
        if (proposalId > gs.proposalCount) {
            revert BridgeErrors.GovernanceUnknownProposal();
        }
        
        Proposal storage proposal = gs.proposals[proposalId];

        if (proposal.canceled) {
            return ProposalState.Canceled;
        }
        
        if (proposal.executed) {
            return ProposalState.Executed;
        }

        uint256 eta = gs.proposalTimelocks[proposalId];

        if (block.number <= proposal.startBlock) {
            return ProposalState.Pending;
        }

        if (block.number <= proposal.endBlock) {
            return ProposalState.Active;
        }

        if (proposal.forVotes <= proposal.againstVotes || proposal.forVotes < gs.quorumVotes) {
            return ProposalState.Defeated;
        }

        if (eta == 0) {
            return ProposalState.Succeeded;
        }

        if (block.timestamp >= eta) {
            return ProposalState.Queued;
        } else {
            return ProposalState.Expired;
        }
    }

    /**
     * @notice Get detailed information about a proposal
     * @param proposalId The ID of the proposal to get information for
     * @return targets The target addresses for calls to be made
     * @return values The values to be passed to the calls
     * @return calldatas The calldatas to be passed to each call
     * @return startBlock The block at which voting begins
     * @return endBlock The block at which voting ends
     * @return proposer The address that created the proposal
     * @return forVotes The number of votes for the proposal
     * @return againstVotes The number of votes against the proposal
     * @return abstainVotes The number of abstaining votes
     */
    function getProposal(uint256 proposalId) external view override returns (
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        uint256 startBlock,
        uint256 endBlock,
        address proposer,
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes
    ) {
        GovernanceStorage storage gs = getGovernanceStorage();
        
        if (proposalId > gs.proposalCount) {
            revert BridgeErrors.GovernanceUnknownProposal();
        }
        
        Proposal storage proposal = gs.proposals[proposalId];
        
        return (
            proposal.targets,
            proposal.values,
            proposal.calldatas,
            proposal.startBlock,
            proposal.endBlock,
            proposal.proposer,
            proposal.forVotes,
            proposal.againstVotes,
            proposal.abstainVotes
        );
    }

    /**
     * @notice Get receipt for a voter's vote on a proposal
     * @param proposalId The ID of the proposal to get a receipt for
     * @param voter The address of the voter to get a receipt for
     * @return hasVoted Whether the voter has voted or not
     * @return support The support value for the vote (0=against, 1=for, 2=abstain)
     * @return votes The number of votes cast
     */
    function getReceipt(uint256 proposalId, address voter) external view override returns (
        bool hasVoted,
        VoteType support,
        uint256 votes
    ) {
        GovernanceStorage storage gs = getGovernanceStorage();
        
        if (proposalId > gs.proposalCount) {
            revert BridgeErrors.GovernanceUnknownProposal();
        }
        
        Receipt storage receipt = gs.proposals[proposalId].receipts[voter];
        
        return (
            receipt.hasVoted,
            receipt.support,
            receipt.votes
        );
    }

    /**
     * @notice Gets the voting power of an account
     * @param account The address of the account to get voting power for
     * @return The voting power of the account
     */
    function getVotingPower(address account) external view override returns (uint256) {
        return getGovernanceStorage().votingPower[account];
    }

    /**
     * @notice Sets the voting power for an account
     * @param account The address of the account to set voting power for
     * @param newVotingPower The new voting power for the account
     */
    function setVotingPower(address account, uint256 newVotingPower) external override onlyOwner {
        getGovernanceStorage().votingPower[account] = newVotingPower;
    }

    /**
     * @notice Gets the current proposal threshold
     * @return Current proposal threshold
     */
    function proposalThreshold() public view override returns (uint256) {
        return getGovernanceStorage().proposalThreshold;
    }

    /**
     * @notice Gets the current voting delay
     * @return Current voting delay in blocks
     */
    function votingDelay() public view override returns (uint256) {
        return getGovernanceStorage().votingDelay;
    }

    /**
     * @notice Gets the current voting period
     * @return Current voting period in blocks
     */
    function votingPeriod() public view override returns (uint256) {
        return getGovernanceStorage().votingPeriod;
    }

    /**
     * @notice Gets the current quorum votes threshold
     * @return Current quorum votes threshold
     */
    function quorumVotes() public view override returns (uint256) {
        return getGovernanceStorage().quorumVotes;
    }

    /**
     * @notice Gets the current timelock delay in seconds
     * @return Current timelock delay in seconds
     */
    function timelockDelay() public view override returns (uint256) {
        return getGovernanceStorage().timelockDelay;
    }

    /**
     * @notice Sets the voting delay
     * @param newVotingDelay New voting delay in blocks
     */
    function setVotingDelay(uint256 newVotingDelay) external override onlyOwner {
        GovernanceStorage storage gs = getGovernanceStorage();
        uint256 oldVotingDelay = gs.votingDelay;
        gs.votingDelay = newVotingDelay;
        
        emit VotingDelaySet(oldVotingDelay, newVotingDelay);
    }

    /**
     * @notice Sets the voting period
     * @param newVotingPeriod New voting period in blocks
     */
    function setVotingPeriod(uint256 newVotingPeriod) external override onlyOwner {
        GovernanceStorage storage gs = getGovernanceStorage();
        uint256 oldVotingPeriod = gs.votingPeriod;
        gs.votingPeriod = newVotingPeriod;
        
        emit VotingPeriodSet(oldVotingPeriod, newVotingPeriod);
    }

    /**
     * @notice Sets the proposal threshold
     * @param newProposalThreshold New proposal threshold
     */
    function setProposalThreshold(uint256 newProposalThreshold) external override onlyOwner {
        GovernanceStorage storage gs = getGovernanceStorage();
        uint256 oldProposalThreshold = gs.proposalThreshold;
        gs.proposalThreshold = newProposalThreshold;
        
        emit ProposalThresholdSet(oldProposalThreshold, newProposalThreshold);
    }

    /**
     * @notice Sets the quorum votes threshold
     * @param newQuorumVotes New quorum votes threshold
     */
    function setQuorumVotes(uint256 newQuorumVotes) external override onlyOwner {
        GovernanceStorage storage gs = getGovernanceStorage();
        uint256 oldQuorumVotes = gs.quorumVotes;
        gs.quorumVotes = newQuorumVotes;
        
        emit QuorumVotesSet(oldQuorumVotes, newQuorumVotes);
    }

    /**
     * @notice Sets the timelock delay
     * @param newTimelockDelay New timelock delay in seconds
     */
    function setTimelockDelay(uint256 newTimelockDelay) external override onlyOwner {
        GovernanceStorage storage gs = getGovernanceStorage();
        uint256 oldTimelockDelay = gs.timelockDelay;
        gs.timelockDelay = newTimelockDelay;
        
        emit TimelockDelaySet(oldTimelockDelay, newTimelockDelay);
    }

    /**
     * @notice Gets the total number of proposals created
     * @return The total number of proposals created
     */
    function getProposalCount() external view override returns (uint256) {
        return getGovernanceStorage().proposalCount;
    }

    /**
     * @notice Gets the eta (execution time) for a queued proposal
     * @param proposalId The ID of the proposal to get the eta for
     * @return The eta for the proposal in seconds since unix epoch
     */
    function getProposalEta(uint256 proposalId) external view override returns (uint256) {
        return getGovernanceStorage().proposalTimelocks[proposalId];
    }
}