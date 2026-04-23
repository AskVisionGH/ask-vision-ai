import { useEffect, useState } from "react";

// A scripted, looping conversation snippet shown beneath the hero. Pure
// presentation — no real chat happens.
const SCRIPT: Array<{ role: "user" | "assistant"; text: string }> = [
  { role: "user", text: "what's in my wallet?" },
  { role: "assistant", text: "$2,481 across 7 tokens. SOL leads at 64%." },
  { role: "user", text: "swap 0.5 sol to usdc" },
  { role: "assistant", text: "Best route: Jupiter → 87.42 USDC. Confirm?" },
  { role: "user", text: "what's trending on solana?" },
  { role: "assistant", text: "$JUP +12% · $JTO +8% · $WIF +5% in the last 24h." },
];

export const ChatPreview = () => {
  const [visible, setVisible] = useState(0);

  // Reveal lines one at a time, then loop after a pause.
  useEffect(() => {
    const total = SCRIPT.length;
    const id = window.setInterval(() => {
      setVisible((v) => (v >= total ? 0 : v + 1));
    }, 1400);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="mx-auto w-full max-w-md">
      <div
        className="rounded-2xl border border-border/60 bg-card/30 p-4 backdrop-blur-md"
        style={{ minHeight: "11rem" }}
      >
        <div className="flex flex-col gap-2">
          {SCRIPT.slice(0, visible).map((line, i) => (
            <div
              key={i}
              className={`flex animate-fade-up ${
                line.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                  line.role === "user"
                    ? "bg-primary/15 text-foreground"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {line.text}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
