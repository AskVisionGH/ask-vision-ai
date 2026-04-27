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
        An embedded wallet managed by Vision so you can trade without
        installing an extension. Recoverable via your email.
      </p>

      {!ready || loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : solanaAddress ? (
        <div className="space-y-3">
          <div>
            <Label className="text-xs uppercase text-muted-foreground">
              Solana address
            </Label>
            <p className="font-mono text-sm break-all">{solanaAddress}</p>
          </div>
          {row && (
            <p className="text-xs text-muted-foreground">
              Origin: {row.origin} · Linked to Privy user {row.privy_user_id.slice(0, 12)}…
            </p>
          )}
          <Button variant="outline" size="sm" onClick={disconnect}>
            Disconnect from this device
          </Button>
        </div>
      ) : !authenticated ? (
        step === "idle" ? (
          <Button onClick={startLogin} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Set up Vision Wallet
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
          Create Solana wallet
        </Button>
      )}
    </section>
  );
};
