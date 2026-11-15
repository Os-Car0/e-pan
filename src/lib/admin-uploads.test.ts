import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requireStaff: vi.fn() }));
import { requireStaff } from "./auth";
import { POST } from "../app/api/admin/uploads/route";
import { maxImageUploadBytes } from "./image-upload";

const staff = vi.mocked(requireStaff);
const request = (body: unknown) => new Request("http://localhost/api/admin/uploads", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("subidas administrativas en serverless", () => {
  it("exige sesión antes de emitir una autorización", async () => {
    staff.mockResolvedValue(null);
    expect((await POST(request({ type: "image/jpeg", size: 10 }))).status).toBe(401);
  });
  it("devuelve infraestructura no configurada en lugar de una URL ficticia", async () => {
    staff.mockResolvedValue({ id: "staff-test", role: "ADMIN" });
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    expect((await POST(request({ type: "image/jpeg", size: 10 }))).status).toBe(503);
  });
  it("rechaza SVG, archivos vacíos y tamaños superiores a 10 MB", async () => {
    staff.mockResolvedValue({ id: "staff-test", role: "ADMIN" });
    for (const body of [{ type: "image/svg+xml", size: 10 }, { type: "image/png", size: 0 }, { type: "image/png", size: maxImageUploadBytes + 1 }])
      expect((await POST(request(body))).status).toBe(400);
  });
  it("no incluye credenciales en caché ni expone el secreto del proveedor", async () => {
    staff.mockResolvedValue({ id: "staff-test", role: "BAKER" });
    const secret = "fixture-" + "x".repeat(32);
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "e-pan-unit-test");
    vi.stubEnv("CLOUDINARY_API_KEY", "123456789012345");
    vi.stubEnv("CLOUDINARY_API_SECRET", secret);
    const response = await POST(request({ type: "image/jpeg", size: maxImageUploadBytes }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("https://api.cloudinary.com/");
    expect(body).not.toContain(secret);
  });
});
