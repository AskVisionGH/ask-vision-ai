/**
 * Shared helper that maps a chain to a 3-letter ticker + brand colour.
 * Used by the header connect pill and the wallet chooser so both surfaces
 * stay visually consistent.
 *
 * EVM addresses are chain-agnostic (the same key works on every EVM
 * network), so for "registered EVM wallet" rows in the chooser we default
 * to ETH — that's the home network most users associate with their address.
 * The header pill, on the other hand, knows the *active* chain id from
 * wagmi and will show the actual one (BSC, ARB, etc.).
 */

export type ChainBadge = { label: string; dotClass: string };

const SOL_BADGE: ChainBadge = { label: "SOL", dotClass: "bg-[#14F195]" };

export const solanaBadge = (): ChainBadge => SOL_BADGE;

export const evmChainBadge = (chainId?: number | null): ChainBadge => {
  switch (chainId) {
    case 1: return { label: "ETH", dotClass: "bg-[#627EEA]" };
    case 42161: return { label: "ARB", dotClass: "bg-[#28A0F0]" };
    case 10: return { label: "OPT", dotClass: "bg-[#FF0420]" };
    case 8453: return { label: "BAS", dotClass: "bg-[#0052FF]" };
    case 137: return { label: "POL", dotClass: "bg-[#8247E5]" };
    case 56: return { label: "BSC", dotClass: "bg-[#F0B90B]" };
    case 43114: return { label: "AVA", dotClass: "bg-[#E84142]" };
    case 59144: return { label: "LIN", dotClass: "bg-[#61DFFF]" };
    case 534352: return { label: "SCR", dotClass: "bg-[#FFEEDA]" };
    case 324: return { label: "ZKS", dotClass: "bg-[#8C8DFC]" };
    // Unknown / not specified → fall back to ETH branding, since that's
    // the default "home" of an EVM address.
    default: return { label: "ETH", dotClass: "bg-[#627EEA]" };
  }
};
