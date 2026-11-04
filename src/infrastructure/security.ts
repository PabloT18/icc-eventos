import { createHmac, createHash, randomBytes, randomInt } from "node:crypto";
export const token = () => randomBytes(32).toString("hex");
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export const code = () => String(randomInt(0, 1000000)).padStart(6, "0");
export function otpHash(email: string, code: string) {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("OTP_HMAC_SECRET requiere 32 caracteres");
  return createHmac("sha256", secret)
    .update(email + ":" + code)
    .digest("hex");
}
