// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DemoEIP3009Token
/// @notice Minimal mintable ERC-20 with EIP-3009 (transferWithAuthorization) support,
///         deployed to X Layer TESTNET ONLY to back Verigraph's self-facilitated x402
///         payment flow for the hackathon demo. Not audited, not for mainnet/real value —
///         `mint` is open so the demo can fund buyer wallets without an external faucet.
///
///         Implements the standard EIP-3009 typed-data flow (see
///         https://eips.ethereum.org/EIPS/eip-3009) so a buyer can pay by signing an
///         off-chain authorization instead of sending an on-chain approve+transferFrom —
///         exactly what x402's `exact` scheme expects. The seller (Verigraph's server)
///         verifies the signature itself and submits the authorization on the buyer's
///         behalf (gas-free on X Layer either way).
contract DemoEIP3009Token {
    string public constant name = "Verigraph Demo USD";
    string public constant symbol = "vUSD";
    uint8 public constant decimals = 6;
    string public constant EIP712_VERSION = "1";

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // authorizer => nonce => used
    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH =
        keccak256("CancelAuthorization(address authorizer,bytes32 nonce)");

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(EIP712_VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Demo-only faucet mint — never deploy this pattern with real value.
    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "ERC20: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    /// @notice Anyone (typically the seller/relayer) may submit a valid, signed authorization.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp > validAfter, "EIP3009: authorization not yet valid");
        require(block.timestamp < validBefore, "EIP3009: authorization expired");
        require(!_authorizationStates[from][nonce], "EIP3009: authorization already used");

        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == from, "EIP3009: invalid signature");

        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);

        _transfer(from, to, value);
    }

    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
        require(!_authorizationStates[authorizer][nonce], "EIP3009: authorization already used");

        bytes32 structHash = keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == authorizer, "EIP3009: invalid signature");

        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "ERC20: transfer to zero address");
        uint256 bal = balanceOf[from];
        require(bal >= value, "ERC20: insufficient balance");
        unchecked {
            balanceOf[from] = bal - value;
        }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
