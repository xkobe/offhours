// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title HoodScope Anchor Registry
/// @notice On-chain anchor point for verified report hashes.
///         Anchors a SHA-256 report hash to an IPFS CID with a timestamp, so any
///         report can be independently verified as unchanged since anchoring.
contract AnchorRegistry {
    struct Anchor {
        string cid;
        uint256 timestamp;
        address anchoredBy;
    }

    address public owner;
    mapping(bytes32 => Anchor) public anchors;

    event Anchored(bytes32 indexed reportHash, string cid, uint256 timestamp, address indexed anchoredBy);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    /// @notice Anchor a report hash to its IPFS CID. Owner-only.
    function anchor(bytes32 reportHash, string calldata cid) external onlyOwner {
        anchors[reportHash] = Anchor(cid, block.timestamp, msg.sender);
        emit Anchored(reportHash, cid, block.timestamp, msg.sender);
    }

    /// @notice Read an anchor record.
    function getAnchor(bytes32 reportHash)
        external
        view
        returns (string memory cid, uint256 timestamp, address anchoredBy)
    {
        Anchor memory a = anchors[reportHash];
        return (a.cid, a.timestamp, a.anchoredBy);
    }

    /// @notice Whether a hash has been anchored.
    function has(bytes32 reportHash) external view returns (bool) {
        return anchors[reportHash].timestamp != 0;
    }
}
