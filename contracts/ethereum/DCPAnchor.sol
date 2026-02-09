// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DCPAnchor
 * @notice Immutable on-chain anchoring of DCP bundle hashes and batch Merkle roots.
 * @dev Deploy on any EVM-compatible L2 (Base, Arbitrum, Optimism) for low-cost anchoring.
 *
 * Anchoring provides:
 *   1. Proof of existence — a bundle hash was known at a specific block timestamp
 *   2. Tamper evidence — any modification to the bundle invalidates the anchor
 *   3. Batch efficiency — anchor a Merkle root covering many bundles in one tx
 */
contract DCPAnchor {
    // ── Events ──

    /// @notice Emitted when an individual bundle hash is anchored.
    event BundleAnchored(
        bytes32 indexed bundleHash,
        address indexed submitter,
        uint256 timestamp
    );

    /// @notice Emitted when a batch Merkle root is anchored.
    event BatchAnchored(
        bytes32 indexed merkleRoot,
        uint256 bundleCount,
        address indexed submitter,
        uint256 timestamp
    );

    // ── Storage ──

    struct AnchorRecord {
        address submitter;
        uint256 timestamp;
        bool exists;
    }

    /// @notice Individual bundle hash anchors.
    mapping(bytes32 => AnchorRecord) public bundles;

    /// @notice Batch Merkle root anchors.
    mapping(bytes32 => AnchorRecord) public batches;

    /// @notice Total number of individual anchors.
    uint256 public totalAnchors;

    /// @notice Total number of batch anchors.
    uint256 public totalBatches;

    // ── Functions ──

    /**
     * @notice Anchor an individual bundle hash.
     * @param bundleHash SHA-256 hash of the canonical bundle (as bytes32).
     */
    function anchorBundle(bytes32 bundleHash) external {
        require(bundleHash != bytes32(0), "DCPAnchor: zero hash");
        require(!bundles[bundleHash].exists, "DCPAnchor: already anchored");

        bundles[bundleHash] = AnchorRecord({
            submitter: msg.sender,
            timestamp: block.timestamp,
            exists: true
        });
        totalAnchors++;

        emit BundleAnchored(bundleHash, msg.sender, block.timestamp);
    }

    /**
     * @notice Anchor a batch Merkle root covering multiple bundles.
     * @param merkleRoot Merkle root of the batch.
     * @param count Number of bundles in the batch.
     */
    function anchorBatch(bytes32 merkleRoot, uint256 count) external {
        require(merkleRoot != bytes32(0), "DCPAnchor: zero root");
        require(count > 0, "DCPAnchor: zero count");
        require(!batches[merkleRoot].exists, "DCPAnchor: already anchored");

        batches[merkleRoot] = AnchorRecord({
            submitter: msg.sender,
            timestamp: block.timestamp,
            exists: true
        });
        totalBatches++;

        emit BatchAnchored(merkleRoot, count, msg.sender, block.timestamp);
    }

    /**
     * @notice Check if a bundle hash has been anchored.
     * @param bundleHash The hash to check.
     * @return exists Whether the hash is anchored.
     * @return timestamp The block timestamp when it was anchored (0 if not).
     */
    function isAnchored(bytes32 bundleHash) external view returns (bool exists, uint256 timestamp) {
        AnchorRecord storage record = bundles[bundleHash];
        return (record.exists, record.timestamp);
    }

    /**
     * @notice Check if a batch Merkle root has been anchored.
     * @param merkleRoot The Merkle root to check.
     * @return exists Whether the root is anchored.
     * @return timestamp The block timestamp when it was anchored (0 if not).
     */
    function isBatchAnchored(bytes32 merkleRoot) external view returns (bool exists, uint256 timestamp) {
        AnchorRecord storage record = batches[merkleRoot];
        return (record.exists, record.timestamp);
    }
}
