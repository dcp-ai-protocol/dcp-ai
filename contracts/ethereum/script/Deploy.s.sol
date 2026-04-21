// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { DCPAnchor } from "../src/DCPAnchor.sol";

/**
 * @title DeployDCPAnchor
 * @notice Deployment script for the DCPAnchor contract.
 *
 * Usage:
 *   forge script script/Deploy.s.sol --rpc-url <network> --broadcast --verify
 *
 * The deployer address becomes the contract owner (constructor uses
 * msg.sender). Additional submitters can be added after deployment:
 *
 *   cast send <ADDRESS> "addSubmitter(address)" <SUBMITTER> \
 *     --rpc-url <network> --account <keystore>
 *
 * Required environment:
 *   PRIVATE_KEY or DEPLOYER_ACCOUNT (keystore account)
 * Optional (for submitter pre-authorisation):
 *   INITIAL_SUBMITTER — address to grant submitter role immediately
 */
contract DeployDCPAnchor is Script {
    function run() external returns (DCPAnchor anchor) {
        uint256 deployerPk = vm.envOr("PRIVATE_KEY", uint256(0));
        address initialSubmitter = vm.envOr("INITIAL_SUBMITTER", address(0));

        if (deployerPk != 0) {
            vm.startBroadcast(deployerPk);
        } else {
            // Falls back to --account <keystore> / --sender flags.
            vm.startBroadcast();
        }

        anchor = new DCPAnchor();
        console.log("DCPAnchor deployed at:", address(anchor));
        console.log("Owner:", anchor.owner());

        if (initialSubmitter != address(0) && initialSubmitter != anchor.owner()) {
            anchor.addSubmitter(initialSubmitter);
            console.log("Authorised submitter:", initialSubmitter);
        }

        vm.stopBroadcast();
    }
}
