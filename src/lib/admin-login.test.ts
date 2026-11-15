import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/auth", () => ({ issueSession: vi.fn() }));
vi.mock("@/lib/admin-login-rate-limit-store", () => ({ reserveAdminLoginAttempt: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { compare: vi.fn() } }));
import { db } from "./db";
import { issueSession } from "./auth";
import { reserveAdminLoginAttempt } from "./admin-login-rate-limit-store";
import bcrypt from "bcryptjs";
import { POST } from "../app/api/admin/login/route";

const lookup = vi.mocked(db.user.findUnique), limit = vi.mocked(reserveAdminLoginAttempt), compare = vi.mocked(bcrypt.compare as (password: string, hash: string) => Promise<boolean>), issue = vi.mocked(issueSession);
const account = "owner@bakery.test", password = "fixture-not-a-real-password";
const request = (email = account) => new Request("https://bakery.test/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
const staff = (role: "ADMIN" | "BAKER" | "CUSTOMER" = "ADMIN") => ({ id: "fixture-user", name: "Fixture", email: account, passwordHash: "fixture-stored-hash", role, createdAt: new Date(), updatedAt: new Date() });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DATABASE_URL", "postgresql://fixture:fixture@localhost/fixture"); vi.stubEnv("NODE_ENV", "production");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  limit.mockResolvedValue({ allowed: true }); issue.mockResolvedValue("fixture-session-token");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("login protegido", () => {
  it("devuelve el mismo 401 para una cuenta ausente, rol no permitido o clave incorrecta", async () => {
    lookup.mockResolvedValue(null); compare.mockResolvedValue(false);
    const absent = await POST(request());
    const dummy = compare.mock.calls[0][1];
    expect(dummy).toMatch(/^\$2[aby]\$12\$/);
    lookup.mockResolvedValue(staff("CUSTOMER"));
    const customer = await POST(request());
    expect(compare.mock.calls[1][1]).toBe(dummy);
    lookup.mockResolvedValue(staff());
    const wrong = await POST(request());
    expect([absent.status, customer.status, wrong.status]).toEqual([401, 401, 401]);
    expect(await absent.text()).toBe(await customer.text());
    expect(await wrong.json()).toEqual({ error: "Credenciales inválidas" });
    expect(issue).not.toHaveBeenCalled();
  });
  it("devuelve 429 generico con Retry-After antes de consultar usuarios o bcrypt", async () => {
    limit.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });
    const first = await POST(request()), second = await POST(request("missing@bakery.test"));
    expect(first.status).toBe(429); expect(first.headers.get("Retry-After")).toBe("120");
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(await first.text()).toBe(await second.text());
    expect(lookup).not.toHaveBeenCalled(); expect(compare).not.toHaveBeenCalled(); expect(issue).not.toHaveBeenCalled();
  });
  it("falla cerrado con 503 sin revelar detalles sensibles del almacenamiento", async () => {
    limit.mockRejectedValue(Error("sensitive fixture should never appear"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive fixture");
    expect(console.error).toHaveBeenCalledWith("admin_login_unavailable");
    expect(lookup).not.toHaveBeenCalled(); expect(issue).not.toHaveBeenCalled();
  });
  it.each(["ADMIN", "BAKER"] as const)("conserva JWT y cookie para %s con credenciales correctas", async role => {
    lookup.mockResolvedValue(staff(role)); compare.mockResolvedValue(true);
    const response = await POST(request(" Owner@Bakery.test "));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
    expect(limit).toHaveBeenCalledWith(expect.any(Headers), account);
    expect(lookup).toHaveBeenCalledWith({ where: { email: account }, select: { id: true, role: true, passwordHash: true } });
    expect(issue).toHaveBeenCalledWith("fixture-user", role);
    const cookie = response.headers.get("set-cookie")!;
    for (const part of ["epan_session=fixture-session-token", "HttpOnly", "Secure", "SameSite=lax", "Max-Age=28800", "Path=/"]) expect(cookie).toContain(part);
  });
  it("no procesa credenciales malformadas ni consulta Neon si no esta configurado", async () => {
    const malformed = new Request("https://bakery.test/api/admin/login", { method: "POST", body: "{" });
    expect((await POST(malformed)).status).toBe(400);
    expect((await POST(request("invalid-email"))).status).toBe(400);
    vi.stubEnv("DATABASE_URL", "");
    expect((await POST(request())).status).toBe(503);
    expect(limit).not.toHaveBeenCalled(); expect(lookup).not.toHaveBeenCalled();
  });
});
