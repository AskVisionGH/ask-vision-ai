import { useState } from "react";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";

/**
 * Test card for Vision Wallet (Privy embedded). Lets us prove the full
 * flow end-to-end in Settings before wiring it into trade screens.
 */
export const VisionWalletCard = () => {
  const {
    ready,
    authenticated,
    loading,
    working,
    row,
    solanaAddress,
    evmAddress,
    sendPrivyLoginCode,
    submitPrivyCode,
    createWallet,
    disconnect,
  } = useVisionWallet();

  const [step, setStep] = useState<"idle" | "code">("idle");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const startLogin = async () => {
    setBusy(true);
    try {
      await sendPrivyLoginCode();
      setStep("code");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setBusy(false);
    }
  };

  const finishLogin = async () => {
    if (code.trim().length < 6) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setBusy(true);
    try {
      await submitPrivyCode(code.trim());
      setStep("idle");
      setCode("");
      toast.success("Vision Wallet connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    try {
      await createWallet();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create wallet");
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-2 mb-2">
        <Wallet className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Vision Wallet (beta)</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        One magic wallet that trades on every chain — no extension, no
        seed phrase. Recoverable via your email.
      </p>

      {!ready || loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : solanaAddress || evmAddress ? (
        <div className="space-y-4">
          {solanaAddress && (
            <div>
              <Label className="text-xs uppercase text-muted-foreground">
                Solana
              </Label>
              <p className="font-mono text-sm break-all">{solanaAddress}</p>
            </div>
          )}
          {evmAddress && (
            <div>
              <Label className="text-xs uppercase text-muted-foreground">
                Ethereum &amp; EVM chains
              </Label>
              <p className="font-mono text-sm break-all">{evmAddress}</p>
            </div>
          )}
          {(!solanaAddress || !evmAddress) && (
            <Button onClick={handleCreate} disabled={working} variant="secondary">
              {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Finish wallet setup
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={disconnect}>
            Disconnect from this device
          </Button>
        </div>
      ) : !authenticated ? (
        step === "idle" ? (
          <Button onClick={startLogin} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Vision Wallet
          </Button>
        ) : (
          <div className="space-y-3 max-w-sm">
            <Label htmlFor="privy-code">Enter the 6-digit code</Label>
            <Input
              id="privy-code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
            />
            <div className="flex gap-2">
              <Button onClick={finishLogin} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setStep("idle");
                  setCode("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )
      ) : (
        <Button onClick={handleCreate} disabled={working}>
          {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Vision Wallet
        </Button>
      )}
    </section>
  );
};
