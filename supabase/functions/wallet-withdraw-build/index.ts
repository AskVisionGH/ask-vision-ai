/**
 * wallet-withdraw-build
 *
 * Builds (but does NOT sign) a withdrawal transaction from the caller's
 * Vision Wallet. Two shapes depending on chain:
 *
 *   Solana:
 *     { chain: "solana", to, mint: "SOL"|<mintPubkey>, amountUi, decimals? }
 *     -> { chain: "solana", caip2, transaction: <base64 tx>,
 *          fee: { networkSol, ataCreationSol }, send: { ...echo } }
 *
 *   EVM:
 *     { chain: "evm", chainId, to, token: "native"|<0x..ERC20>, amountUi,
 *       decimals? }
 *     -> { chain: "evm", caip2, tx: { to, value, data?, ... },
 *          fee: { gasLimit, maxFeeWei?, gasPriceWei? }, send: { ...echo } }
 *
 * The returned `transaction` / `tx` is meant to be passed straight to
 * `sign-and-send-tx`. Decimals / ERC-20 metadata are looked up server-side
 * when not provided so the client doesn't need a token list.
 *
 * Auth: requires the caller's Supabase JWT — the Vision Wallet addresses
 * are loaded from `vision_wallets` for that user, never from the request.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
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
import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  parseUnits,
  type Address,
  type Chain,
} from "https://esm.sh/viem@2.21.55";
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
} from "https://esm.sh/viem@2.21.55/chains";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

const EVM_CHAINS: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [arbitrum.id]: arbitrum,
  [optimism.id]: optimism,
  [base.id]: base,
  [polygon.id]: polygon,
  [bsc.id]: bsc,
  [avalanche.id]: avalanche,
  [linea.id]: linea,
  [scroll.id]: scroll,
  [zksync.id]: zksync,
};

const isBase58Pubkey = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const isEvmAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Authenticate caller
    const authHeader = req.headers.get("Authorization") ?? "";
    const supaAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supaAuth.auth.getUser();
    if (userErr || !userData.user) {
      return json({ error: "Not authenticated" }, 401);
    }

    // Look up Vision Wallet
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const { data: walletRow, error: loadErr } = await admin
      .from("vision_wallets")
      .select("solana_address, evm_address")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (loadErr) return json({ error: "DB load failed" }, 500);
    if (!walletRow) return json({ error: "No Vision Wallet for user" }, 404);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Invalid body" }, 400);

    const chain = String((body as Record<string, unknown>).chain ?? "");

    if (chain === "solana") {
      return await buildSolana(walletRow.solana_address, body as Record<string, unknown>);
    } else if (chain === "evm") {
      return await buildEvm(walletRow.evm_address, body as Record<string, unknown>);
    } else {
      return json({ error: "chain must be 'solana' or 'evm'" }, 400);
    }
  } catch (e) {
    console.error("wallet-withdraw-build error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ---------- Solana ----------

async function buildSolana(
  fromAddress: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!fromAddress) return json({ error: "No Solana Vision Wallet" }, 404);

  const to = String(body.to ?? "").trim();
  const mintInput = String(body.mint ?? "").trim();
  const amountUi = Number(body.amountUi);
  const decimalsHint = body.decimals != null ? Number(body.decimals) : null;

  if (!to || !isBase58Pubkey(to)) return json({ error: "Recipient must be a Solana address" }, 400);
  if (!mintInput) return json({ error: "mint required (\"SOL\" or mint pubkey)" }, 400);
  if (!Number.isFinite(amountUi) || amountUi <= 0) return json({ error: "amountUi must be positive" }, 400);
  if (to === fromAddress) return json({ error: "You can't send to your own wallet." }, 400);

  const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
  if (!HELIUS_API_KEY) return json({ error: "RPC misconfigured" }, 500);
  const conn = new Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, "confirmed");

  const fromPk = new PublicKey(fromAddress);
  const toPk = new PublicKey(to);

  const instructions = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
  ];

  let ataCreationFeeSol = 0;

  if (mintInput === "SOL") {
    const lamports = Math.floor(amountUi * 1_000_000_000);
    if (lamports <= 0) return json({ error: "Amount too small" }, 400);
    instructions.push(
      SystemProgram.transfer({ fromPubkey: fromPk, toPubkey: toPk, lamports }),
    );
  } else {
    if (!PublicKey.isOnCurve(toPk.toBytes())) {
      return json(
        { error: "Recipient is off-curve. SPL transfers there could be lost." },
        400,
      );
    }
    if (decimalsHint == null || !Number.isFinite(decimalsHint) || decimalsHint < 0) {
      return json({ error: "decimals required for SPL transfer" }, 400);
    }
    const mintPk = new PublicKey(mintInput);

    // Detect token program (Token-2022 vs classic)
    const mintAcct = await conn.getAccountInfo(mintPk);
    if (!mintAcct) return json({ error: "Mint not found" }, 400);
    const tokenProgramId = mintAcct.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const fromAta = getAssociatedTokenAddressSync(mintPk, fromPk, true, tokenProgramId);
    const toAta = getAssociatedTokenAddressSync(mintPk, toPk, true, tokenProgramId);

    const fromAtaAcct = await conn.getAccountInfo(fromAta);
    if (!fromAtaAcct) {
      return json({ error: "You don't hold any of this token in this wallet." }, 400);
    }

    const toAtaAcct = await conn.getAccountInfo(toAta);
    if (!toAtaAcct) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          fromPk,
          toAta,
          toPk,
          mintPk,
          tokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      ataCreationFeeSol = 0.00203928;
    }

    const amountAtomic = BigInt(Math.floor(amountUi * Math.pow(10, decimalsHint)));
    if (amountAtomic <= 0n) return json({ error: "Amount too small for token's precision" }, 400);

    instructions.push(
      createTransferCheckedInstruction(
        fromAta,
        mintPk,
        toAta,
        fromPk,
        amountAtomic,
        decimalsHint,
        [],
        tokenProgramId,
      ),
    );
  }

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: fromPk,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const serialized = tx.serialize();
  const transactionB64 = btoa(String.fromCharCode(...serialized));

  return json({
    chain: "solana",
    caip2: SOLANA_MAINNET_CAIP2,
    transaction: transactionB64,
    lastValidBlockHeight,
    fee: {
      networkSol: 0.000005,
      ataCreationSol: ataCreationFeeSol,
    },
    send: { from: fromAddress, to, mint: mintInput, amountUi },
  });
}

// ---------- EVM ----------

async function buildEvm(
  fromAddress: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!fromAddress) return json({ error: "No EVM Vision Wallet" }, 404);

  const chainId = Number(body.chainId);
  const chain = EVM_CHAINS[chainId];
  if (!chain) return json({ error: `Unsupported EVM chainId: ${chainId}` }, 400);

  const to = String(body.to ?? "").trim();
  const tokenInput = String(body.token ?? "").trim();
  const amountUi = Number(body.amountUi);
  let decimals = body.decimals != null ? Number(body.decimals) : null;

  if (!isEvmAddr(to)) return json({ error: "Recipient must be a 0x EVM address" }, 400);
  if (!tokenInput) return json({ error: "token required (\"native\" or 0x address)" }, 400);
  if (!Number.isFinite(amountUi) || amountUi <= 0) return json({ error: "amountUi must be positive" }, 400);
  if (to.toLowerCase() === fromAddress.toLowerCase()) {
    return json({ error: "You can't send to your own wallet." }, 400);
  }

  const client = createPublicClient({ chain, transport: http() });

  let txObject: Record<string, unknown>;
  let gasLimit: bigint = 0n;

  if (tokenInput === "native" || tokenInput.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    const value = parseUnits(amountUi.toString(), chain.nativeCurrency.decimals ?? 18);
    txObject = {
      from: fromAddress,
      to,
      value: "0x" + value.toString(16),
    };
    try {
      gasLimit = await client.estimateGas({
        account: fromAddress as Address,
        to: to as Address,
        value,
      });
    } catch {
      gasLimit = 21_000n;
    }
  } else {
    if (!isEvmAddr(tokenInput)) return json({ error: "ERC-20 token must be a 0x address" }, 400);
    if (decimals == null || !Number.isFinite(decimals) || decimals < 0) {
      // Resolve decimals on-chain
      try {
        decimals = Number(
          await client.readContract({
            address: tokenInput as Address,
            abi: erc20Abi,
            functionName: "decimals",
          }),
        );
      } catch {
        return json({ error: "Could not read token decimals" }, 400);
      }
    }
    const amountWei = parseUnits(amountUi.toString(), decimals);
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [to as Address, amountWei],
    });
    txObject = {
      from: fromAddress,
      to: tokenInput,
      value: "0x0",
      data,
    };
    try {
      gasLimit = await client.estimateGas({
        account: fromAddress as Address,
        to: tokenInput as Address,
        data,
      });
    } catch {
      gasLimit = 100_000n;
    }
  }

  // Add a small buffer to gas limit
  const gasWithBuffer = (gasLimit * 120n) / 100n;
  (txObject as Record<string, unknown>).gas = "0x" + gasWithBuffer.toString(16);

  // Fee suggestion (let Privy fill if EIP-1559 fields not provided, but
  // include legacy gasPrice as a fallback hint)
  let gasPriceWei: bigint | null = null;
  try {
    gasPriceWei = await client.getGasPrice();
  } catch {
    /* leave null */
  }

  return json({
    chain: "evm",
    caip2: `eip155:${chainId}`,
    chainId,
    tx: txObject,
    fee: {
      gasLimit: "0x" + gasWithBuffer.toString(16),
      gasPriceWei: gasPriceWei != null ? gasPriceWei.toString() : null,
      nativeSymbol: chain.nativeCurrency.symbol,
      nativeDecimals: chain.nativeCurrency.decimals,
    },
    send: {
      from: fromAddress,
      to,
      token: tokenInput,
      amountUi,
      decimals,
      chainId,
    },
  });
}
