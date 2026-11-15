import { describe, expect, it } from "vitest";
import { adminLoginLimits, canonicalLoginIp, loginBuckets, planLoginAttempt } from "./admin-login-rate-limit";

const env = { NODE_ENV: "production", ADMIN_LOGIN_IP_SOURCE: "netlify", AUTH_SECRET: "fixture-" + "x".repeat(48) };
const headers = (ip = "192.0.2.1") => new Headers({ "x-nf-client-connection-ip": ip });
const now = new Date("2026-11-15T00:00:00.000Z");

describe("identidad y politica del limite administrativo", () => {
  it("normaliza la cuenta y guarda claves HMAC sin correo, IP ni secreto", () => {
    const email = "Owner@Bakery.test", buckets = loginBuckets(headers(), email, env);
    expect(buckets).toEqual(loginBuckets(headers(), " owner@bakery.test ", env));
    const serialized = JSON.stringify(buckets);
    for (const value of [email, "owner@bakery.test", "192.0.2.1", env.AUTH_SECRET]) expect(serialized).not.toContain(value);
    expect(buckets.every(bucket => /^(?:account|ip):[a-f0-9]{64}$/.test(bucket.key))).toBe(true);
  });
  it("ignora cabeceras reenviadas manipuladas por el cliente", () => {
    const forged = headers();
    forged.set("x-forwarded-for", "203.0.113.1, 198.51.100.1");
    forged.set("x-real-ip", "203.0.113.2");
    forged.set("client-ip", "203.0.113.3");
    expect(loginBuckets(forged, "owner@bakery.test", env)).toEqual(loginBuckets(headers(), "owner@bakery.test", env));
  });
  it("exige confianza configurada en servidor y una sola IP valida en produccion", () => {
    expect(() => loginBuckets(headers(), "owner@bakery.test", { ...env, ADMIN_LOGIN_IP_SOURCE: "" })).toThrow();
    for (const ip of ["", "unknown", "192.0.2.1, 192.0.2.2", "192.0.2.1:8080", "fe80::1%eth0"])
      expect(() => loginBuckets(headers(ip), "owner@bakery.test", env)).toThrow();
    expect(() => loginBuckets(new Headers({ "x-forwarded-for": "192.0.2.1" }), "owner@bakery.test", env)).toThrow();
  });
  it("no confia en cabeceras de IP durante desarrollo local", () => {
    const local = { ...env, NODE_ENV: "development" };
    expect(loginBuckets(headers("192.0.2.1"), "owner@bakery.test", local)).toEqual(loginBuckets(headers("198.51.100.2"), "owner@bakery.test", local));
  });
  it("no utiliza claves publicas si falta AUTH_SECRET", () => {
    expect(() => loginBuckets(headers(), "owner@bakery.test", { ...env, AUTH_SECRET: "" })).toThrow();
  });
  it("unifica IPv4 mapeada y agrupa IPv6 por /64", () => {
    expect(canonicalLoginIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(canonicalLoginIp("2001:DB8:1:2::1")).toBe(canonicalLoginIp("2001:0db8:0001:0002:ffff::beef"));
    expect(canonicalLoginIp("2001:db8:1:2::1")).not.toBe(canonicalLoginIp("2001:db8:1:3::1"));
  });
  it("comparte la cuota de cuenta entre IPs y la de IP entre cuentas", () => {
    const first = loginBuckets(headers(), "owner@bakery.test", env);
    const otherIp = loginBuckets(headers("192.0.2.2"), "owner@bakery.test", env);
    const otherAccount = loginBuckets(headers(), "other@bakery.test", env);
    expect(first.find(b => b.key.startsWith("account:"))?.key).toBe(otherIp.find(b => b.key.startsWith("account:"))?.key);
    expect(first.find(b => b.key.startsWith("ip:"))?.key).toBe(otherAccount.find(b => b.key.startsWith("ip:"))?.key);
  });
  it("reserva el intento antes de autenticar y mantiene ventanas fijas", () => {
    const buckets = loginBuckets(headers(), "owner@bakery.test", env);
    const initial = planLoginAttempt(buckets, [], now);
    expect(initial.allowed).toBe(true);
    if (!initial.allowed) throw Error("unexpected block");
    const next = planLoginAttempt(buckets, initial.writes, new Date(now.getTime() + 1000));
    expect(next.allowed).toBe(true);
    if (!next.allowed) throw Error("unexpected block");
    expect(next.writes.every(row => row.attempts === 2)).toBe(true);
    expect(next.writes.map(row => row.expiresAt)).toEqual(initial.writes.map(row => row.expiresAt));
  });
  it("bloquea al agotar la cuota sin prolongar el vencimiento", () => {
    const buckets = loginBuckets(headers(), "owner@bakery.test", env);
    const rows = buckets.map(b => ({ key: b.key, attempts: b.key.startsWith("account:") ? adminLoginLimits.account.maxAttempts : 1, expiresAt: new Date(now.getTime() + 1501) }));
    const before = JSON.stringify(rows);
    expect(planLoginAttempt(buckets, rows, now)).toEqual({ allowed: false, retryAfterSeconds: 2 });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("recupera la cuenta exactamente al expirar el bloqueo", () => {
    const buckets = loginBuckets(headers(), "owner@bakery.test", env);
    const rows = buckets.map(b => ({ key: b.key, attempts: b.maxAttempts, expiresAt: now }));
    const result = planLoginAttempt(buckets, rows, now);
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw Error("unexpected block");
    expect(result.writes.every(row => row.attempts === 1 && row.expiresAt > now)).toBe(true);
  });
  it("devuelve la espera suficiente cuando ambas cuotas estan agotadas", () => {
    const buckets = loginBuckets(headers(), "owner@bakery.test", env);
    const rows = buckets.map((b, index) => ({ key: b.key, attempts: b.maxAttempts, expiresAt: new Date(now.getTime() + (index + 1) * 1000) }));
    expect(planLoginAttempt(buckets, rows, now)).toEqual({ allowed: false, retryAfterSeconds: 2 });
  });
});
