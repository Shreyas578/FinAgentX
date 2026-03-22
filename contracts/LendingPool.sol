// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LendingPool
 * @notice Manages the USDT liquidity pool for FinAgentX autonomous lending
 * @dev All funds are held in Sepolia USDT: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
 */
contract LendingPool is Ownable, ReentrancyGuard {
    IERC20 public immutable usdt;
    address public loanManager;

    uint256 public totalDeposited;
    uint256 public totalBorrowed;
    uint256 public totalInterestEarned;
    uint256 public reserveRatio = 20; // 20% reserve

    mapping(address => uint256) public deposits;
    mapping(address => uint256) public depositShares;
    uint256 public totalShares;

    event Deposited(address indexed provider, uint256 amount, uint256 shares);
    event Withdrawn(address indexed provider, uint256 amount, uint256 shares);
    event FundsAllocated(address indexed to, uint256 amount);
    event FundsReturned(address indexed from, uint256 amount, uint256 interest);
    event ReserveRatioUpdated(uint256 newRatio);
    event LoanManagerUpdated(address indexed newManager);

    modifier onlyLoanManager() {
        require(msg.sender == loanManager, "LendingPool: only LoanManager");
        _;
    }

    constructor(address _usdt) Ownable(msg.sender) {
        usdt = IERC20(_usdt);
    }

    function setLoanManager(address _loanManager) external onlyOwner {
        loanManager = _loanManager;
        emit LoanManagerUpdated(_loanManager);
    }

    /// @notice Deposit USDT into the lending pool
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "LendingPool: amount must be > 0");
        require(usdt.transferFrom(msg.sender, address(this), amount), "LendingPool: transfer failed");

        uint256 sharesToMint;
        if (totalShares == 0 || totalDeposited == 0) {
            sharesToMint = amount;
        } else {
            sharesToMint = (amount * totalShares) / totalDeposited;
        }

        deposits[msg.sender] += amount;
        depositShares[msg.sender] += sharesToMint;
        totalShares += sharesToMint;
        totalDeposited += amount;

        emit Deposited(msg.sender, amount, sharesToMint);
    }

    /// @notice Withdraw USDT from the lending pool
    function withdraw(uint256 shareAmount) external nonReentrant {
        require(shareAmount > 0, "LendingPool: shares must be > 0");
        require(depositShares[msg.sender] >= shareAmount, "LendingPool: insufficient shares");

        uint256 poolBalance = usdt.balanceOf(address(this));
        uint256 amountToReturn = (shareAmount * poolBalance) / totalShares;

        uint256 available = poolBalance - (totalBorrowed * reserveRatio / 100);
        require(amountToReturn <= available, "LendingPool: insufficient liquidity");

        depositShares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalDeposited -= (deposits[msg.sender] * shareAmount / (depositShares[msg.sender] + shareAmount));

        require(usdt.transfer(msg.sender, amountToReturn), "LendingPool: transfer failed");
        emit Withdrawn(msg.sender, amountToReturn, shareAmount);
    }

    /// @notice Called by LoanManager to disburse loan funds
    function allocateFunds(address borrower, uint256 amount) external onlyLoanManager nonReentrant {
        require(usdt.balanceOf(address(this)) >= amount, "LendingPool: insufficient liquidity");
        uint256 minReserve = (totalDeposited * reserveRatio) / 100;
        require(usdt.balanceOf(address(this)) - amount >= minReserve, "LendingPool: reserve ratio breach");

        totalBorrowed += amount;
        require(usdt.transfer(borrower, amount), "LendingPool: disbursement failed");
        emit FundsAllocated(borrower, amount);
    }

    /// @notice Called by LoanManager when a loan is repaid
    function returnFunds(address borrower, uint256 principal, uint256 interest) external onlyLoanManager nonReentrant {
        require(usdt.transferFrom(borrower, address(this), principal + interest), "LendingPool: repayment transfer failed");
        totalBorrowed -= principal;
        totalInterestEarned += interest;
        emit FundsReturned(borrower, principal, interest);
    }

    function getAvailableLiquidity() external view returns (uint256) {
        uint256 balance = usdt.balanceOf(address(this));
        uint256 minReserve = (totalDeposited * reserveRatio) / 100;
        return balance > minReserve ? balance - minReserve : 0;
    }

    function getUtilizationRate() external view returns (uint256) {
        if (totalDeposited == 0) return 0;
        return (totalBorrowed * 10000) / totalDeposited; // basis points
    }

    function updateReserveRatio(uint256 newRatio) external onlyOwner {
        require(newRatio <= 50, "LendingPool: max reserve 50%");
        reserveRatio = newRatio;
        emit ReserveRatioUpdated(newRatio);
    }
}
