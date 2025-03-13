// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IGovernanceFacet
 * @dev Interface for the GovernanceFacet
 */
interface IGovernanceFacet {
    enum VoteType {
        Against,
        For,
        Abstain
    }
    
    function initialize(
        uint256 votingDelay_,
        uint256 votingPeriod_,
        uint256 proposalThreshold_,
        uint256 quorumVotes_,
        uint256 timelockDelay_
    ) external;
    
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) external returns (uint256);
    
    function queue(uint256 proposalId) external;
    
    function execute(uint256 proposalId) external;
    
    function cancel(uint256 proposalId) external;
    
    function castVote(
        uint256 proposalId,
        uint8 support,
        string memory reason
    ) external returns (uint256);
    
    function castVoteBySig(
        uint256 proposalId,
        uint8 support,
        string memory reason,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256);
    
    function castVoteBySignature(
        address voter,
        uint256 proposalId,
        uint8 support,
        string memory reason,
        bytes memory signature
    ) external returns (uint256);
    
    function state(uint256 proposalId) external view returns (uint8);
    
    function getProposal(uint256 proposalId) external view returns (
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        uint256 startBlock,
        uint256 endBlock,
        address proposer,
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes
    );
    
    function getReceipt(uint256 proposalId, address voter) external view returns (
        bool hasVoted,
        VoteType support,
        uint256 votes
    );
    
    function getVotingPower(address account) external view returns (uint256);
    
    function setVotingPower(address account, uint256 newVotingPower) external;
    
    function proposalThreshold() external view returns (uint256);
    
    function votingDelay() external view returns (uint256);
    
    function votingPeriod() external view returns (uint256);
    
    function quorumVotes() external view returns (uint256);
    
    function timelockDelay() external view returns (uint256);
    
    function setVotingDelay(uint256 newVotingDelay) external;
    
    function setVotingPeriod(uint256 newVotingPeriod) external;
    
    function setProposalThreshold(uint256 newProposalThreshold) external;
    
    function setQuorumVotes(uint256 newQuorumVotes) external;
    
    function setTimelockDelay(uint256 newTimelockDelay) external;
    
    function getProposalCount() external view returns (uint256);
    
    function getProposalEta(uint256 proposalId) external view returns (uint256);
}