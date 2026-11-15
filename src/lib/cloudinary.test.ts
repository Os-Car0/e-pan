import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageUploadAuthorization } from "./cloudinary";

vi.mock("node:crypto", async () => ({
  ...await vi.importActual<typeof import("node:crypto")>("node:crypto"),
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("autorización de imágenes", () => {
  it("no simula una subida si falta configuración", () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    expect(createImageUploadAuthorization()).toBeNull();
  });

  it("mantiene el secreto en servidor y firma restricciones de formato y sobrescritura", () => {
    const secret = ["unit", "test", "only"].join("-") + "x".repeat(32);
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "e-pan-unit-test");
    vi.stubEnv("CLOUDINARY_API_KEY", "123456789012345");
    vi.stubEnv("CLOUDINARY_API_SECRET", secret);
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const authorization = createImageUploadAuthorization()!;
    expect(authorization.uploadUrl).toBe("https://api.cloudinary.com/v1_1/e-pan-unit-test/image/upload");
    expect(authorization.deliveryPrefix).toBe("https://res.cloudinary.com/e-pan-unit-test/image/upload/");
    expect(authorization.fields.public_id).toMatch(/^e-pan\/[a-f\d-]{36}$/);
    expect(authorization.fields.overwrite).toBe("false");
    expect(authorization.fields.allowed_formats.split(",")).not.toContain("svg");
    expect(authorization.fields.signature).toBe("a9ba67bc969d6659834f88822490f450f32a2cc42864aed6dbff2863507e41d8");
    expect(JSON.stringify(authorization)).not.toContain(secret);
    expect(authorization).not.toHaveProperty("api_secret");
  });

  it("rechaza un nombre que pueda cambiar el destino del proveedor", () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "invalid/../cloud");
    expect(createImageUploadAuthorization()).toBeNull();
  });
});
