import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
} from "https://esm.sh/@solana/web3.js@1.95.3";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "https://esm.sh/@solana/spl-token@0.4.8";

// Builds the 1% upfront platform-fee transfer for a DCA order.
// The user signs this BEFORE the Jupiter recurring-create transaction.
// Body: { user, inputMint, totalAmountAtomic (string), decimals, isToken2022? }
// Returns: { transaction (b64 unsigned legacy tx), feeAmountAtomic, blockhash }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FEE_BPS = 100; // 1%
const SOL_MINT = "So11111111111111111111111111111111111111112";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const treasury = Deno.env.get("TREASURY_PUBLIC_KEY");
    const heliusKey = Deno.env.get("HELIUS_API_KEY");
    if (!treasury) return json({ error: "TREASURY_PUBLIC_KEY not configured" }, 500);
    if (!heliusKey) return json({ error: "HELIUS_API_KEY not configured" }, 500);

    const body = await req.json();
    const userStr: string = body.user ?? "";
    const inputMint: string = body.inputMint ?? "";
    const totalAtomicStr: string = String(body.totalAmountAtomic ?? "");
    const decimals = Number(body.decimals);
    const isToken2022: boolean = body.isToken2022 === true;
    if (!userStr || !inputMint || !totalAtomicStr) {
      return json({ error: "user, inputMint, totalAmountAtomic required" }, 400);
    }
    if (!Number.isFinite(decimals) || decimals < 0) {
      return json({ error: "decimals required" }, 400);
    }

    let totalAtomic: bigint;
    try {
      totalAtomic = BigInt(totalAtomicStr);
    } catch {
      return json({ error: "totalAmountAtomic must be an integer string" }, 400);
    }
    if (totalAtomic <= 0n) return json({ error: "totalAmountAtomic must be > 0" }, 400);

    // 1% of total, rounded up so we never under-collect.
    const feeAtomic = (totalAtomic * BigInt(FEE_BPS) + 9999n) / 10000n;

    const user = new PublicKey(userStr);
    const treasuryPk = new PublicKey(treasury);
    const conn = new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, "confirmed");

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }));

    if (inputMint === SOL_MINT) {
      // Native SOL transfer
      tx.add(SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: treasuryPk,
        lamports: Number(feeAtomic),
      }));
    } else {
      const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const mintPk = new PublicKey(inputMint);
      const fromAta = getAssociatedTokenAddressSync(mintPk, user, true, tokenProgram);
      const toAta = getAssociatedTokenAddressSync(mintPk, treasuryPk, true, tokenProgram);
      // Create treasury ATA if missing (user pays the rent — small, ~0.002 SOL one-time per mint).
      tx.add(createAssociatedTokenAccountIdempotentInstruction(
        user, toAta, treasuryPk, mintPk, tokenProgram,
      ));
      tx.add(createTransferCheckedInstruction(
        fromAta, mintPk, toAta, user, feeAtomic, decimals, [], tokenProgram,
      ));
    }

    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = user;

    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const txB64 = btoa(String.fromCharCode(...serialized));

    return json({
      transaction: txB64,
      feeAmountAtomic: feeAtomic.toString(),
      blockhash,
    });
  } catch (e) {
    console.error("dca-fee-build error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
