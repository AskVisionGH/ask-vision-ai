// stranded-routes — tiny localStorage layer for in-flight bridge_then_swap
// recovery.
//
// Why this exists
// ---------------
// A bridge_then_swap route has two on-chain legs:
//   1) Bridge sourceToken (chainA) → intermediate (chainB), e.g. USDC on Base.
//   2) Destination-chain swap intermediate → toToken on chainB.
//
// The bridge leg almost always lands. The destination swap is what can fail
// in subtle ways: price drift past slippage, gas spike, the user closes the
// tab before leg 2 starts, a transient 0x route 404, etc. When that happens
// the user is left with intermediate funds (typically USDC) on the
// destination chain with no UI affordance — they have to know to swap it
// manually.
//
// We avoid that by recording the active plan the moment we know leg 1's
// funds have landed (`pollBridgeUntilDone` returned), and clearing it the
// moment leg 2 confirms. If anything between those two points fails — even
// the browser closing — the next visit to /trade can detect the orphan
// record, look up the user's actual on-chain balance for the intermediate
// token, and surface a "Resume swap" card.
//
// Storage choice: localStorage, scoped per-user. Stranded recovery is a
// per-wallet concern and the user is by definition still in the same
// session that owns those funds. A DB-backed cross-device version is a
// reasonable upgrade later but adds complexity (auth, RLS, sync) for a
// pretty rare edge case in v1.

import type { ChainKey } from "@/components/trade/MultichainTokenPickerDialog";

const STORAGE_KEY = "vision:stranded-routes";
const RECORD_TTL_MS = 24 * 60 * 60 * 1000; // 24h — funds are still recoverable
                                            // after this, but we stop nagging.

export interface StrandedRoute {
  /** Stable id so we can key React lists + targeted clears. */
  id: string;
  /** Owning user — guards against another account on the same browser
   *  picking up someone else's stranded record. */
  userId: string;

  // ---- Original trade context ----
  fromSymbol: string;
  fromAddress: string;
  fromChain: ChainKey;
  fromAmountUi: number;
  toSymbol: string;
  toAddress: string;
  toChain: ChainKey;
  toDecimals: number;

  // ---- Intermediate (the funds we're trying to "rescue") ----
  intermediateSymbol: string;
  intermediateAddress: string;
  intermediateDecimals: number;
  /** What we *expected* to land on the destination chain. The actual
   *  on-chain balance is the source of truth at resume time — we only
   *  carry this so the UI can show "expected ≈ X". */
  expectedIntermediateUi: number;

  // ---- Wallet routing ----
  /** Address that controls the intermediate funds on the destination chain. */
  recipientAddress: string;
  /** Which wallet driver originally did the bridge — Vision or external.
   *  Resume defaults to the same so signing UX stays consistent. */
  walletSource: "vision" | "external";

  // ---- Bridge breadcrumbs (for the Resume UI's "View bridge tx" link) ----
  bridgeHash: string;
  bridgeExplorer: string;

  /** Why we recorded this — for analytics + UI tone (error vs interrupted). */
  reason: "post_bridge_failure" | "interrupted";
  /** ms epoch — used for TTL + sort order. */
  createdAt: number;
}

// ---- Storage primitives ---------------------------------------------------

function readAll(): StrandedRoute[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter expired
    const now = Date.now();
    return parsed.filter(
      (r: StrandedRoute) => r && typeof r === "object" && now - r.createdAt < RECORD_TTL_MS,
    );
  } catch {
    return [];
  }
}

function writeAll(routes: StrandedRoute[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
  } catch {
    // Quota or privacy mode — there's nothing actionable; the user just
    // loses the resume affordance, which is the same as before this
    // feature existed.
  }
}

// ---- Public API -----------------------------------------------------------

export function listStrandedRoutes(userId: string | null | undefined): StrandedRoute[] {
  if (!userId) return [];
  return readAll()
    .filter((r) => r.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Add (or replace, by id) a stranded record. */
export function recordStrandedRoute(route: StrandedRoute): void {
  const all = readAll();
  const next = [route, ...all.filter((r) => r.id !== route.id)];
  writeAll(next);
}

export function clearStrandedRoute(id: string): void {
  const all = readAll();
  writeAll(all.filter((r) => r.id !== id));
}

/** Build a stable id for a stranded record. Uses bridge tx hash so re-runs
 *  don't create duplicates if the executor records twice. */
export function makeStrandedId(bridgeHash: string): string {
  return `stranded:${bridgeHash}`;
}
