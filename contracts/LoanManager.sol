// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./LendingPool.sol";
import "./CreditScore.sol";

/**
 * @title LoanManager
 * @notice Core autonomous lending contract for FinAgentX
 * @dev Handles the full loan lifecycle: request → approve → repay → liquidate
 */
contract LoanManager is Ownable, ReentrancyGuard {

    LendingPool public lendingPool;
    CreditScore public creditScore;

    struct Asset {
        string symbol;
        address token;
        address pool;
        bool exists;
    }

    uint256 public nextLoanId = 1;
    uint256 public minCreditScore = 30;     
    uint256 public maxLoanAmount = 10000e6; 
    uint256 public minLoanDuration = 1 minutes;
    uint256 public maxLoanDuration = 90 days;
    uint256 public baseLiquidationPenalty = 500; 

    enum LoanStatus { Requested, Approved, Repaid, Defaulted, Liquidated }

    struct Loan {
        uint256 id;
        address borrower;
        uint256 amount;         
        uint256 interestRate;   
        uint256 dueDate;
        uint256 issuedAt;
        uint256 repaidAt;
        uint256 creditScoreAtIssuance;
        uint256 defaultProbability; 
        LoanStatus status;
        string llmExplanation;  
        string assetSymbol;     // Token used for this loan
    }

    mapping(uint256 => Loan) public loans;
    mapping(address => uint256[]) public borrowerLoans;
    mapping(address => uint256) public activeLoanId; 

    mapping(string => Asset) public registeredAssets;
    string[] public assetSymbols;

    // Agent-to-agent lending registry
    mapping(address => bool) public registeredAgents;
    uint256[] public agentLoanIds;

    event LoanRequested(uint256 indexed loanId, address indexed borrower, uint256 amount, string assetSymbol);
    event LoanApproved(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 interestRate, uint256 dueDate);
    event LoanRejected(uint256 indexed loanId, address indexed borrower, string reason);
    event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint256 totalRepaid);
    event LoanDefaulted(uint256 indexed loanId, address indexed borrower, uint256 amountOutstanding);
    event LoanLiquidated(uint256 indexed loanId, address indexed borrower, uint256 penalty);
    event AgentRegistered(address indexed agent);
    event AgentLoanIssued(uint256 indexed loanId, address indexed fromAgent, address indexed toAgent, uint256 amount);

    modifier onlyOwnerOrAgent() {
        require(msg.sender == owner() || registeredAgents[msg.sender], "LoanManager: unauthorized");
        _;
    }

    constructor(address _lendingPool, address _creditScore) Ownable(msg.sender) {
        lendingPool = LendingPool(_lendingPool);
        creditScore = CreditScore(_creditScore);
    }

    /// @notice Borrower requests a loan — triggers agent evaluation off-chain
    function requestLoan(uint256 amount, uint256 durationSeconds, string calldata assetSymbol) external returns (uint256 loanId) {
        require(registeredAssets[assetSymbol].exists, "LoanManager: invalid asset");
        require(amount > 0, "LoanManager: invalid amount");
        require(durationSeconds >= minLoanDuration && durationSeconds <= maxLoanDuration, "LoanManager: invalid duration");
        require(activeLoanId[msg.sender] == 0, "LoanManager: existing active loan");

        loanId = nextLoanId++;
        loans[loanId] = Loan({
            id: loanId,
            borrower: msg.sender,
            amount: amount,
            interestRate: 0,
            dueDate: block.timestamp + durationSeconds,
            issuedAt: 0,
            repaidAt: 0,
            creditScoreAtIssuance: creditScore.getScore(msg.sender),
            defaultProbability: 0,
            status: LoanStatus.Requested,
            llmExplanation: "",
            assetSymbol: assetSymbol
        });

        borrowerLoans[msg.sender].push(loanId);
        emit LoanRequested(loanId, msg.sender, amount, assetSymbol);
    }

    /// @notice Agent approves and disburses loan after ML/LLM evaluation
    function approveLoan(
        uint256 loanId,
        uint256 interestRate,
        uint256 defaultProbBps,
        string calldata explanation
    ) external onlyOwnerOrAgent nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Requested, "LoanManager: loan not in requested state");
        require(interestRate <= 5000, "LoanManager: rate too high"); // max 50%

        uint256 score = creditScore.getScore(loan.borrower);
        require(score >= minCreditScore, "LoanManager: credit score too low");

        loan.status = LoanStatus.Approved;
        loan.interestRate = interestRate;
        loan.issuedAt = block.timestamp;
        loan.defaultProbability = defaultProbBps;
        loan.llmExplanation = explanation;
        activeLoanId[loan.borrower] = loanId;

        // Update on-chain credit score
        creditScore.recordLoanIssuance(loan.borrower, loanId);

        // Disburse funds from pool
        string memory symbol = loan.assetSymbol;
        LendingPool(registeredAssets[symbol].pool).allocateFunds(loan.borrower, loan.amount);

        emit LoanApproved(loanId, loan.borrower, loan.amount, interestRate, loan.dueDate);
    }

    /// @notice Agent rejects a loan request
    function rejectLoan(uint256 loanId, string calldata reason) external onlyOwnerOrAgent {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Requested, "LoanManager: loan not in requested state");
        loan.status = LoanStatus.Defaulted; // Use Defaulted to mark rejection
        loan.llmExplanation = reason;
        emit LoanRejected(loanId, loan.borrower, reason);
    }

    /// @notice Borrower repays their loan
    function repayLoan(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.borrower == msg.sender, "LoanManager: not borrower");
        require(loan.status == LoanStatus.Approved, "LoanManager: loan not active");

        uint256 interest = calculateInterest(loan.amount, loan.interestRate, loan.issuedAt);
        uint256 totalDue = loan.amount + interest;

        loan.status = LoanStatus.Repaid;
        loan.repaidAt = block.timestamp;
        activeLoanId[msg.sender] = 0;

        // Update credit score positively
        creditScore.recordRepayment(msg.sender, loanId, true);

        // Return funds + interest to pool (borrower must approve USDT first)
        string memory symbol = loan.assetSymbol;
        LendingPool(registeredAssets[symbol].pool).returnFunds(msg.sender, loan.amount, interest);

        emit LoanRepaid(loanId, msg.sender, totalDue);
    }

    /// @notice Agent autonomously collects repayment for an active loan
    function collectRepayment(uint256 loanId) external onlyOwnerOrAgent nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Approved, "LoanManager: loan not active");
        
        uint256 interest = calculateInterest(loan.amount, loan.interestRate, loan.issuedAt);
        uint256 totalDue = loan.amount + interest;

        loan.status = LoanStatus.Repaid;
        loan.repaidAt = block.timestamp;
        activeLoanId[loan.borrower] = 0;

        // Update credit score positively
        creditScore.recordRepayment(loan.borrower, loanId, true);

        // Return funds + interest to pool (requires prior approval from borrower)
        string memory symbol = loan.assetSymbol;
        LendingPool(registeredAssets[symbol].pool).returnFunds(loan.borrower, loan.amount, interest);

        emit LoanRepaid(loanId, loan.borrower, totalDue);
    }

    /// @notice Agent liquidates defaulted loan
    function liquidateLoan(uint256 loanId) external onlyOwnerOrAgent nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Approved, "LoanManager: loan not active");
        require(block.timestamp > loan.dueDate, "LoanManager: loan not overdue");

        loan.status = LoanStatus.Liquidated;
        activeLoanId[loan.borrower] = 0;

        uint256 outstanding = loan.amount + calculateInterest(loan.amount, loan.interestRate, loan.issuedAt);
        uint256 penalty = (outstanding * baseLiquidationPenalty) / 10000;

        // Negative credit impact
        creditScore.recordRepayment(loan.borrower, loanId, false);

        emit LoanDefaulted(loanId, loan.borrower, outstanding);
        emit LoanLiquidated(loanId, loan.borrower, penalty);
    }

    /// @notice Mark loan as defaulted (without liquidation attempt)
    function markDefault(uint256 loanId) external onlyOwnerOrAgent {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Approved, "LoanManager: loan not active");
        require(block.timestamp > loan.dueDate, "LoanManager: not overdue");

        loan.status = LoanStatus.Defaulted;
        activeLoanId[loan.borrower] = 0;
        creditScore.recordRepayment(loan.borrower, loanId, false);

        emit LoanDefaulted(loanId, loan.borrower, loan.amount);
    }

    /// @notice Register a trusted asset pool
    function registerAsset(string calldata symbol, address token, address pool) external onlyOwner {
        registeredAssets[symbol] = Asset({
            symbol: symbol,
            token: token,
            pool: pool,
            exists: true
        });
        assetSymbols.push(symbol);
    }

    /// @notice Register a trusted agent address (for agent-to-agent lending)
    function registerAgent(address agent) external onlyOwner {
        registeredAgents[agent] = true;
        emit AgentRegistered(agent);
    }

    /// @notice Calculate accrued interest
    function calculateInterest(uint256 principal, uint256 rateBps, uint256 startTime) public view returns (uint256) {
        uint256 elapsed = block.timestamp - startTime;
        // Simple interest: principal * rate * time / (365 days * 10000)
        return (principal * rateBps * elapsed) / (365 days * 10000);
    }

    /// @notice Get full loan details
    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    /// @notice Get all loans for a borrower
    function getBorrowerLoans(address borrower) external view returns (uint256[] memory) {
        return borrowerLoans[borrower];
    }

    /// @notice Get overdue loans for agent monitoring
    function isOverdue(uint256 loanId) external view returns (bool) {
        Loan storage loan = loans[loanId];
        return loan.status == LoanStatus.Approved && block.timestamp > loan.dueDate;
    }

    function updateMinCreditScore(uint256 score) external onlyOwner {
        minCreditScore = score;
    }

    function updateMaxLoanAmount(uint256 amount) external onlyOwner {
        maxLoanAmount = amount;
    }

    function updateMinLoanDuration(uint256 duration) external onlyOwner {
        minLoanDuration = duration;
    }

    function updateMaxLoanDuration(uint256 duration) external onlyOwner {
        maxLoanDuration = duration;
    }
}
