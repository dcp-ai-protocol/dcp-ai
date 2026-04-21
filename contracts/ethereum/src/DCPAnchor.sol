// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DCPAnchor
 * @notice On-chain anchoring of DCP bundle hashes and batch Merkle roots.
 * @dev Deploy on any EVM-compatible L2 (Base, Arbitrum, Optimism) for low-cost anchoring.
 *
 * Anchoring provides:
 *   1. Proof of existence — a bundle hash was known at a specific block timestamp
 *   2. Tamper evidence — any modification to the bundle invalidates the anchor
 *   3. Batch efficiency — anchor a Merkle root covering many bundles in one tx
 *
 * Security features:
 *   - Role-based access control (owner + authorized submitters)
 *   - Commit-reveal scheme to prevent front-running
 *   - Emergency pause mechanism
 *   - Batch size limits
 */
contract DCPAnchor {
    // ── Events ──

    /// @notice Emitted when an individual bundle hash is anchored.
    event BundleAnchored(bytes32 indexed bundleHash, address indexed submitter, uint256 timestamp);

    /// @notice Emitted when a batch Merkle root is anchored.
    event BatchAnchored(
        bytes32 indexed merkleRoot,
        uint256 bundleCount,
        address indexed submitter,
        uint256 timestamp
    );

    event SubmitterAdded(address indexed submitter);
    event SubmitterRemoved(address indexed submitter);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnerTransferred(address indexed oldOwner, address indexed newOwner);
    event CommitSubmitted(bytes32 indexed commitHash, address indexed submitter);

    // ── Storage ──

    struct AnchorRecord {
        address submitter;
        uint256 timestamp;
        uint256 count;
        bool exists;
    }

    struct Commitment {
        address submitter;
        uint256 blockNumber;
        bool revealed;
    }

    address public owner;
    bool public paused;

    mapping(address => bool) public authorizedSubmitters;
    mapping(bytes32 => AnchorRecord) public bundles;
    mapping(bytes32 => AnchorRecord) public batches;
    mapping(bytes32 => Commitment) public commitments;

    uint256 public totalAnchors;
    uint256 public totalBatches;

    uint256 public constant MAX_BATCH_SIZE = 10_000;
    uint256 public constant COMMIT_DELAY = 1;
    uint256 public constant COMMIT_EXPIRY = 256;

    // ── Modifiers ──

    modifier onlyOwner() {
        require(msg.sender == owner, "DCPAnchor: caller is not owner");
        _;
    }

    modifier onlyAuthorized() {
        require(
            authorizedSubmitters[msg.sender] || msg.sender == owner,
            "DCPAnchor: unauthorized submitter"
        );
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "DCPAnchor: contract is paused");
        _;
    }

    // ── Constructor ──

    constructor() {
        owner = msg.sender;
        authorizedSubmitters[msg.sender] = true;
        emit OwnerTransferred(address(0), msg.sender);
        emit SubmitterAdded(msg.sender);
    }

    // ── Admin Functions ──

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "DCPAnchor: zero address");
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    function addSubmitter(address submitter) external onlyOwner {
        require(submitter != address(0), "DCPAnchor: zero address");
        authorizedSubmitters[submitter] = true;
        emit SubmitterAdded(submitter);
    }

    function removeSubmitter(address submitter) external onlyOwner {
        authorizedSubmitters[submitter] = false;
        emit SubmitterRemoved(submitter);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ── Commit-Reveal (front-running protection) ──

    /**
     * @notice Phase 1: Submit a commitment hash to reserve an anchor slot.
     * @param commitHash keccak256(abi.encodePacked(bundleHash, salt, msg.sender))
     */
    function commit(bytes32 commitHash) external onlyAuthorized whenNotPaused {
        require(commitHash != bytes32(0), "DCPAnchor: zero commit");
        require(commitments[commitHash].blockNumber == 0, "DCPAnchor: commit exists");

        commitments[commitHash] =
            Commitment({ submitter: msg.sender, blockNumber: block.number, revealed: false });

        emit CommitSubmitted(commitHash, msg.sender);
    }

    /**
     * @notice Phase 2: Reveal and anchor a bundle hash using a prior commitment.
     * @param bundleHash SHA-256 hash of the canonical bundle (as bytes32).
     * @param salt Random salt used in the commitment.
     */
    function revealAndAnchorBundle(bytes32 bundleHash, bytes32 salt)
        external
        onlyAuthorized
        whenNotPaused
    {
        require(bundleHash != bytes32(0), "DCPAnchor: zero hash");
        require(!bundles[bundleHash].exists, "DCPAnchor: already anchored");

        bytes32 commitHash = keccak256(abi.encodePacked(bundleHash, salt, msg.sender));
        Commitment storage c = commitments[commitHash];

        require(c.blockNumber > 0, "DCPAnchor: no commitment found");
        require(c.submitter == msg.sender, "DCPAnchor: not commitment owner");
        require(!c.revealed, "DCPAnchor: already revealed");
        require(block.number > c.blockNumber + COMMIT_DELAY, "DCPAnchor: reveal too early");
        require(block.number <= c.blockNumber + COMMIT_EXPIRY, "DCPAnchor: commitment expired");

        c.revealed = true;

        bundles[bundleHash] = AnchorRecord({
            submitter: msg.sender, timestamp: block.timestamp, count: 1, exists: true
        });
        totalAnchors++;

        emit BundleAnchored(bundleHash, msg.sender, block.timestamp);
    }

    /**
     * @notice Direct anchor (for trusted submitters in low-risk scenarios).
     * @param bundleHash SHA-256 hash of the canonical bundle (as bytes32).
     */
    function anchorBundle(bytes32 bundleHash) external onlyAuthorized whenNotPaused {
        require(bundleHash != bytes32(0), "DCPAnchor: zero hash");
        require(!bundles[bundleHash].exists, "DCPAnchor: already anchored");

        bundles[bundleHash] = AnchorRecord({
            submitter: msg.sender, timestamp: block.timestamp, count: 1, exists: true
        });
        totalAnchors++;

        emit BundleAnchored(bundleHash, msg.sender, block.timestamp);
    }

    /**
     * @notice Anchor a batch Merkle root covering multiple bundles.
     * @param merkleRoot Merkle root of the batch.
     * @param count Number of bundles in the batch (1 to MAX_BATCH_SIZE).
     */
    function anchorBatch(bytes32 merkleRoot, uint256 count) external onlyAuthorized whenNotPaused {
        require(merkleRoot != bytes32(0), "DCPAnchor: zero root");
        require(count > 0 && count <= MAX_BATCH_SIZE, "DCPAnchor: invalid count");
        require(!batches[merkleRoot].exists, "DCPAnchor: already anchored");

        batches[merkleRoot] = AnchorRecord({
            submitter: msg.sender, timestamp: block.timestamp, count: count, exists: true
        });
        totalBatches++;

        emit BatchAnchored(merkleRoot, count, msg.sender, block.timestamp);
    }

    // ── View Functions ──

    function isAnchored(bytes32 bundleHash)
        external
        view
        returns (bool exists, uint256 timestamp, address submitter)
    {
        AnchorRecord storage record = bundles[bundleHash];
        return (record.exists, record.timestamp, record.submitter);
    }

    function isBatchAnchored(bytes32 merkleRoot)
        external
        view
        returns (bool exists, uint256 timestamp, uint256 count, address submitter)
    {
        AnchorRecord storage record = batches[merkleRoot];
        return (record.exists, record.timestamp, record.count, record.submitter);
    }
}
