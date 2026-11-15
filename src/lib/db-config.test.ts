import { afterEach, describe, expect, it, vi } from "vitest";
import { hasDatabaseUrl } from "./db-config";

afterEach(() => vi.unstubAllEnvs());
describe("configuración PostgreSQL de despliegue", () => {
  it("rechaza SQLite local para no aparentar persistencia en serverless", () => {
    vi.stubEnv("DATABASE_URL", "file:./dev.db");
    expect(hasDatabaseUrl()).toBe(false);
  });
  it("acepta una URL PostgreSQL válida sin conectarse a la base", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test-user@db.example.invalid/test-db?sslmode=require");
    expect(hasDatabaseUrl()).toBe(true);
  });
});
