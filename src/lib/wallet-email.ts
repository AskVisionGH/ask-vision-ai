/**
 * Wallet-only accounts created via SIWS get a synthetic email like
 * `<wallet>@wallet.vision.local` so Supabase Auth has a primary key. This
 * address is internal — never show it in UIs or send mail to it.
 *
 * Use {@link isWalletSyntheticEmail} anywhere we need to decide whether the
 * stored email represents a real inbox.
 */
export const WALLET_EMAIL_DOMAIN = "wallet.vision.local";

export const isWalletSyntheticEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${WALLET_EMAIL_DOMAIN}`);
};
