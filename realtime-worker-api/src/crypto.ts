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

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const [saltHex, hashHex] = hash.split(":");
  const salt = new Uint8Array(
    saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
  );
  const originalHash = new Uint8Array(
    hashHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
  );
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
  const newHash = new Uint8Array(exportedKey);
  if (originalHash.length !== newHash.length) {
    return false;
  }
  for (let i = 0; i < originalHash.length; i++) {
    if (originalHash[i] !== newHash[i]) {
      return false;
    }
  }
  return true;
}
