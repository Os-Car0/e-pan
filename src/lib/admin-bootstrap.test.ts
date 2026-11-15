import { describe, expect, it } from "vitest";
import { assertFirstAdminCanBeCreated, reviewAdminCredentials } from "./admin-bootstrap";

const credentials = () => ({
  ADMIN_EMAIL: "owner@bakery.dev", ADMIN_NAME: "Bakery Owner",
  ADMIN_PASSWORD: "mQ7!rT2#vN9$kX4%zP8@fL6?", AUTH_SECRET: "fixture-auth-" + "a".repeat(40),
});

describe("preparacion del primer administrador", () => {
  it("acepta credenciales completas sin devolver sus valores", () => {
    const env = credentials(), review = reviewAdminCredentials(env);
    expect(review.ready).toBe(true);
    expect(() => assertFirstAdminCanBeCreated(review, 0)).not.toThrow();
    for (const value of Object.values(env)) expect(JSON.stringify(review)).not.toContain(value);
  });
  it("rechaza credenciales ausentes sin elegir valores predeterminados", () => {
    const review = reviewAdminCredentials({});
    expect(review.ready).toBe(false);
    expect(review.issues).toContain("ADMIN_PASSWORD:missing");
    expect(review.issues).toContain("ADMIN_NAME:missing");
    expect(() => assertFirstAdminCanBeCreated(review, 0)).toThrow("admin-credentials-not-ready");
  });
  it("rechaza direcciones de ejemplo y contrasenas predecibles aunque sean largas", () => {
    const review = reviewAdminCredentials({ ...credentials(), ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "Password123456789!" });
    expect(review.issues).toContain("ADMIN_EMAIL:invalid-or-example");
    expect(review.issues).toContain("ADMIN_PASSWORD:predictable-or-example");
    expect(reviewAdminCredentials({ ...credentials(), ADMIN_EMAIL: "ejemplo.owner@bakery.dev" }).issues).toContain("ADMIN_EMAIL:invalid-or-example");
  });
  it("valida el limite bcrypt por bytes UTF-8 sin truncar", () => {
    const password = credentials().ADMIN_PASSWORD + "🍞".repeat(13);
    expect(password.length).toBeLessThanOrEqual(72);
    const review = reviewAdminCredentials({ ...credentials(), ADMIN_PASSWORD: password });
    expect(review.issues).toContain("ADMIN_PASSWORD:bcrypt-72-byte-limit");
  });
  it("cuenta caracteres Unicode y rechaza contrasenas cortas", () => {
    const review = reviewAdminCredentials({ ...credentials(), ADMIN_PASSWORD: "aB3!cD5?eF7@🍞" });
    expect(review.issues).toContain("ADMIN_PASSWORD:minimum-15-characters");
  });
  it("rechaza datos de identidad, repeticiones y reutilizacion del secreto JWT", () => {
    for (const password of ["Bakery-Owner-92837465!", "abcXYZ12abcXYZ12abcXYZ12", credentials().AUTH_SECRET]) {
      const review = reviewAdminCredentials({ ...credentials(), ADMIN_PASSWORD: password });
      expect(review.ready).toBe(false);
    }
  });
  it("se niega a crear otro usuario en una tabla no vacia", () => {
    expect(() => assertFirstAdminCanBeCreated(reviewAdminCredentials(credentials()), 1)).toThrow("first-admin-requires-empty-user-table");
  });
  it("exige un secreto de autenticacion configurado y no altera las credenciales", () => {
    const env = { ...credentials(), AUTH_SECRET: "" }, before = { ...env };
    expect(reviewAdminCredentials(env).issues).toContain("AUTH_SECRET:missing-or-short");
    expect(env).toEqual(before);
  });
});
