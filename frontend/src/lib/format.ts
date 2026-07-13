export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * wagmi/viem wrap the wallet extension's own error as a generic
 * "User rejected the request" — for the "wallet must has at least one
 * account" case (confirmed live: this exact broken-English phrasing comes
 * from the wallet extension itself, not our code, when it has no account
 * created/imported/unlocked yet) that's misleading, since the user didn't
 * actually click "reject". Surface the real cause instead.
 */
export function describeConnectError(error: Error): string {
  const message = error.message ?? "";
  if (/at least one account/i.test(message)) {
    return "Your wallet extension has no account yet — open it, create or unlock an account, then try connecting again. (If you have more than one wallet extension installed, disable all but one — they can conflict.)";
  }
  return message;
}

export function formatAtomic(amount: string | number, decimals: number): string {
  return (Number(amount) / 10 ** decimals).toFixed(2);
}
