// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CreditScore
 * @notice Persistent DID-based on-chain credit identity for FinAgentX borrowers
 * @dev Credit scores range 0–100 and are updated by the LoanManager
 */
contract CreditScore is Ownable {

    address public loanManager;

    struct CreditProfile {
        uint256 score;              // 0–100
        uint256 totalLoans;
        uint256 successfulRepayments;
        uint256 failedRepayments;
        uint256 lastUpdated;
        uint256 firstLoanTimestamp;
        bool exists;
        uint256[] loanIds;
    }

    mapping(address => CreditProfile) private profiles;

    // Score adjustment parameters
    uint256 public constant BASE_SCORE = 50;
    uint256 public constant MAX_SCORE = 100;
    uint256 public constant MIN_SCORE = 0;
    uint256 public constant REPAYMENT_BONUS = 5;
    uint256 public constant DEFAULT_PENALTY = 15;
    uint256 public constant NEW_BORROWER_SCORE = 50;

    event ScoreInitialized(address indexed borrower, uint256 score);
    event ScoreUpdated(address indexed borrower, uint256 oldScore, uint256 newScore, string reason);
    event LoanRecorded(address indexed borrower, uint256 loanId, bool repaid);
    event LoanManagerUpdated(address indexed newManager);

    modifier onlyLoanManager() {
        require(msg.sender == loanManager || msg.sender == owner(), "CreditScore: unauthorized");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setLoanManager(address _loanManager) external onlyOwner {
        loanManager = _loanManager;
        emit LoanManagerUpdated(_loanManager);
    }

    /// @notice Initialize or fetch a borrower's credit profile
    function initProfile(address borrower) external onlyLoanManager {
        if (!profiles[borrower].exists) {
            profiles[borrower] = CreditProfile({
                score: NEW_BORROWER_SCORE,
                totalLoans: 0,
                successfulRepayments: 0,
                failedRepayments: 0,
                lastUpdated: block.timestamp,
                firstLoanTimestamp: block.timestamp,
                exists: true,
                loanIds: new uint256[](0)
            });
            emit ScoreInitialized(borrower, NEW_BORROWER_SCORE);
        }
    }

    /// @notice Called by LoanManager when a loan is approved
    function recordLoanIssuance(address borrower, uint256 loanId) external onlyLoanManager {
        if (!profiles[borrower].exists) {
            profiles[borrower].score = NEW_BORROWER_SCORE;
            profiles[borrower].exists = true;
            profiles[borrower].firstLoanTimestamp = block.timestamp;
        }
        profiles[borrower].totalLoans += 1;
        profiles[borrower].loanIds.push(loanId);
        profiles[borrower].lastUpdated = block.timestamp;
    }

    /// @notice Called by LoanManager on repayment or default
    function recordRepayment(address borrower, uint256 loanId, bool success) external onlyLoanManager {
        require(profiles[borrower].exists, "CreditScore: profile not found");

        CreditProfile storage profile = profiles[borrower];
        uint256 oldScore = profile.score;

        if (success) {
            profile.successfulRepayments += 1;
            // Score increases with successful repayments, but diminishes at higher scores
            uint256 bonus = REPAYMENT_BONUS;
            if (profile.score >= 80) bonus = 2;
            else if (profile.score >= 60) bonus = 3;

            profile.score = profile.score + bonus > MAX_SCORE
                ? MAX_SCORE
                : profile.score + bonus;

            emit ScoreUpdated(borrower, oldScore, profile.score, "repaid");
        } else {
            profile.failedRepayments += 1;
            // Score decreases on default, more severe if already low
            uint256 penalty = DEFAULT_PENALTY;
            if (profile.score <= 30) penalty = 20;

            profile.score = profile.score < penalty
                ? MIN_SCORE
                : profile.score - penalty;

            emit ScoreUpdated(borrower, oldScore, profile.score, "defaulted");
        }

        profile.lastUpdated = block.timestamp;
        emit LoanRecorded(borrower, loanId, success);
    }

    /// @notice Agent can manually adjust score (e.g., from ML model updates)
    function adjustScore(address borrower, uint256 newScore, string calldata reason) external onlyLoanManager {
        require(newScore <= MAX_SCORE, "CreditScore: score out of range");
        if (!profiles[borrower].exists) {
            profiles[borrower].exists = true;
            profiles[borrower].firstLoanTimestamp = block.timestamp;
        }
        uint256 oldScore = profiles[borrower].score;
        profiles[borrower].score = newScore;
        profiles[borrower].lastUpdated = block.timestamp;
        emit ScoreUpdated(borrower, oldScore, newScore, reason);
    }

    /// @notice Get a borrower's current credit score
    function getScore(address borrower) external view returns (uint256) {
        if (!profiles[borrower].exists) return NEW_BORROWER_SCORE;
        return profiles[borrower].score;
    }

    /// @notice Get full credit profile
    function getProfile(address borrower) external view returns (
        uint256 score,
        uint256 totalLoans,
        uint256 successfulRepayments,
        uint256 failedRepayments,
        uint256 lastUpdated,
        bool exists
    ) {
        CreditProfile storage p = profiles[borrower];
        return (p.score, p.totalLoans, p.successfulRepayments, p.failedRepayments, p.lastUpdated, p.exists);
    }

    function getLoanIds(address borrower) external view returns (uint256[] memory) {
        return profiles[borrower].loanIds;
    }

    /// @notice Compute repayment rate for ML feature generation
    function getRepaymentRate(address borrower) external view returns (uint256) {
        CreditProfile storage p = profiles[borrower];
        if (p.totalLoans == 0) return 100; // Default to perfect for new borrowers
        return (p.successfulRepayments * 100) / p.totalLoans;
    }
}
