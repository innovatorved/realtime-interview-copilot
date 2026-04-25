/**
 * AES-GCM encryption helpers for BYOK token storage.
 *
 * The encryption key comes from the worker secret `BYOK_ENC_KEY`,
 * provisioned via `wrangler secret put BYOK_ENC_KEY` as a 32-byte (256-bit)
 * base64 string. We never log plaintext tokens — only `tokenLast4` (the
 * last four characters of the original token) is ever stored or returned
 * for display.
 *
 * Storage format:
 *   - tokenCiphertext: base64(AES-GCM ciphertext including 16-byte auth tag)
 *   - tokenIv:         base64(12-byte random IV, fresh per encryption)
 *
 * Anything malformed (wrong key length, bad base64, etc.) is rejected with
 * a generic error so a corrupted row can't reveal which decryption step
 * failed.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(rawKeyB64: string | undefined): Promise<CryptoKey> {
  if (!rawKeyB64 || typeof rawKeyB64 !== "string") {
    throw new Error("BYOK_ENC_KEY is not configured");
  }
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(rawKeyB64);
  } catch {
    throw new Error("BYOK_ENC_KEY is not valid base64");
  }
  if (raw.length !== KEY_BYTES) {
    throw new Error(
      `BYOK_ENC_KEY must decode to ${KEY_BYTES} bytes (got ${raw.length})`,
    );
  }
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface EncryptedToken {
  tokenCiphertext: string;
  tokenIv: string;
  tokenLast4: string;
}

export async function encryptToken(
  plaintext: string,
  encKey: string | undefined,
): Promise<EncryptedToken> {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Token must be a non-empty string");
  }
  const key = await importKey(encKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    tokenCiphertext: bytesToBase64(new Uint8Array(ciphertext)),
    tokenIv: bytesToBase64(iv),
    tokenLast4: plaintext.slice(-4),
  };
}

export async function decryptToken(
  row: { tokenCiphertext: string; tokenIv: string },
  encKey: string | undefined,
): Promise<string> {
  const key = await importKey(encKey);
  let ct: Uint8Array;
  let iv: Uint8Array;
  try {
    ct = base64ToBytes(row.tokenCiphertext);
    iv = base64ToBytes(row.tokenIv);
  } catch {
    throw new Error("Stored token is malformed");
  }
  if (iv.length !== IV_BYTES) throw new Error("Stored token is malformed");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return new TextDecoder().decode(plain);
}
