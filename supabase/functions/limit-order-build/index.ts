import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encodeBase58, decodeBase58 } from "https://deno.land/std@0.224.0/encoding/base58.ts";

// Wraps Jupiter Trigger API v1 createOrder.
// Docs: https://dev.jup.ag/docs/trigger-api/
// We pass a referral feeAccount on the OUTPUT mint so our 1% sweep applies
// at fill time — same PDA derivation as swap-build.

const REFERRAL_PROGRAM_B58 = "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash);
}
const P = (1n << 255n) - 19n;
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
const I = 19681161376707505956807079304634410280968253439055057958347466067149174814213n;
const mod = (a: bigint) => { const r = a % P; return r < 0n ? r + P : r; };
const pow = (b: bigint, e: bigint) => {
  let r = 1n, base = mod(b), exp = e;
  while (exp > 0n) { if (exp & 1n) r = mod(r * base); base = mod(base * base); exp >>= 1n; }
  return r;
};
const bytesToBigIntLE = (b: Uint8Array) => {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
  return n;
};
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
  if (vx2 === u) {} else if (vx2 === mod(-u)) { x = mod(x * I); } else { return false; }
  if ((x === 0n) && signBit) return false;
  return true;
}
async function findProgramAddress(seeds: Uint8Array[], programId: Uint8Array) {
  for (let bump = 255; bump >= 0; bump--) {
    const totalLen = seeds.reduce((a, s) => a + s.length, 0) + 1 + programId.length + PDA_MARKER.length;
    const buf = new Uint8Array(totalLen);
    let off = 0;
    for (const s of seeds) { buf.set(s, off); off += s.length; }
    buf[off++] = bump;
    buf.set(programId, off); off += programId.length;
    buf.set(PDA_MARKER, off);
    const candidate = await sha256(buf);
    if (!isOnCurve(candidate)) return { address: candidate, bump };
  }
  throw new Error("Unable to find a valid PDA bump");
}

const REFERRAL_PROGRAM_BYTES = decodeBase58(REFERRAL_PROGRAM_B58);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const maker: string = body.maker ?? "";
    const inputMint: string = body.inputMint ?? "";
    const outputMint: string = body.outputMint ?? "";
    const makingAmount = body.makingAmount;       // atomic string/number
    const takingAmount = body.takingAmount;       // atomic string/number
    const expiredAt = body.expiredAt ?? null;     // unix seconds, optional

    if (!maker) return json({ error: "maker required" }, 400);
    if (!inputMint || !outputMint) return json({ error: "inputMint and outputMint required" }, 400);
    if (!makingAmount || !takingAmount) {
      return json({ error: "makingAmount and takingAmount required" }, 400);
    }
    if (inputMint === outputMint) return json({ error: "input and output mints must differ" }, 400);

    // Derive referral fee account on the OUTPUT mint
    const referralAccount = Deno.env.get("JUPITER_REFERRAL_ACCOUNT") ?? "";
    let feeAccount: string | undefined;
    if (referralAccount) {
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
      }
    }

    const params: Record<string, unknown> = {
      makingAmount: String(makingAmount),
      takingAmount: String(takingAmount),
    };
    if (expiredAt) params.expiredAt = String(expiredAt);
    if (feeAccount) params.feeBps = "100"; // 1%

    const reqBody: Record<string, unknown> = {
      inputMint,
      outputMint,
      maker,
      payer: maker,
      params,
      computeUnitPrice: "auto",
    };
    if (feeAccount) reqBody.feeAccount = feeAccount;

    const resp = await fetch("https://lite-api.jup.ag/trigger/v1/createOrder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Jupiter createOrder error:", resp.status, t);
      return json({ error: "Couldn't build limit order. Try again." }, 502);
    }

    const data = await resp.json();
    return json({
      requestId: data.requestId,
      transaction: data.transaction,
      order: data.order ?? null,
    });
  } catch (e) {
    console.error("limit-order-build error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
