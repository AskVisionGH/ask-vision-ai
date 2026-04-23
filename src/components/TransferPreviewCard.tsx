import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  RefreshCw,
  Loader2,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  AlertTriangle,
  UserPlus,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { useContacts, findContactByAddress } from "@/hooks/useContacts";
import { Input } from "@/components/ui/input";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { cn } from "@/lib/utils";
import { TokenLogo } from "@/components/TokenLogo";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TransferQuoteData } from "@/lib/chat-stream";

interface Props {
  data: TransferQuoteData;
}

const REFRESH_MS = 30000;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60000;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const AUTH_TOKEN = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

type Phase =
  | { name: "preview" }
  | { name: "building" }
  | { name: "awaiting_signature" }
  | { name: "submitting" }
  | { name: "confirming"; signature: string; startedAt: number }
  | { name: "success"; signature: string; durationMs: number }
  | { name: "error"; message: string; cancelled?: boolean };

const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toExponential(2)}`;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
};

const fmtAmount = (n: number) => {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.000001) return n.toExponential(3);
  if (Math.abs(n) < 1) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (Math.abs(n) < 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const truncAddr = (s: string) => `${s.slice(0, 5)}…${s.slice(-4)}`;
const truncSig = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

const supaPost = async (fn: string, body: unknown) => {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error ?? `${fn} failed`);
  return data;
};

export const TransferPreviewCard = ({ data: initial }: Props) => {
  const [data, setData] = useState<TransferQuoteData>(initial);
  const [phase, setPhase] = useState<Phase>({ name: "preview" });
  const [refreshing, setRefreshing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);
  const [contactNameDraft, setContactNameDraft] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const mounted = useRef(true);
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();
  const { contacts, addContact } = useContacts();

  const recipientAddress = data.to?.address ?? "";
  const existingContact = useMemo(
    () => (recipientAddress ? findContactByAddress(contacts, recipientAddress) : null),
    [contacts, recipientAddress],
  );
  const alreadySaved = !!existingContact || contactSaved;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Auto-refresh price/fee — paused once user starts confirming
  useEffect(() => {
    if (data.error || !data.from || dismissed || phase.name !== "preview") return;
    const timer = setInterval(async () => {
      if (!mounted.current) return;
      setRefreshing(true);
      try {
        const fresh = await supaPost("transfer-quote", {
          fromAddress: data.from?.address,
          token: data.token?.isNative ? "SOL" : data.token?.mint,
          amount: data.amountUi,
          recipient: data.to?.displayName ?? data.to?.address,
          resolvedAddress: data.to?.address,
          displayName: data.to?.displayName ?? null,
          isOnCurve: data.to?.isOnCurve,
        });
        if (mounted.current && !fresh.error) setData(fresh);
      } catch {
        /* keep last good preview */
      } finally {
        if (mounted.current) setRefreshing(false);
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [data.error, dismissed, phase.name, data.from?.address, data.token?.mint, data.token?.isNative, data.amountUi, data.to?.displayName, data.to?.address]);

  const handleConfirm = async () => {
    if (!connected || !publicKey || !signTransaction) {
      setPhase({ name: "error", message: "Connect a wallet that supports signing." });
      return;
    }

    const startedAt = Date.now();

    try {
      // 1. Build locally to avoid backend worker CPU limits
      setPhase({ name: "building" });
      const fromPk = new PublicKey(data.from.address);
      const toPk = new PublicKey(data.to.address);

      const instructions = [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ];

      if (data.token.isNative) {
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: fromPk,
            toPubkey: toPk,
            lamports: Math.floor(data.amountAtomic),
          }),
        );
      } else {
        const recipientIsOnCurve = PublicKey.isOnCurve(toPk.toBytes());
        if (!recipientIsOnCurve) {
          throw new Error(
            "That recipient address isn't a regular wallet (off-curve). SPL transfers there could be lost. Double-check the address.",
          );
        }

        const tokenProgramId = data.token.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58()
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID;
        const mintPk = new PublicKey(data.token.mint);
        const fromAta = getAssociatedTokenAddressSync(mintPk, fromPk, true, tokenProgramId);
        const toAta = getAssociatedTokenAddressSync(mintPk, toPk, true, tokenProgramId);

        const [fromAtaAcct, toAtaAcct] = await Promise.all([
          connection.getAccountInfo(fromAta),
          connection.getAccountInfo(toAta),
        ]);

        if (!fromAtaAcct) {
          throw new Error("You don't hold any of this token in this wallet.");
        }

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
        }

        instructions.push(
          createTransferCheckedInstruction(
            fromAta,
            mintPk,
            toAta,
            fromPk,
            BigInt(Math.floor(data.amountAtomic)),
            data.token.decimals,
            [],
            tokenProgramId,
          ),
        );
      }

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const message = new TransactionMessage({
        payerKey: fromPk,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();
      const tx = new VersionedTransaction(message);

      // 2. Sign
      setPhase({ name: "awaiting_signature" });
      let signed: VersionedTransaction;
      try {
        signed = await signTransaction(tx);
      } catch {
        if (mounted.current) {
          setPhase({
            name: "error",
            message: "Cancelled — try again or adjust the amount.",
            cancelled: true,
          });
        }
        return;
      }

      // 3. Submit
      setPhase({ name: "submitting" });
      const signedB64 = btoa(String.fromCharCode(...signed.serialize()));
      const submitted = await supaPost("tx-submit", { signedTransaction: signedB64 });
      const signature = submitted.signature as string;
      if (!signature) throw new Error("No signature returned from submit");

      // 4. Poll for confirmation
      setPhase({ name: "confirming", signature, startedAt });
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (!mounted.current) return;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const status = await supaPost("tx-status", { signature });
          if (status.status === "confirmed") {
            if (!mounted.current) return;
            setPhase({
              name: "success",
              signature,
              durationMs: Date.now() - startedAt,
            });
            return;
          }
          if (status.status === "failed") {
            throw new Error(status.err ?? "Transaction failed on-chain");
          }
        } catch {
          continue;
        }
      }
      throw new Error("Confirmation timed out. Check Solscan for status.");
    } catch (e) {
      if (!mounted.current) return;
      const message = e instanceof Error ? e.message : "Something went wrong.";
      setPhase({ name: "error", message });
    }
  };

  const handleRetry = async () => {
    setPhase({ name: "preview" });
    setRefreshing(true);
    try {
      const fresh = await supaPost("transfer-quote", {
        fromAddress: data.from.address,
        token: data.token.isNative ? "SOL" : data.token.mint,
        amount: data.amountUi,
        recipient: data.to.displayName ?? data.to.address,
        resolvedAddress: data.to.address,
        displayName: data.to.displayName ?? null,
        isOnCurve: data.to.isOnCurve,
      });
      if (mounted.current && !fresh.error) setData(fresh);
    } catch {
      /* keep previous preview */
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };

  if (dismissed) return null;

  if (data.error || !data.from || !data.to || !data.token) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 font-mono text-[12px] leading-relaxed text-destructive">
        {data.error ?? "I couldn't prepare that transfer. Try again, or paste the wallet address."}
      </div>
    );
  }

  // Success — compact card
  if (phase.name === "success") {
    const handleSaveContact = async () => {
      const name = contactNameDraft.trim();
      if (!name) {
        toast.error("Give them a name");
        return;
      }
      setSavingContact(true);
      const r = await addContact({ name, address: data.to.address });
      setSavingContact(false);
      if ("error" in r) {
        toast.error("Couldn't save contact", { description: r.error });
        return;
      }
      setContactSaved(true);
      setShowSaveInput(false);
      toast.success(`Saved ${r.name} to contacts`);
    };

    return (
      <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-up/30 bg-up/5 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-up" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] text-foreground">
              Sent{" "}
              <span className="font-medium">
                {fmtAmount(data.amountUi)} {data.token.symbol}
              </span>{" "}
              to{" "}
              <span className="font-medium">
                {data.to.displayName ?? truncAddr(data.to.address)}
              </span>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Confirmed in {(phase.durationMs / 1000).toFixed(1)}s</span>
              <a
                href={`https://solscan.io/tx/${phase.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ease-vision inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80"
              >
                Tx {truncSig(phase.signature)}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>

            {/* Save as contact */}
            {alreadySaved ? (
              <div className="mt-2.5 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <Check className="h-3 w-3 text-up" />
                <span>
                  Saved as {existingContact?.name ?? contactNameDraft.trim()}
                </span>
              </div>
            ) : showSaveInput ? (
              <div className="mt-2.5 flex items-center gap-2">
                <Input
                  autoFocus
                  value={contactNameDraft}
                  onChange={(e) => setContactNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveContact();
                    } else if (e.key === "Escape") {
                      setShowSaveInput(false);
                    }
                  }}
                  placeholder="Nickname (e.g. Mom)"
                  disabled={savingContact}
                  className="h-7 flex-1 font-mono text-[11px]"
                />
                <Button
                  size="sm"
                  onClick={handleSaveContact}
                  disabled={savingContact || !contactNameDraft.trim()}
                  className="ease-vision h-7 font-mono text-[10px] tracking-wider uppercase"
                >
                  {savingContact ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowSaveInput(false)}
                  disabled={savingContact}
                  className="ease-vision h-7 font-mono text-[10px] tracking-wider uppercase text-muted-foreground"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setContactNameDraft(data.to.displayName ?? "");
                  setShowSaveInput(true);
                }}
                className="ease-vision mt-2.5 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:text-primary/80"
              >
                <UserPlus className="h-3 w-3" />
                Save as contact
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isBusy =
    phase.name === "building" ||
    phase.name === "awaiting_signature" ||
    phase.name === "submitting" ||
    phase.name === "confirming";

  const busyLabel =
    phase.name === "building"
      ? "Building transaction…"
      : phase.name === "awaiting_signature"
        ? "Approve in wallet…"
        : phase.name === "submitting"
          ? "Submitting…"
          : phase.name === "confirming"
            ? "Confirming on-chain…"
            : "";

  const isError = phase.name === "error";
  const errorMsg = isError ? (phase as Extract<Phase, { name: "error" }>).message : "";

  const totalSolCost = data.token.isNative
    ? data.amountUi + data.estNetworkFeeSol + data.ataCreationFeeSol
    : data.estNetworkFeeSol + data.ataCreationFeeSol;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-3">
          <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            Transfer preview
          </span>
          {phase.name === "preview" && (
            <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground/70">
              <RefreshCw
                className={cn("h-3 w-3", refreshing && "animate-spin text-primary")}
              />
              <span>refreshes 30s</span>
            </div>
          )}
          {isBusy && (
            <div className="flex items-center gap-2 font-mono text-[10px] text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{busyLabel}</span>
            </div>
          )}
        </div>

        {/* From → To */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-5">
          {/* You send */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <TokenLogo logo={data.token.logo} symbol={data.token.symbol} size={28} />
              <span className="font-mono text-[11px] text-muted-foreground">
                ${data.token.symbol}
              </span>
            </div>
            <p className="font-mono text-lg font-light tracking-tight text-foreground">
              {fmtAmount(data.amountUi)}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              ≈ {fmtUsd(data.valueUsd)}
            </p>
          </div>

          <ArrowRight className="h-4 w-4 text-muted-foreground" />

          {/* Recipient */}
          <div className="flex flex-col items-end gap-1.5 text-right">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
              To
            </span>
            {data.to.displayName ? (
              <>
                <p className="font-mono text-base font-light tracking-tight text-foreground">
                  {data.to.displayName}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {truncAddr(data.to.address)}
                </p>
              </>
            ) : (
              <p className="font-mono text-base font-light tracking-tight text-foreground">
                {truncAddr(data.to.address)}
              </p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="border-t border-border/40 px-5 py-3">
          <Row
            label="Network fee"
            value={
              <span className="font-mono text-[13px] text-muted-foreground">
                ~{data.estNetworkFeeSol.toFixed(6)} SOL
              </span>
            }
          />
          {data.needsAtaCreation && (
            <Row
              label="Account rent"
              value={
                <span className="font-mono text-[13px] text-amber-400">
                  +{data.ataCreationFeeSol.toFixed(6)} SOL
                </span>
              }
            />
          )}
          <Row
            label={data.token.isNative ? "Total" : "You pay (fees)"}
            value={
              <span className="font-mono text-[13px] text-foreground">
                {fmtAmount(totalSolCost)} SOL
                {!data.token.isNative && (
                  <span className="text-muted-foreground"> + {fmtAmount(data.amountUi)} {data.token.symbol}</span>
                )}
              </span>
            }
          />
        </div>

        {/* ATA warning */}
        {data.needsAtaCreation && phase.name === "preview" && (
          <div className="flex items-start gap-2 border-t border-amber-400/20 bg-amber-400/5 px-5 py-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
            <p className="font-mono text-[11px] leading-relaxed text-amber-200/90">
              First-time send to this address — adds ~{data.ataCreationFeeSol.toFixed(4)} SOL to open a token account.
            </p>
          </div>
        )}

        {/* Off-curve warning (SOL only — SPL is blocked upstream) */}
        {!data.to.isOnCurve && data.token.isNative && phase.name === "preview" && (
          <div className="flex items-start gap-2 border-t border-amber-400/20 bg-amber-400/5 px-5 py-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
            <p className="font-mono text-[11px] leading-relaxed text-amber-200/90">
              This recipient is off-curve (likely a program or vault). Make sure you know it accepts SOL transfers.
            </p>
          </div>
        )}

        {/* Inline error banner */}
        {isError && (
          <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-5 py-3">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
            <p className="font-mono text-[11px] leading-relaxed text-destructive">{errorMsg}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-border/40 bg-secondary/30 px-5 py-3">
          {!connected ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex-1">
                  <Button
                    disabled
                    className="ease-vision w-full font-mono text-[11px] tracking-wider uppercase"
                  >
                    Confirm & sign
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">Connect a wallet to sign.</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              onClick={isError ? handleRetry : handleConfirm}
              disabled={isBusy}
              className="ease-vision flex-1 font-mono text-[11px] tracking-wider uppercase"
            >
              {isBusy ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  {busyLabel}
                </>
              ) : isError ? (
                "Retry"
              ) : (
                "Confirm & sign"
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={isBusy}
            onClick={() => setDismissed(true)}
            className="ease-vision font-mono text-[11px] tracking-wider uppercase text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
};

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3 py-1.5">
    <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
      {label}
    </span>
    {value}
  </div>
);
