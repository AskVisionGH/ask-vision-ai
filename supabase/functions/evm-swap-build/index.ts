// Single-chain EVM swap builder via 0x Swap API v2 (Allowance Holder).
//
// Returns an unsigned EVM transaction request the frontend can pass to
// either wagmi (external wallet) or our `useVisionEvmBridge` driver
// (Vision Wallet — same Privy server-wallet path the bridge uses).
//
// Approval handling lives on the FRONTEND (driver checks current allowance
// vs sellAmount and inserts an ERC-20 approve tx before the swap if needed),
// EXACTLY like the bridge flow. We just surface the spender + minimum
// allowance amount in the response.
//
// Re-fetching the quote at build-time (vs trusting the preview quote) is
// important because 0x quotes are firm for ~30s and AMM prices move fast —
// the swap-build/swap-quote pattern is identical to Jupiter's, intentionally.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ZEROEX_BASE = "https://api.0x.org";
const PLATFORM_FEE_BPS = 100;
const EVM_NATIVE_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const EVM_TREASURY = "0xd62427353491907D6A0606DC8be4a8Be05bBaF58";

const SUPPORTED_CHAIN_IDS = new Set([1, 10, 56, 137, 8453, 42161, 43114, 59144, 534352]);

interface BuildRequest {
  chainId: number;
  sellToken: string;
  buyToken: string;
  taker: string;
  sellAmount: string;          // atomic
  slippageBps?: number;
  // Optional explicit recipient — if set, swap output is sent to this
  // address instead of the taker. Used by the bridge+swap orchestrator
  // when the swap is the second leg and the taker is a relay address.
  recipient?: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("ZEROEX_API_KEY");
    if (!apiKey) return json({ error: "ZEROEX_API_KEY not configured" }, 500);

    const body = (await req.json()) as Partial<BuildRequest>;
    const chainId = Number(body.chainId);
    const sellToken = String(body.sellToken ?? "").trim();
    const buyToken = String(body.buyToken ?? "").trim();
    const taker = String(body.taker ?? "").trim();
    const sellAmount = String(body.sellAmount ?? "").trim();
    const slippageBps = Number.isFinite(Number(body.slippageBps))
      ? Math.max(1, Math.min(5000, Number(body.slippageBps)))
      : 50;
    const recipient = body.recipient ? String(body.recipient).trim() : null;

    if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
      return json({ error: `Unsupported chainId: ${chainId}` }, 400);
    }
    if (!isAddress(sellToken) || !isAddress(buyToken) || !isAddress(taker)) {
      return json({ error: "sellToken/buyToken/taker must be valid addresses" }, 400);
    }
    if (recipient && !/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      return json({ error: "recipient must be a valid EVM address" }, 400);
    }
    let sellAmountBig: bigint;
    try {
      sellAmountBig = BigInt(sellAmount);
      if (sellAmountBig <= 0n) throw new Error("non-positive");
    } catch {
      return json({ error: "sellAmount must be a positive integer (atomic)" }, 400);
    }

    const url = new URL(`${ZEROEX_BASE}/swap/allowance-holder/quote`);
    url.searchParams.set("chainId", String(chainId));
    url.searchParams.set("sellToken", sellToken);
    url.searchParams.set("buyToken", buyToken);
    url.searchParams.set("sellAmount", sellAmountBig.toString());
    url.searchParams.set("taker", taker);
    url.searchParams.set("slippageBps", String(slippageBps));
    url.searchParams.set("swapFeeBps", String(PLATFORM_FEE_BPS));
    url.searchParams.set("swapFeeRecipient", EVM_TREASURY);
    url.searchParams.set("swapFeeToken", buyToken);
    url.searchParams.set("tradeSurplusRecipient", EVM_TREASURY);
    if (recipient) {
      // 0x v2 supports `recipient` to redirect the buy-side delivery.
      url.searchParams.set("recipient", recipient);
    }

    const resp = await fetch(url.toString(), {
      headers: {
        "0x-api-key": apiKey,
        "0x-version": "v2",
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("0x build quote error", resp.status, text);
      return json({ error: "Couldn't build swap. Try again." }, 502);
    }

    const data = await resp.json();
    const tx = data.transaction;
    if (!tx?.to || !tx?.data) {
      return json({ error: "0x returned no transaction" }, 502);
    }

    // Echo back fee + amount echo so `record-swap-fee` can attribute correctly.
    const integratorFee = data.fees?.integratorFee ?? null;
    const buyAmountAtomic = String(data.buyAmount ?? "0");
    const minBuyAmountAtomic = String(data.minBuyAmount ?? data.buyAmount ?? "0");

    return json({
      chainId,
      transactionRequest: {
        to: tx.to,
        data: tx.data,
        value: tx.value ?? "0",
        gas: tx.gas ?? null,
        gasPrice: tx.gasPrice ?? null,
        // 0x returns chainId echo on the tx for some routes; honour it.
        chainId: tx.chainId ?? chainId,
      },
      // The frontend driver inserts an approve(spender, amount) ERC-20 tx
      // BEFORE this one when (sellToken != native) AND (currentAllowance < sellAmount).
      allowanceTarget: data.issues?.allowance?.spender ?? data.allowanceTarget ?? null,
      sellAmountAtomic: String(data.sellAmount ?? sellAmountBig.toString()),
      buyAmountAtomic,
      minBuyAmountAtomic,
      sellToken,
      buyToken,
      platformFeeAtomic: integratorFee?.amount ? String(integratorFee.amount) : null,
      platformFeeBps: integratorFee ? PLATFORM_FEE_BPS : 0,
      platformFeeToken: integratorFee?.token ?? buyToken,
      // Surface 0x's "this trade has issues" array if anything's flagged so
      // the frontend can decide whether to proceed (typically just balance
      // and allowance — both pre-checked client-side, so usually empty).
      issues: data.issues ?? null,
    });
  } catch (e) {
    console.error("evm-swap-build error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAddress(addr: string): boolean {
  if (!addr) return false;
  if (addr.toLowerCase() === EVM_NATIVE_PLACEHOLDER.toLowerCase()) return true;
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}
