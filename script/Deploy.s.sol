// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../contracts/core/BridgeMirror.sol";
import "../contracts/governance/BridgeGovernance.sol";

contract DeployScript is Script {
    function readConfig() internal view returns (
        address[] memory admins,
        address[] memory operators,
        address[] memory guardians,
        uint256 requiredSignatures
    ) {
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/config/", vm.envString("DEPLOY_ENV"), ".json");
        string memory json = vm.readFile(path);
        
        admins = vm.parseJsonAddressArray(json, ".initialAdmins");
        operators = vm.parseJsonAddressArray(json, ".initialOperators");
        guardians = vm.parseJsonAddressArray(json, ".initialGuardians");
        requiredSignatures = vm.parseJsonUint(json, ".requiredSignatures");
    }

    function run() public {
        (
            address[] memory admins,
            address[] memory operators,
            address[] memory guardians,
            uint256 requiredSignatures
        ) = readConfig();

        require(admins.length >= requiredSignatures, "Not enough admins");

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // Deploy Governance
        BridgeGovernance governance = new BridgeGovernance();
        console.log("BridgeGovernance deployed at:", address(governance));

        // Deploy Bridge
        BridgeMirror bridge = new BridgeMirror(address(governance));
        console.log("BridgeMirror deployed at:", address(bridge));

        // Setup roles
        for (uint i = 0; i < admins.length; i++) {
            governance.assignRole(admins[i], IBridgeGovernance.Role.ADMIN);
            console.log("Assigned ADMIN role to:", admins[i]);
        }

        for (uint i = 0; i < operators.length; i++) {
            governance.assignRole(operators[i], IBridgeGovernance.Role.OPERATOR);
            console.log("Assigned OPERATOR role to:", operators[i]);
        }

        for (uint i = 0; i < guardians.length; i++) {
            governance.assignRole(guardians[i], IBridgeGovernance.Role.GUARDIAN);
            console.log("Assigned GUARDIAN role to:", guardians[i]);
        }

        // Set signature threshold
        governance.updateThreshold(requiredSignatures);
        console.log("Set signature threshold to:", requiredSignatures);

        vm.stopBroadcast();

        // Save deployment info
        string memory deploymentInfo = string.concat(
            '{"network":"', vm.toString(block.chainid),
            '","governance":"', vm.toString(address(governance)),
            '","bridge":"', vm.toString(address(bridge)),
            '","timestamp":"', vm.toString(block.timestamp),
            '"}'
        );

        string memory deploymentPath = string.concat(
            vm.projectRoot(),
            "/deployments/",
            vm.envString("DEPLOY_ENV"),
            "/",
            vm.toString(block.chainid),
            ".json"
        );

        vm.writeFile(deploymentPath, deploymentInfo);
        console.log("Deployment info saved to:", deploymentPath);
    }
}