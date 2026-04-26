// Chains we support for EVM bridging. Order matters — used as wagmi's
// initial chain list and for matching LI.FI numeric chain ids.
import {
  mainnet,
  arbitrum,
  optimism,
  base,
  polygon,
  bsc,
  avalanche,
  linea,
  scroll,
  zksync,
  type Chain,
} from "wagmi/chains";

export const SUPPORTED_EVM_CHAINS = [
  mainnet,
  arbitrum,
  optimism,
  base,
  polygon,
  bsc,
  avalanche,
  linea,
  scroll,
  zksync,
] as const satisfies readonly [Chain, ...Chain[]];

/** Returns the wagmi Chain object for a given numeric LI.FI / EVM chain id. */
export const findEvmChain = (id: number | string | null | undefined): Chain | null => {
  if (id == null) return null;
  const num = typeof id === "number" ? id : Number(id);
  if (!Number.isFinite(num)) return null;
  return SUPPORTED_EVM_CHAINS.find((c) => c.id === num) ?? null;
};
