import { useEffect, useState } from "react";

// A single, fixed-height line that types out example prompts and cycles
// through them. No layout shift, no growing box — just a quiet hint at
// what you can ask Vision.
const PROMPTS = [
  "what's in my wallet?",
  "swap 0.5 sol to usdc",
  "bridge 100 usdc from eth to solana",
  "analyze this contract: 7xKX...Tons",
  "track toly's wallet for new buys",
  "show binance sol inflows today",
  "what's trending on solana?",
  "send 10 usdc to alex",
  "alert me if $wif drops 10%",
  "find smart money buying memecoins",
  "explain jupiter routing",
  "is this token a honeypot?",
];

const TYPE_MS = 55;
const ERASE_MS = 25;
const HOLD_MS = 1600;

export const ChatPreview = () => {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"typing" | "holding" | "erasing">("typing");

  useEffect(() => {
    const current = PROMPTS[index];
    let timer: number;

    if (phase === "typing") {
      if (text.length < current.length) {
        timer = window.setTimeout(() => setText(current.slice(0, text.length + 1)), TYPE_MS);
      } else {
        timer = window.setTimeout(() => setPhase("holding"), HOLD_MS);
      }
    } else if (phase === "holding") {
      timer = window.setTimeout(() => setPhase("erasing"), 0);
    } else {
      if (text.length > 0) {
        timer = window.setTimeout(() => setText(current.slice(0, text.length - 1)), ERASE_MS);
      } else {
        setIndex((i) => (i + 1) % PROMPTS.length);
        setPhase("typing");
      }
    }

    return () => window.clearTimeout(timer);
  }, [text, phase, index]);

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="flex h-10 items-center justify-center gap-2 font-mono text-sm text-muted-foreground">
        <span className="text-muted-foreground/40">›</span>
        <span className="truncate">
          {text}
          <span
            className="ml-0.5 inline-block h-3.5 w-[2px] -translate-y-[1px] bg-primary align-middle animate-pulse"
            aria-hidden
          />
        </span>
      </div>
    </div>
  );
};
