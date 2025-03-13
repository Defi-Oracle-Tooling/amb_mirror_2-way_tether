// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./BridgeErrors.sol";

contract BridgeMirror is ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;

    // Using uint256 for gas optimization over bool
    uint256 private constant NOT_INITIALIZED = 1;
    uint256 private constant INITIALIZED = 2;
    uint256 private _status;

    // Using bytes32 for gas optimization over string
    bytes32 private constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");
    
    // Packed structs for gas optimization
    struct AssetInfo {
        uint128 totalLocked;   // Pack these two uint128s into a single slot
        uint128 dailyLimit;
        uint8 assetType;      // Pack these smaller values together
        uint8 status;
        uint16 bridgeFee;     // basis points
    }

    // Using immutable for gas savings
    address private immutable _admin;
    
    // Using EnumerableSet for gas-efficient operations
    EnumerableSet.AddressSet private _supportedAssets;
    
    // Mapping for O(1) lookups
    mapping(address => AssetInfo) private _assetInfo;
    mapping(bytes32 => uint256) private _usedNonces;
    
    // Events moved to interface
    
    constructor(address admin_) {
        require(admin_ != address(0), "BridgeMirror: zero address");
        _admin = admin_;
        _status = NOT_INITIALIZED;
    }

    // Using memory instead of storage where possible
    function initialize(address[] memory initialAssets, uint128[] memory limits) external {
        require(_status == NOT_INITIALIZED, "BridgeMirror: already initialized");
        require(initialAssets.length == limits.length, "BridgeMirror: length mismatch");
        
        for (uint256 i = 0; i < initialAssets.length;) {
            _addAsset(initialAssets[i], limits[i]);
            // Using unchecked for gas optimization where overflow is impossible
            unchecked { ++i; }
        }
        
        _status = INITIALIZED;
    }

    function bridgeAsset(
        address asset,
        uint256 amount,
        address recipient
    ) external nonReentrant {
        // Cache storage variables in memory
        AssetInfo memory assetInfo = _assetInfo[asset];
        require(assetInfo.status == 1, "BridgeMirror: asset not supported");
        
        // Using custom errors instead of require strings
        if (amount == 0) revert BridgeErrors.InvalidAmount(0);
        if (amount > assetInfo.dailyLimit) revert BridgeErrors.ExcessiveAmount(amount, assetInfo.dailyLimit);
        
        // Update state
        unchecked {
            assetInfo.totalLocked += uint128(amount);
        }
        _assetInfo[asset] = assetInfo;
        
        // Emit event defined in interface
        emit AssetBridged(asset, msg.sender, recipient, amount);
    }

    function claimAsset(bytes calldata proof) external nonReentrant {
        bytes32 proofHash = keccak256(proof);
        require(_usedNonces[proofHash] == 0, "BridgeMirror: proof used");
        
        // Mark proof as used immediately to prevent reentrancy
        _usedNonces[proofHash] = 1;
        
        // Process proof and transfer assets
        (address asset, address recipient, uint256 amount) = _processProof(proof);
        
        // Update state and transfer
        AssetInfo storage assetInfo = _assetInfo[asset];
        unchecked {
            assetInfo.totalLocked -= uint128(amount);
        }
        
        // External calls last to prevent reentrancy
        _transferAsset(asset, recipient, amount);
        
        emit AssetClaimed(asset, recipient, amount, proofHash);
    }

    // Internal functions
    function _addAsset(address asset, uint128 limit) internal {
        if (asset == address(0)) revert BridgeErrors.ZeroAddress();
        if (_supportedAssets.contains(asset)) revert BridgeErrors.UnsupportedAsset(asset);
        
        _supportedAssets.add(asset);
        _assetInfo[asset] = AssetInfo({
            totalLocked: 0,
            dailyLimit: limit,
            assetType: 1, // Default to ERC20
            status: 1,    // Active
            bridgeFee: 30 // 0.3%
        });
    }

    function _processProof(bytes calldata proof) internal pure returns (
        address asset,
        address recipient,
        uint256 amount
    ) {
        // Proof validation logic here
        // Using assembly for efficient proof parsing
        assembly {
            // Load first 32 bytes for asset address
            asset := calldataload(add(proof.offset, 0))
            // Load next 32 bytes for recipient address
            recipient := calldataload(add(proof.offset, 32))
            // Load next 32 bytes for amount
            amount := calldataload(add(proof.offset, 64))
        }
    }

    function _transferAsset(address asset, address recipient, uint256 amount) internal {
        // Asset transfer logic here
    }
}