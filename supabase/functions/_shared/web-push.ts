// Minimal Web Push sender for Deno — implements VAPID (RFC 8292) + Web Push
// message encryption (aes128gcm, RFC 8188). No external deps beyond Deno's
// built-in Web Crypto + `jose` for JWT signing.
//
// Usage:
//   await sendWebPush(subscription, payload, { publicKey, privateKey, subject });
//
// Errors from push services are surfaced as WebPushError with the HTTP status,
// so callers can decide whether to delete stale subscriptions (404 / 410).

import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  publicKey: string; // base64url, 65-byte uncompressed point
  privateKey: string; // base64url, 32-byte scalar
  subject: string; // mailto:you@example.com or https://...
}

export class WebPushError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Web push failed (${status}): ${body}`);
    this.status = status;
    this.body = body;
  }
}

const b64urlToBytes = (s: string): Uint8Array => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const bytesToB64url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const concat = (...arrs: Uint8Array[]): Uint8Array => {
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};

// Convert a 32-byte raw P-256 private scalar into PKCS#8 so WebCrypto can import it.
// (jose / SubtleCrypto don't support "raw" EC private keys directly.)
async function importVapidPrivateKey(
  privateKeyB64url: string,
  publicKeyB64url: string,
): Promise<CryptoKey> {
  const d = b64urlToBytes(privateKeyB64url); // 32 bytes
  const pub = b64urlToBytes(publicKeyB64url); // 65 bytes, 0x04 || X || Y
  if (d.length !== 32) throw new Error("VAPID private key must be 32 bytes");
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("VAPID public key must be 65-byte uncompressed point");
  }
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);

  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: bytesToB64url(d),
    x: bytesToB64url(x),
    y: bytesToB64url(y),
    ext: true,
  };

  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function buildVapidHeaders(
  endpoint: string,
  keys: VapidKeys,
): Promise<{ Authorization: string; "Crypto-Key": string }> {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;

  // jose expects an 8-bit clean PKCS8 import; simpler to import the raw JWK
  // via SubtleCrypto and sign with it manually.
  const privKey = await importVapidPrivateKey(keys.privateKey, keys.publicKey);

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12h
    sub: keys.subject,
  };

  const encoder = new TextEncoder();
  const encode = (obj: unknown) =>
    bytesToB64url(encoder.encode(JSON.stringify(obj)));

  const unsigned = `${encode(header)}.${encode(payload)}`;
  const sigDer = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privKey,
    encoder.encode(unsigned),
  );
  const jwt = `${unsigned}.${bytesToB64url(new Uint8Array(sigDer))}`;

  return {
    Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
    "Crypto-Key": `p256ecdsa=${keys.publicKey}`,
  };
}

// aes128gcm content encoding per RFC 8188 + Web Push (RFC 8291).
// Encrypts `payload` so it can only be decrypted by the subscription's keypair.
async function encryptPayload(
  payload: Uint8Array,
  userPublicKeyB64: string, // recipient p256dh, 65 bytes
  userAuthB64: string, // recipient auth secret, 16 bytes
): Promise<{ body: Uint8Array; localPublicKey: Uint8Array }> {
  const userPub = b64urlToBytes(userPublicKeyB64);
  const userAuth = b64urlToBytes(userAuthB64);

  // 1. Ephemeral ECDH keypair
  const localKp = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const localPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", localKp.publicKey),
  ); // 65 bytes

  // Import recipient public key for ECDH
  const recipientPub = await crypto.subtle.importKey(
    "raw",
    userPub,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: recipientPub },
      localKp.privateKey,
      256,
    ),
  );

  // 2. PRK_key = HKDF(auth, sharedSecret, "WebPush: info" || 0x00 || user_pub || local_pub || 0x01)
  const hkdf = async (
    salt: Uint8Array,
    ikm: Uint8Array,
    info: Uint8Array,
    length: number,
  ): Promise<Uint8Array> => {
    const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
      "deriveBits",
    ]);
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt, info },
        key,
        length * 8,
      ),
    );
  };

  const encoder = new TextEncoder();
  const keyInfo = concat(
    encoder.encode("WebPush: info\x00"),
    userPub,
    localPubRaw,
  );
  const ikm = await hkdf(userAuth, sharedSecret, keyInfo, 32);

  // 3. Per RFC 8291, derive CEK and nonce using HKDF with random 16-byte salt.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(
    salt,
    ikm,
    encoder.encode("Content-Encoding: aes128gcm\x00"),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    encoder.encode("Content-Encoding: nonce\x00"),
    12,
  );

  // 4. Encrypt: payload || 0x02 (delimiter, last record)
  const plaintext = concat(payload, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey(
    "raw",
    cek,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aesKey,
      plaintext,
    ),
  );

  // 5. Build aes128gcm content-coding header:
  //    salt(16) || rs(4, big-endian, 4096) || idlen(1) || keyid(keylen bytes)
  // keyid = our ephemeral public key (65 bytes).
  const rs = new Uint8Array([0x00, 0x00, 0x10, 0x00]); // 4096
  const idlen = new Uint8Array([localPubRaw.length]);
  const body = concat(salt, rs, idlen, localPubRaw, ciphertext);

  return { body, localPublicKey: localPubRaw };
}

/**
 * Send a Web Push message to a single subscription.
 * Throws WebPushError with the HTTP status on non-2xx responses.
 */
export async function sendWebPush(
  sub: PushSubscription,
  payload: object | string,
  vapid: VapidKeys,
  opts: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high" } = {},
): Promise<void> {
  const bodyStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  const bodyBytes = new TextEncoder().encode(bodyStr);

  const { body } = await encryptPayload(
    bodyBytes,
    sub.keys.p256dh,
    sub.keys.auth,
  );
  const vapidHeaders = await buildVapidHeaders(sub.endpoint, vapid);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      ...vapidHeaders,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: String(opts.ttl ?? 60 * 60 * 24),
      Urgency: opts.urgency ?? "normal",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new WebPushError(res.status, text);
  }
}
