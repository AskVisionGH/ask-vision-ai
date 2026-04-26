/**
 * Last-used wallet tracking (per device).
 *
 * The wallet chooser shows the user's linked addresses (from the
 * `wallet_links` table) AND the most recent wallets they've connected on
 * this device. The latter is purely a UX hint — addresses live in
 * localStorage so a fresh device starts empty.
 *
 * `chain` distinguishes how to reconnect:
 *   - "solana" → use @solana/wallet-adapter-react `select(name)` + `connect()`
 *   - "evm"    → use wagmi's `useConnect({ connector })`
 *
 * `walletName` is the adapter / connector display name ("Phantom",
 * "MetaMask", etc.) so the chooser can prefilter the wallet modal to a
 * specific provider when the user picks a previously used address.
 */

const STORAGE_KEY = "vision:wallet:last-used";
const MAX_ENTRIES = 6;

export type WalletChain = "solana" | "evm";

export interface LastUsedWallet {
  address: string;
  chain: WalletChain;
  walletName: string;
  lastUsedAt: number;
}

/** Read last-used wallet history. Tolerates malformed JSON / SSR. */
export const readLastUsedWallets = (): LastUsedWallet[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is LastUsedWallet =>
          e &&
          typeof e.address === "string" &&
          (e.chain === "solana" || e.chain === "evm") &&
          typeof e.walletName === "string" &&
          typeof e.lastUsedAt === "number",
      )
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
};

/**
 * Push a fresh entry to the top of the list, deduping on (chain, address).
 * Called from the connect side-effects in ConnectWalletButton + TradeBridge.
 */
export const recordLastUsedWallet = (entry: Omit<LastUsedWallet, "lastUsedAt">) => {
  if (typeof window === "undefined") return;
  try {
    const existing = readLastUsedWallets();
    const norm = entry.chain === "evm" ? entry.address.toLowerCase() : entry.address;
    const next: LastUsedWallet[] = [
      { ...entry, address: norm, lastUsedAt: Date.now() },
      ...existing.filter((e) => !(e.chain === entry.chain && e.address.toLowerCase() === norm.toLowerCase())),
    ].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private-mode errors */
  }
};

/** Address shape detection — used to tag wallet_links rows by chain since the
 * table doesn't store a chain column. Solana addresses are base58, ~32-44
 * chars; EVM addresses are hex 0x + 40. */
export const detectWalletChain = (address: string): WalletChain | null => {
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return "evm";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "solana";
  return null;
};

export const shortAddress = (address: string) =>
  address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;