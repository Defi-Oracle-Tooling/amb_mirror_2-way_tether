// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

contract ERC777Facet is ERC20Permit, ERC20Votes {
    constructor() ERC20("ERC777Facet", "ERC777F") ERC20Permit("ERC777Facet") {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }

    // The following functions are overrides required by Solidity
    function _update(address from, address to, uint256 amount) internal virtual override(ERC20, ERC20Votes) {
        super._update(from, to, amount);
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}