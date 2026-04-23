import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "https://esm.sh/@solana/web3.js@1.95.3";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "https://esm.sh/@solana/spl-token@0.4.8?deps=@solana/web3.js@1.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const fromAddress: string = body.fromAddress ?? "";
    const toAddress: string = body.toAddress ?? "";
    const mint: string = body.mint ?? ""; // "SOL" for native, else mint pubkey
    const amountAtomic = Number(body.amountAtomic);
    const decimals = Number(body.decimals);
    const tokenProgramStr: string = body.tokenProgram ?? TOKEN_PROGRAM_ID.toBase58();

    if (!fromAddress) return json({ error: "fromAddress required" }, 400);
    if (!toAddress) return json({ error: "toAddress required" }, 400);
    if (!mint) return json({ error: "mint required" }, 400);
    if (!Number.isFinite(amountAtomic) || amountAtomic <= 0) {
      return json({ error: "amountAtomic must be a positive integer" }, 400);
    }

    const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
    if (!HELIUS_API_KEY) return json({ error: "RPC misconfigured" }, 500);
    const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
    const connection = new Connection(rpcUrl, "confirmed");

    const fromPk = new PublicKey(fromAddress);
    const toPk = new PublicKey(toAddress);

    const instructions = [
      // Modest priority fee — keeps the tx landing without hand-tuning
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ];

    let ataCreationFeeSol = 0;

    if (mint === "SOL") {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: fromPk,
          toPubkey: toPk,
          lamports: Math.floor(amountAtomic),
        }),
      );
    } else {
      if (!Number.isFinite(decimals) || decimals < 0) {
        return json({ error: "decimals required for SPL transfer" }, 400);
      }

      const mintPk = new PublicKey(mint);
      const tokenProgramId = tokenProgramStr === TOKEN_2022_PROGRAM_ID.toBase58()
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID;

      const fromAta = getAssociatedTokenAddressSync(
        mintPk,
        fromPk,
        true,
        tokenProgramId,
      );
      const toAta = getAssociatedTokenAddressSync(
        mintPk,
        toPk,
        true,
        tokenProgramId,
      );

      // Verify sender ATA exists
      const fromAtaAcct = await connection.getAccountInfo(fromAta);
      if (!fromAtaAcct) {
        return json(
          { error: "You don't hold any of this token in this wallet." },
          400,
        );
      }

      // Create recipient ATA if missing
      const toAtaAcct = await connection.getAccountInfo(toAta);
      if (!toAtaAcct) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            fromPk, // payer
            toAta,
            toPk,
            mintPk,
            tokenProgramId,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
        ataCreationFeeSol = 0.00203928;
      }

      instructions.push(
        createTransferCheckedInstruction(
          fromAta,
          mintPk,
          toAta,
          fromPk,
          BigInt(Math.floor(amountAtomic)),
          decimals,
          [],
          tokenProgramId,
        ),
      );
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

    const message = new TransactionMessage({
      payerKey: fromPk,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    const serialized = tx.serialize();
    const b64 = btoa(String.fromCharCode(...serialized));

    return json({
      transaction: b64,
      lastValidBlockHeight,
      estNetworkFeeSol: 0.000005,
      ataCreationFeeSol,
    });
  } catch (e) {
    console.error("transfer-build error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
