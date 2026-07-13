export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatAtomic(amount: string | number, decimals: number): string {
  return (Number(amount) / 10 ** decimals).toFixed(2);
}
