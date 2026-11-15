import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginLimitRetentionMs, type LoginLimitRecord } from "./admin-login-rate-limit";
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("./db", () => ({ db: { $transaction: mocks.transaction } }));
import { reserveAdminLoginAttempt } from "./admin-login-rate-limit-store";

const headers = (ip = "192.0.2.1") => new Headers({ "x-nf-client-connection-ip": ip });
// Simulated database only: serialize transactions and commit a private copy.
// Production storage is Prisma/PostgreSQL, never this in-memory test fixture.
function databaseFixture() {
  const records = new Map<string, LoginLimitRecord>();
  let clock = new Date("2026-11-15T00:00:00Z"), tail = Promise.resolve();
  const fixture = { records, failSecondWrite: false, cleanupBatchSize: 0, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); } };
  const transaction = async (work: (tx: object) => Promise<unknown>) => {
    const result = tail.then(async () => {
      const copy = new Map([...records].map(([key, row]) => [key, { ...row }]));
      let writes = 0;
      const tx = {
        $queryRaw: async () => [{ now: new Date(clock) }],
        adminLoginRateLimit: {
          findMany: async (args: { where: { key?: { in: string[] }; expiresAt?: { lt: Date } }; take?: number }) => {
            if (args.where.key) return [...copy.values()].filter(row => args.where.key?.in.includes(row.key));
            const cutoff = args.where.expiresAt!.lt;
            const stale = [...copy.values()].filter(row => row.expiresAt < cutoff).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()).slice(0, args.take);
            fixture.cleanupBatchSize = stale.length;
            return stale;
          },
          upsert: async (args: { where: { key: string }; create: LoginLimitRecord; update: { attempts: number; expiresAt: Date } }) => {
            writes++;
            if (fixture.failSecondWrite && writes === 2) throw { code: "P1001" };
            const row = copy.has(args.where.key) ? { key: args.where.key, ...args.update } : args.create;
            copy.set(row.key, row);
            return row;
          },
          deleteMany: async (args: { where: { key: { in: string[] }; expiresAt: { lt: Date } } }) => {
            let count = 0;
            for (const key of args.where.key.in) if (copy.get(key)!.expiresAt < args.where.expiresAt.lt) { copy.delete(key); count++; }
            return { count };
          },
        },
      };
      const outcome = await work(tx);
      records.clear(); for (const [key, row] of copy) records.set(key, row);
      return outcome;
    });
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  mocks.transaction.mockImplementation(transaction);
  return fixture;
}

beforeEach(() => {
  mocks.transaction.mockReset();
  vi.stubEnv("AUTH_SECRET", "fixture-" + "x".repeat(48));
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ADMIN_LOGIN_IP_SOURCE", "netlify");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("reserva persistente de intentos", () => {
  it("no supera cinco reservas en peticiones paralelas a la misma cuenta", async () => {
    const fixture = databaseFixture();
    const results = await Promise.all(Array.from({ length: 30 }, () => reserveAdminLoginAttempt(headers(), "owner@bakery.test")));
    expect(results.filter(result => result.allowed)).toHaveLength(5);
    expect([...fixture.records.values()].every(row => row.attempts === 5)).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
  });
  it("mantiene la cuota de cuenta aunque cambie la IP", async () => {
    databaseFixture();
    for (let index = 1; index <= 5; index++) expect((await reserveAdminLoginAttempt(headers(`192.0.2.${index}`), "owner@bakery.test")).allowed).toBe(true);
    expect((await reserveAdminLoginAttempt(headers("198.51.100.9"), "owner@bakery.test")).allowed).toBe(false);
  });
  it("limita el barrido de cuentas a 60 intentos por IP compartida", async () => {
    const fixture = databaseFixture();
    for (let index = 0; index < 60; index++) expect((await reserveAdminLoginAttempt(headers(), `operator${index}@bakery.test`)).allowed).toBe(true);
    expect((await reserveAdminLoginAttempt(headers(), "another@bakery.test")).allowed).toBe(false);
    const ip = [...fixture.records.values()].find(row => row.key.startsWith("ip:"))!;
    const expiry = ip.expiresAt.getTime();
    fixture.advance(1000);
    expect((await reserveAdminLoginAttempt(headers(), "another@bakery.test")).allowed).toBe(false);
    expect(fixture.records.get(ip.key)?.expiresAt.getTime()).toBe(expiry);
    fixture.advance(10 * 60 * 1000);
    expect((await reserveAdminLoginAttempt(headers(), "another@bakery.test")).allowed).toBe(true);
  });
  it("permite recuperarse tras el bloqueo temporal de cuenta", async () => {
    const fixture = databaseFixture();
    for (let index = 0; index < 5; index++) await reserveAdminLoginAttempt(headers(), "owner@bakery.test");
    expect(await reserveAdminLoginAttempt(headers(), "owner@bakery.test")).toEqual({ allowed: false, retryAfterSeconds: 900 });
    fixture.advance(15 * 60 * 1000);
    expect(await reserveAdminLoginAttempt(headers(), "owner@bakery.test")).toEqual({ allowed: true });
    expect([...fixture.records.values()].every(row => row.attempts === 1)).toBe(true);
  });
  it.each(["P2034", "P2002"])("reintenta %s sin consumir dos veces el mismo intento", async code => {
    const fixture = databaseFixture();
    mocks.transaction.mockRejectedValueOnce({ code });
    expect(await reserveAdminLoginAttempt(headers(), "owner@bakery.test")).toEqual({ allowed: true });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect([...fixture.records.values()].every(row => row.attempts === 1)).toBe(true);
  });
  it("falla cerrado al agotar reintentos o si falta la tabla", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2034" });
    await expect(reserveAdminLoginAttempt(headers(), "owner@bakery.test")).rejects.toThrow("admin-login-protection-unavailable");
    expect(mocks.transaction).toHaveBeenCalledTimes(4);
    mocks.transaction.mockReset().mockRejectedValue({ code: "P2021", message: "sensitive fixture" });
    await expect(reserveAdminLoginAttempt(headers(), "owner@bakery.test")).rejects.toThrow("admin-login-protection-unavailable");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it("revierte ambas cuotas si falla la segunda escritura", async () => {
    const fixture = databaseFixture(); fixture.failSecondWrite = true;
    await expect(reserveAdminLoginAttempt(headers(), "owner@bakery.test")).rejects.toThrow();
    expect(fixture.records.size).toBe(0);
  });
  it("limpia como maximo 100 registros antiguos sin borrar cuotas activas", async () => {
    const fixture = databaseFixture();
    for (let index = 0; index < 201; index++) fixture.records.set(`old-${index}`, { key: `old-${index}`, attempts: 1, expiresAt: new Date(Date.parse("2026-11-15T00:00:00Z") - loginLimitRetentionMs - 1) });
    await reserveAdminLoginAttempt(headers(), "owner@bakery.test");
    expect(fixture.cleanupBatchSize).toBe(100);
    expect([...fixture.records.keys()].filter(key => key.startsWith("old-"))).toHaveLength(101);
    expect([...fixture.records.values()].filter(row => !row.key.startsWith("old-"))).toHaveLength(2);
  });
});
