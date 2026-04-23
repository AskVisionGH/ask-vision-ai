import type { CryptoExperience, RiskTolerance } from "@/hooks/useProfile";

export const EXPERIENCE_OPTIONS: {
  value: CryptoExperience;
  label: string;
  description: string;
}[] = [
  {
    value: "new",
    label: "New to crypto",
    description: "Explain the basics. I'll learn as we go.",
  },
  {
    value: "intermediate",
    label: "Comfortable",
    description: "I've used wallets, swapped tokens, know the lingo.",
  },
  {
    value: "advanced",
    label: "Degen",
    description: "Skip the explainers. I want speed and depth.",
  },
];

export const INTEREST_OPTIONS: { value: string; label: string }[] = [
  { value: "defi", label: "DeFi" },
  { value: "trading", label: "Trading" },
  { value: "nfts", label: "NFTs" },
  { value: "memecoins", label: "Memecoins" },
  { value: "staking", label: "Staking" },
  { value: "building", label: "Building" },
  { value: "research", label: "Research" },
  { value: "airdrops", label: "Airdrops" },
];

export const RISK_OPTIONS: {
  value: RiskTolerance;
  label: string;
  description: string;
}[] = [
  {
    value: "cautious",
    label: "Cautious",
    description: "Flag risks early. Prefer blue-chips over plays.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Mix of safety and upside. Pragmatic about risk.",
  },
  {
    value: "aggressive",
    label: "Aggressive",
    description: "I'll take big swings. Don't sugar-coat the downside.",
  },
];
