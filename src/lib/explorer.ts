// Block explorer URL helpers shared between PnL cards and history cards.
//
// Solana → Solscan. EVM → the canonical Etherscan-family explorer for each
// chain we support. Centralising here means new chains only need a single
// edit to flow into every "view tx" link in the UI.

export const txExplorerUrl = (signature: string, chainId?: number | null): string => {
  if (!chainId) return `https://solscan.io/tx/${signature}`;
  switch (chainId) {
    case 1: return `https://etherscan.io/tx/${signature}`;
    case 8453: return `https://basescan.org/tx/${signature}`;
    case 42161: return `https://arbiscan.io/tx/${signature}`;
    case 10: return `https://optimistic.etherscan.io/tx/${signature}`;
    case 137: return `https://polygonscan.com/tx/${signature}`;
    case 56: return `https://bscscan.com/tx/${signature}`;
    case 43114: return `https://snowtrace.io/tx/${signature}`;
    case 59144: return `https://lineascan.build/tx/${signature}`;
    case 534352: return `https://scrollscan.com/tx/${signature}`;
    case 324: return `https://explorer.zksync.io/tx/${signature}`;
    default: return `https://etherscan.io/tx/${signature}`;
  }
};

export const explorerLabel = (chainId?: number | null): string => {
  if (!chainId) return "Solscan";
  switch (chainId) {
    case 1: return "Etherscan";
    case 8453: return "Basescan";
    case 42161: return "Arbiscan";
    case 10: return "Optimistic Etherscan";
    case 137: return "Polygonscan";
    case 56: return "BscScan";
    case 43114: return "Snowtrace";
    case 59144: return "Lineascan";
    case 534352: return "Scrollscan";
    case 324: return "zkSync Explorer";
    default: return "Etherscan";
  }
};
