// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DCPAnchor } from "../src/DCPAnchor.sol";

contract DCPAnchorTest is Test {
    DCPAnchor anchor;
    address owner = address(this);
    address submitter = address(0xBEEF);
    address outsider = address(0xDEAD);

    function setUp() public {
        anchor = new DCPAnchor();
        anchor.addSubmitter(submitter);
    }

    function test_owner_is_deployer() public {
        assertEq(anchor.owner(), owner);
    }

    function test_authorised_submitter_can_anchor() public {
        bytes32 h = keccak256("bundle-1");
        vm.prank(submitter);
        anchor.anchorBundle(h);
        (bool exists, uint256 ts, address who) = anchor.isAnchored(h);
        assertTrue(exists);
        assertEq(ts, block.timestamp);
        assertEq(who, submitter);
    }

    function test_outsider_cannot_anchor() public {
        bytes32 h = keccak256("bundle-2");
        vm.prank(outsider);
        vm.expectRevert();
        anchor.anchorBundle(h);
    }

    function test_batch_anchoring() public {
        bytes32 root = keccak256("merkle-root");
        vm.prank(submitter);
        anchor.anchorBatch(root, 42);
        (bool exists, uint256 ts, uint256 count, address who) = anchor.isBatchAnchored(root);
        assertTrue(exists);
        assertEq(count, 42);
        assertEq(ts, block.timestamp);
        assertEq(who, submitter);
    }

    function test_pause_blocks_anchoring() public {
        anchor.pause();
        bytes32 h = keccak256("bundle-3");
        vm.prank(submitter);
        vm.expectRevert();
        anchor.anchorBundle(h);
    }

    function test_ownership_transfer() public {
        address newOwner = address(0xCAFE);
        anchor.transferOwnership(newOwner);
        assertEq(anchor.owner(), newOwner);
    }
}
