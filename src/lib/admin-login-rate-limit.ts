import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export const adminLoginLimits = {
  account: { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  ip: { maxAttempts: 60, windowMs: 10 * 60 * 1000 },
} as const;
export const loginLimitRetentionMs = 24 * 60 * 60 * 1000;
export type LoginBucket = { key: string; maxAttempts: number; windowMs: number };
export type LoginLimitRecord = { key: string; attempts: number; expiresAt: Date };
export type LoginLimitPlan = { allowed: true; writes: LoginLimitRecord[] } | { allowed: false; retryAfterSeconds: number };

export class LoginProtectionUnavailable extends Error {
  constructor() { super("admin-login-protection-unavailable"); this.name = "LoginProtectionUnavailable"; }
}

export function canonicalLoginIp(value: string): string {
  if (isIP(value) === 4) return value;
  if (isIP(value) !== 6) throw new LoginProtectionUnavailable();
  let host: string;
  try { host = new URL(`http://[${value}]/`).hostname.slice(1, -1); }
  catch { throw new LoginProtectionUnavailable(); }
  const [left, right] = host.split("::");
  const head = left ? left.split(":") : [], tail = right ? right.split(":") : [];
  const words = right === undefined ? head : [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
  if (words.length !== 8) throw new LoginProtectionUnavailable();
  const numbers = words.map(word => parseInt(word, 16));
  if (numbers.slice(0, 5).every(word => word === 0) && numbers[5] === 0xffff)
    return [numbers[6] >> 8, numbers[6] & 255, numbers[7] >> 8, numbers[7] & 255].join(".");
  // Group IPv6 privacy addresses by /64, preventing trivial interface-ID rotation.
  return words.slice(0, 4).map(word => word.padStart(4, "0")).join(":") + "::/64";
}

export function loginBuckets(headers: Headers, email: string, env: Record<string, string | undefined> = process.env): LoginBucket[] {
  const secret = env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new LoginProtectionUnavailable();
  let ip: string;
  if (env.NODE_ENV === "production") {
    // Opt in ONLY on Netlify, where the platform supplies this connection header.
    // Never infer trust from a request header, Host, X-Forwarded-For or X-Real-IP.
    if (env.ADMIN_LOGIN_IP_SOURCE !== "netlify") throw new LoginProtectionUnavailable();
    const supplied = headers.get("x-nf-client-connection-ip");
    if (!supplied) throw new LoginProtectionUnavailable();
    ip = canonicalLoginIp(supplied.trim());
  } else {
    // next dev and tests share a fixed bucket; no client-selected IP is trusted.
    ip = "local-development";
  }
  const key = (kind: string, value: string) => kind + ":" + createHmac("sha256", secret).update("e-pan:admin-login:v1:" + kind + ":" + value).digest("hex");
  return [
    { key: key("ip", ip), ...adminLoginLimits.ip },
    { key: key("account", email.trim().toLowerCase()), ...adminLoginLimits.account },
  ].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export function planLoginAttempt(buckets: LoginBucket[], records: LoginLimitRecord[], now: Date): LoginLimitPlan {
  let retryAfterSeconds = 0;
  for (const bucket of buckets) {
    const record = records.find(row => row.key === bucket.key);
    if (record && record.expiresAt > now && record.attempts >= bucket.maxAttempts)
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((record.expiresAt.getTime() - now.getTime()) / 1000));
  }
  if (retryAfterSeconds > 0) return { allowed: false, retryAfterSeconds };
  return { allowed: true, writes: buckets.map(bucket => {
    const record = records.find(row => row.key === bucket.key);
    return record && record.expiresAt > now
      ? { key: bucket.key, attempts: record.attempts + 1, expiresAt: record.expiresAt }
      : { key: bucket.key, attempts: 1, expiresAt: new Date(now.getTime() + bucket.windowMs) };
  }) };
}
