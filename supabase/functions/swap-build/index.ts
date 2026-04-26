import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// We avoid @solana/web3.js here — its 1MB+ bundle blows the edge function's
// CPU budget on cold start (WORKER_RESOURCE_LIMIT). The only Solana primitive
// we need is PDA derivation for the Jupiter referral fee account, which we
// implement directly below using the Web Crypto sha256 + a tiny base58 codec.
import { encodeBase58, decodeBase58 } from "https://deno.land/std@0.224.0/encoding/base58.ts";

const REFERRAL_PROGRAM_B58 = "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// --- Minimal PDA derivation -------------------------------------------------
// Solana's `findProgramAddress` algorithm:
//   1. Concatenate seeds || bumpSeed || programId || "ProgramDerivedAddress"
//   2. sha256 the buffer
//   3. The bump (255..0) is valid iff the resulting 32 bytes are NOT a point
//      on the ed25519 curve (i.e. not a valid public key).
// Edwards-form curve check — port of solana_program::pubkey::PUBKEY_BYTES
// off-curve test. This is the same logic used by web3.js's `isOnCurve`.
const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash);
}

// Ed25519 field arithmetic — minimal subset needed for the on-curve check.
// Reference: https://github.com/solana-labs/solana-web3.js/blob/master/packages/library-legacy/src/utils/ed25519.ts
const P = (1n << 255n) - 19n;
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
const I = 19681161376707505956807079304634410280968253439055057958347466067149174814213n;

function mod(a: bigint): bigint {
  const r = a % P;
  return r < 0n ? r + P : r;
}
function pow(b: bigint, e: bigint): bigint {
  let r = 1n;
  let base = mod(b);
  let exp = e;
  while (exp > 0n) {
    if (exp & 1n) r = mod(r * base);
    base = mod(base * base);
    exp >>= 1n;
  }
  return r;
}
function inv(a: bigint): bigint {
  return pow(a, P - 2n);
}
function bytesToBigIntLE(b: Uint8Array): bigint {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
  return n;
}
function isOnCurve(pub: Uint8Array): boolean {
  if (pub.length !== 32) return false;
  const bytes = new Uint8Array(pub);
  const signBit = (bytes[31] >> 7) & 1;
  bytes[31] &= 0x7f;
  const y = bytesToBigIntLE(bytes);
  if (y >= P) return false;
  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  const v3 = mod(v * v * v);
  const v7 = mod(v3 * v3 * v);
  let x = mod(u * v3 * pow(u * v7, (P - 5n) / 8n));
  const vx2 = mod(v * x * x);
  if (vx2 === u) {
    // ok
  } else if (vx2 === mod(-u)) {
    x = mod(x * I);
  } else {
    return false;
  }
  if ((x === 0n) && signBit) return false;
  return true;
}

async function findProgramAddress(
  seeds: Uint8Array[],
  programId: Uint8Array,
): Promise<{ address: Uint8Array; bump: number }> {
  for (let bump = 255; bump >= 0; bump--) {
    const totalLen = seeds.reduce((a, s) => a + s.length, 0) + 1 + programId.length + PDA_MARKER.length;
    const buf = new Uint8Array(totalLen);
    let off = 0;
    for (const s of seeds) {
      buf.set(s, off);
      off += s.length;
    }
    buf[off++] = bump;
    buf.set(programId, off);
    off += programId.length;
    buf.set(PDA_MARKER, off);
    const candidate = await sha256(buf);
    if (!isOnCurve(candidate)) {
      return { address: candidate, bump };
    }
  }
  throw new Error("Unable to find a valid PDA bump");
}
// ---------------------------------------------------------------------------

const REFERRAL_PROGRAM_BYTES = decodeBase58(REFERRAL_PROGRAM_B58);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const userPublicKey: string = body.userPublicKey ?? "";
    const inputMint: string = body.inputMint ?? "";
    const outputMint: string = body.outputMint ?? "";
    const amount = Number(body.amount); // atomic units
    // Dynamic slippage (Jupiter RTSE) lets the router pick a per-route
    // tolerance at build time so volatile tokens still land. When enabled
    // we still pass a generous slippageBps to the QUOTE call as an upper
    // ceiling, but the SWAP call uses `dynamicSlippage: true` and Jupiter
    // bakes the optimal value into the transaction.
    const dynamicSlippage = body.dynamicSlippage !== false; // default ON
    const userSlippageBps = Number.isFinite(Number(body.slippageBps))
      ? Math.max(1, Math.min(5000, Number(body.slippageBps)))
      : 50;
    const dynamicSlippageCeilingBps = 1500;
    // When dynamic, allow the quote to consider routes up to a higher
    // ceiling for fast-moving pairs — Jupiter will still trim to the
    // minimum it needs for the chosen route.
    const slippageBps = dynamicSlippage
      ? Math.max(userSlippageBps, dynamicSlippageCeilingBps)
      : userSlippageBps;

    if (!userPublicKey) return json({ error: "userPublicKey required" }, 400);
    if (!inputMint || !outputMint) {
      return json({ error: "inputMint and outputMint required" }, 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ error: "amount (atomic) must be a positive number" }, 400);
    }

    // Platform fee config — must match swap-quote so the route plan is
    // priced consistently with the preview.
    const PLATFORM_FEE_BPS = 100; // 1%
    const referralAccount = Deno.env.get("JUPITER_REFERRAL_ACCOUNT") ?? "";

    // Token-2022 outputs (transfer-fee / hooks / etc.) break Jupiter's
    // output-side platform fee path on certain routes — the on-chain math
    // fails and surfaces as a misleading "slippage exceeded" error
    // (custom program error 0x1789). Skip the fee path for these mints so
    // the swap actually lands. We forgo the 1% on these specific tokens
    // rather than blocking the user.
    const outputIsToken2022 = await detectToken2022Mint(outputMint);
    const useJupiterFeePath = Boolean(referralAccount) && !outputIsToken2022;

    // Re-fetch a fresh quote at submission time so the transaction is built
    // against the current on-chain state (not the 15s-old preview).
    const quoteUrl = new URL("https://lite-api.jup.ag/swap/v1/quote");
    quoteUrl.searchParams.set("inputMint", inputMint);
    quoteUrl.searchParams.set("outputMint", outputMint);
    quoteUrl.searchParams.set("amount", String(Math.floor(amount)));
    quoteUrl.searchParams.set("slippageBps", String(slippageBps));
    quoteUrl.searchParams.set("restrictIntermediateTokens", "true");
    if (useJupiterFeePath) {
      quoteUrl.searchParams.set("platformFeeBps", String(PLATFORM_FEE_BPS));
    }

    const qResp = await fetch(quoteUrl.toString());
    if (!qResp.ok) {
      const t = await qResp.text();
      console.error("Jupiter quote (build) error:", qResp.status, t);
      return json({ error: "No route found at submission time. Try again." }, 502);
    }
    const quoteResponse = await qResp.json();

    // Derive the per-output-mint fee token account owned by the referral PDA.
    // Jupiter expects `feeAccount` to be a referral-program token account for
    // the OUTPUT mint, derived as PDA(["referral_ata", referralAccount, mint]).
    let feeAccount: string | undefined;
    if (useJupiterFeePath) {
      try {
        const { address } = await findProgramAddress(
          [
            new TextEncoder().encode("referral_ata"),
            decodeBase58(referralAccount),
            decodeBase58(outputMint),
          ],
          REFERRAL_PROGRAM_BYTES,
        );
        feeAccount = encodeBase58(address);
      } catch (e) {
        console.error("Failed to derive feeAccount PDA:", e);
        // Continue without fee rather than blocking the swap.
      }
    }

    const buildSwapPayload = (useDynamicSlippage: boolean) => ({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      ...(useDynamicSlippage ? { dynamicSlippage: true } : {}),
      ...(feeAccount ? { feeAccount } : {}),
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: 1_000_000, // cap at 0.001 SOL
          priorityLevel: "high",
        },
      },
    });

    let usedDynamicSlippage = dynamicSlippage;
    let swapResp = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSwapPayload(dynamicSlippage)),
    });

    if (!swapResp.ok) {
      const t = await swapResp.text();
      console.error("Jupiter swap error:", swapResp.status, t);
      return json({ error: "Couldn't build swap transaction. Try again." }, 502);
    }

    let swapData = await swapResp.json();

    const report = swapData.dynamicSlippageReport ?? null;
    const builtSlippageBps = Number(report?.slippageBps ?? 0);
    const heuristicMaxSlippageBps = Number(report?.heuristicMaxSlippageBps ?? 0);
    const dynamicTooTight = dynamicSlippage && (
      !Number.isFinite(builtSlippageBps) ||
      builtSlippageBps <= 0 ||
      builtSlippageBps < Math.min(slippageBps, 500) ||
      (Number.isFinite(heuristicMaxSlippageBps) && heuristicMaxSlippageBps > 0 && heuristicMaxSlippageBps < Math.min(slippageBps, 500))
    );

    if (dynamicTooTight) {
      console.warn("Dynamic slippage came back too tight; retrying with fixed slippage", {
        requestedMaxBps: slippageBps,
        builtSlippageBps,
        heuristicMaxSlippageBps,
      });
      usedDynamicSlippage = false;
      swapResp = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSwapPayload(false)),
      });
      if (!swapResp.ok) {
        const t = await swapResp.text();
        console.error("Jupiter fixed-slippage fallback error:", swapResp.status, t);
        return json({ error: "Couldn't build swap transaction. Try again." }, 502);
      }
      swapData = await swapResp.json();
    }

    return json({
      swapTransaction: swapData.swapTransaction,
      lastValidBlockHeight: swapData.lastValidBlockHeight,
      prioritizationFeeLamports: swapData.prioritizationFeeLamports ?? null,
      dynamicSlippage: usedDynamicSlippage,
      dynamicSlippageReport: swapData.dynamicSlippageReport ?? null,
    });
  } catch (e) {
    console.error("swap-build error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function detectToken2022Mint(mint: string): Promise<boolean> {
  const heliusKey = Deno.env.get("HELIUS_API_KEY");
  const rpcUrl = heliusKey
    ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
    : "https://api.mainnet-beta.solana.com";
  try {
    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mint-owner",
        method: "getAccountInfo",
        params: [mint, { encoding: "jsonParsed", commitment: "confirmed" }],
      }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data?.result?.value?.owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  } catch {
    return false;
  }
}
