import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { fail } from "../platform/util.js";
export function createVault(encoded = process.env.AI_MASTER_KEY || "") {
  const key = encoded ? Buffer.from(encoded, "base64") : null;
  if (key && (key.length !== 32 || key.toString("base64") !== encoded))
    throw Error("AI_MASTER_KEY must be 32 random bytes encoded as base64.");
  const aad = (user, provider) =>
    Buffer.from(JSON.stringify(["reentry-key-v1", user, provider]));
  return {
    available: !!key,
    seal(user, provider, value) {
      if (!key)
        throw fail("AI credentials are not configured on this server.", 503);
      if (
        typeof value !== "string" ||
        value.length < 20 ||
        value.length > 512 ||
        /\s/.test(value)
      )
        throw fail("Enter a valid API key.");
      const nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad(user, provider));
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return {
        encrypted: [nonce, cipher.getAuthTag(), encrypted]
          .map((x) => x.toString("base64"))
          .join("."),
        fingerprint: createHash("sha256")
          .update(value)
          .digest("hex")
          .slice(0, 10),
      };
    },
    open(user, provider, encrypted) {
      if (!key)
        throw fail("AI credentials are not configured on this server.", 503);
      try {
        const [nonce, tag, ciphertext] = encrypted
          .split(".")
          .map((x) => Buffer.from(x, "base64"));
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(aad(user, provider));
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw fail(
          "Stored key cannot be unlocked. Reconnect this provider.",
          409,
        );
      }
    },
  };
}
