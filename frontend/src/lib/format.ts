export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * wagmi/viem wrap the wallet extension's own error as a generic
 * "User rejected the request". For code 4001 + "wallet must has at least
 * one account": despite the wording, this is NOT actually about a missing
 * account — it's a documented MetaMask bug (github.com/MetaMask/
 * metamask-extension issues #15686 / #15651, also reported against other
 * extensions) caused by stale/corrupted connection state, confirmed live to
 * still fire even with exactly one extension installed and a real account
 * present. A plain retry sometimes works; revoking the site's existing
 * connection in the extension and reconnecting fresh is more reliable.
 */
export function describeConnectError(error: Error): string {
  const message = error.message ?? "";
  if (/at least one account/i.test(message)) {
    return "Your wallet extension returned a known buggy error (unrelated to actually having an account). Try: reconnect again first; if that fails, open the extension's \"Connected sites\" settings, remove this site's existing connection, then reconnect fresh.";
  }
  return message;
}

export function formatAtomic(amount: string | number, decimals: number): string {
  return (Number(amount) / 10 ** decimals).toFixed(2);
}
