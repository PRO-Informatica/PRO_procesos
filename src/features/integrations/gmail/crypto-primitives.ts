import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type EncryptedRefreshToken = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

export function decodeEncryptionKey(value: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(normalized)) {
    throw new Error("La clave de cifrado Gmail debe usar Base64 válido.");
  }
  const key = Buffer.from(normalized, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== normalized) {
    throw new Error("La clave de cifrado Gmail debe decodificar exactamente a 32 bytes.");
  }
  return key;
}

export function gmailTokenAdditionalData(input: {
  userId: string;
  connectionId: string;
  keyVersion: number;
}) {
  return Buffer.from(
    `gmail-refresh-token:v${input.keyVersion}:${input.userId}:${input.connectionId}`,
    "utf8",
  );
}

export function encryptRefreshToken(input: {
  refreshToken: string;
  encryptionKeyBase64: string;
  userId: string;
  connectionId: string;
  keyVersion: number;
}): EncryptedRefreshToken {
  if (!input.refreshToken) throw new Error("El refresh token Gmail está vacío.");
  if (!Number.isInteger(input.keyVersion) || input.keyVersion <= 0) {
    throw new Error("La versión de clave Gmail no es válida.");
  }
  const key = decodeEncryptionKey(input.encryptionKeyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(gmailTokenAdditionalData(input));
  const ciphertext = Buffer.concat([
    cipher.update(input.refreshToken, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: input.keyVersion,
  };
}

export function decryptRefreshToken(input: {
  ciphertext: string;
  iv: string;
  authTag: string;
  encryptionKeyBase64: string;
  userId: string;
  connectionId: string;
  keyVersion: number;
}) {
  const key = decodeEncryptionKey(input.encryptionKeyBase64);
  const iv = Buffer.from(input.iv, "base64");
  const authTag = Buffer.from(input.authTag, "base64");
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("El token Gmail cifrado no es válido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAAD(gmailTokenAdditionalData(input));
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateOAuthState(now = Date.now()) {
  const value = randomBytes(32).toString("base64url");
  return {
    value,
    hash: hashOAuthState(value),
    expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
  };
}

export function hashOAuthState(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function secureStateEquals(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function isUsableOAuthState(input: {
  consumedAt: string | null;
  expiresAt: string;
  now?: number;
}) {
  return (
    input.consumedAt === null &&
    Number.isFinite(Date.parse(input.expiresAt)) &&
    Date.parse(input.expiresAt) > (input.now ?? Date.now())
  );
}
