// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

contract VulnerableVault {
    mapping(address => uint256) public balances;

    function deposit() public payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() public {
        uint256 amount = balances[msg.sender];

        require(amount > 0, "Vault: nothing to withdraw");

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Vault: send failed");

        balances[msg.sender] = 0;
    }

    function vaultBalance() public view returns (uint256) {
        return address(this).balance;
    }
}