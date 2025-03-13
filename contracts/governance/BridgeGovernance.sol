// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../interfaces/IBridgeGovernance.sol";

contract BridgeGovernance is IBridgeGovernance, AccessControl, Pausable, ReentrancyGuard {
    // Constants for gas optimization
    bytes32 private constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 private constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    uint256 private constant VOTING_DELAY = 1 days;
    uint256 private constant VOTING_PERIOD = 3 days;
    uint256 private constant QUORUM_PERCENTAGE = 4; // 4%

    // Packed struct for gas optimization
    struct Proposal {
        uint32 startBlock;
        uint32 endBlock;
        uint32 forVotes;
        uint32 againstVotes;
        bool executed;
        bool canceled;
        mapping(address => bool) hasVoted;
    }

    mapping(bytes32 => Proposal) private _proposals;
    mapping(address => uint256) private _votingPower;

    constructor() {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(PROPOSER_ROLE, msg.sender);
        _setupRole(EXECUTOR_ROLE, msg.sender);
    }

    // Optimized propose function
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) external whenNotPaused returns (bytes32) {
        require(
            hasRole(PROPOSER_ROLE, msg.sender),
            "BridgeGovernance: must have proposer role"
        );
        
        require(
            targets.length == values.length && targets.length == calldatas.length,
            "BridgeGovernance: invalid proposal length"
        );

        bytes32 proposalId = keccak256(abi.encode(targets, values, calldatas, description));
        Proposal storage proposal = _proposals[proposalId];
        
        require(proposal.startBlock == 0, "BridgeGovernance: proposal already exists");

        uint32 startBlock = uint32(block.number + (VOTING_DELAY / 12)); // Assuming 12-second blocks
        
        proposal.startBlock = startBlock;
        proposal.endBlock = uint32(startBlock + (VOTING_PERIOD / 12));

        emit ProposalCreated(proposalId, msg.sender, targets, values, calldatas, description);
        return proposalId;
    }

    // Gas-optimized voting function
    function castVote(bytes32 proposalId, bool support) external whenNotPaused nonReentrant {
        Proposal storage proposal = _proposals[proposalId];
        
        require(
            block.number >= proposal.startBlock && block.number <= proposal.endBlock,
            "BridgeGovernance: voting is closed"
        );
        require(!proposal.hasVoted[msg.sender], "BridgeGovernance: already voted");

        uint256 voterPower = _votingPower[msg.sender];
        require(voterPower > 0, "BridgeGovernance: no voting power");

        proposal.hasVoted[msg.sender] = true;

        if (support) {
            proposal.forVotes += uint32(voterPower);
        } else {
            proposal.againstVotes += uint32(voterPower);
        }

        emit VoteCast(msg.sender, proposalId, support, voterPower);
    }

    // Execute proposal with success verification
    function execute(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) external payable whenNotPaused nonReentrant returns (bytes32) {
        require(
            hasRole(EXECUTOR_ROLE, msg.sender),
            "BridgeGovernance: must have executor role"
        );

        bytes32 proposalId = keccak256(abi.encode(targets, values, calldatas, descriptionHash));
        Proposal storage proposal = _proposals[proposalId];

        require(
            block.number > proposal.endBlock,
            "BridgeGovernance: voting is still open"
        );
        require(!proposal.executed, "BridgeGovernance: proposal already executed");
        require(!proposal.canceled, "BridgeGovernance: proposal canceled");

        // Check if proposal passed
        uint256 totalVotes = proposal.forVotes + proposal.againstVotes;
        require(
            _isQuorumReached(totalVotes) && proposal.forVotes > proposal.againstVotes,
            "BridgeGovernance: proposal not passed"
        );

        proposal.executed = true;

        // Execute each action
        for (uint256 i = 0; i < targets.length;) {
            (bool success, bytes memory returndata) = targets[i].call{value: values[i]}(
                calldatas[i]
            );
            require(success, string(returndata));
            
            unchecked { ++i; }
        }

        emit ProposalExecuted(proposalId);
        return proposalId;
    }

    // Emergency functions
    function pause() external {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "BridgeGovernance: must be admin");
        _pause();
    }

    function unpause() external {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "BridgeGovernance: must be admin");
        _unpause();
    }

    // Internal helper functions
    function _isQuorumReached(uint256 totalVotes) internal pure returns (bool) {
        return totalVotes >= _quorumVotes();
    }

    function _quorumVotes() internal pure returns (uint256) {
        return (10000 * QUORUM_PERCENTAGE) / 100; // Base of 10000 for percentage
    }
}