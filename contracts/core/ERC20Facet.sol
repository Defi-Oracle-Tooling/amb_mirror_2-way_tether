// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Facet is ERC20 {
    constructor() ERC20("ERC20Facet", "ERC20F") {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
}
