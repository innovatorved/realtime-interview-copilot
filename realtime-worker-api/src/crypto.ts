export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const exportedKey = (await crypto.subtle.exportKey(
    "raw",
    key,
  )) as ArrayBuffer;
  const hashBuffer = new Uint8Array(exportedKey);
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashHex = Array.from(hashBuffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${saltHex}:${hashHex}`;
}

const HEX_ONLY = /^[0-9a-f]+$/i;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  if (!HEX_ONLY.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  // Hash format is "<saltHex>:<hashHex>". Reject anything else immediately
  // so a malformed DB row can't throw and 500 the auth path.
  if (typeof hash !== "string" || typeof password !== "string") return false;
  const parts = hash.split(":");
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts as [string, string];
  const salt = hexToBytes(saltHex);
  const originalHash = hexToBytes(hashHex);
  if (!salt || !originalHash) return false;
  // Expect a 16-byte salt and a 32-byte derived key (SHA-256 / AES-GCM 256).
  if (salt.length !== 16 || originalHash.length !== 32) return false;
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const exportedKey = (await crypto.subtle.exportKey(
    "raw",
    key,
  )) as ArrayBuffer;
  const newHash = new Uint8Array(exportedKey);
  if (originalHash.length !== newHash.length) {
    return false;
  }
  // Constant-time comparison to prevent timing attacks
  let diff = 0;
  for (let i = 0; i < originalHash.length; i++) {
    diff |= originalHash[i]! ^ newHash[i]!;
  }
  return diff === 0;
}
