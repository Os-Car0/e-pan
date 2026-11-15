import { describe, expect, it } from "vitest";
import { buildCatalogImportPlan, catalogFingerprint, parseCatalogSnapshot } from "./catalog-import";

// Pure fixtures only. These tests never connect to or write to a database.
const epoch = Date.UTC(2026, 0, 1);
function fixture() {
  return {
    categories: [{ id: "fixture-category", name: "Fixture category", slug: "fixture-category" }],
    products: [{
      id: "fixture-product", name: "Fixture product", slug: "fixture-product", description: "Fixture description",
      priceCents: BigInt(1234), imageUrl: "https://example.invalid/image.jpg", active: BigInt(1),
      inventory: null, madeToOrder: BigInt(0), categoryId: "fixture-category", createdAt: BigInt(epoch), updatedAt: BigInt(epoch),
    }],
    storeSettings: [{ id: "store", pickupEnabled: BigInt(1), deliveryEnabled: BigInt(0), deliveryFeeCents: BigInt(0), address: null, hours: null, updatedAt: BigInt(epoch) }],
  };
}
const empty = () => parseCatalogSnapshot({ categories: [], products: [], storeSettings: [] });

describe("preparación segura del catálogo", () => {
  it("convierte booleanos SQLite y milisegundos UTC sin cambiar centavos o inventario NULL", () => {
    const snapshot = parseCatalogSnapshot(fixture());
    expect(snapshot.products[0].priceCents).toBe(1234);
    expect(snapshot.products[0].active).toBe(true);
    expect(snapshot.products[0].madeToOrder).toBe(false);
    expect(snapshot.products[0].inventory).toBeNull();
    expect(snapshot.products[0].createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(snapshot.storeSettings[0].address).toBeNull();
  });
  it("rechaza enteros incompatibles, booleanos inválidos y fechas sin zona horaria", () => {
    const raw = fixture();
    for (const change of [{ priceCents: BigInt(2_147_483_648) }, { active: BigInt(2) }, { createdAt: "2026-01-01 00:00:00" }])
      expect(() => parseCatalogSnapshot({ ...raw, products: [{ ...raw.products[0], ...change }] })).toThrow();
  });
  it("rechaza productos sin categoría y valores únicos duplicados", () => {
    const raw = fixture();
    expect(() => parseCatalogSnapshot({ ...raw, categories: [] })).toThrow();
    expect(() => parseCatalogSnapshot({ ...raw, products: [...raw.products, { ...raw.products[0], id: "another-fixture" }] })).toThrow();
  });
  it("planea crear únicamente los tres tipos de registro permitidos", () => {
    const source = parseCatalogSnapshot(fixture());
    const plan = buildCatalogImportPlan(source, empty());
    expect(plan.create).toEqual({ Category: ["fixture-category"], Product: ["fixture-product"], StoreSettings: ["store"] });
    expect(plan.conflicts).toEqual([]);
  });
  it("es idempotente cuando el destino ya coincide", () => {
    const source = parseCatalogSnapshot(fixture());
    const plan = buildCatalogImportPlan(source, parseCatalogSnapshot(fixture()));
    expect(plan.create).toEqual({ Category: [], Product: [], StoreSettings: [] });
    expect(plan.identical.Product).toEqual(["fixture-product"]);
    expect(plan.conflicts).toEqual([]);
  });
  it("detecta cambios en destino sin proponer sobrescribirlos", () => {
    const source = parseCatalogSnapshot(fixture());
    const raw = fixture();
    const target = parseCatalogSnapshot({ ...raw, products: [{ ...raw.products[0], priceCents: BigInt(1500) }] });
    const plan = buildCatalogImportPlan(source, target);
    expect(plan.create.Product).toEqual([]);
    expect(plan.conflicts).toContainEqual({ table: "Product", id: "fixture-product", reason: "existing-record-differs", fields: ["priceCents"] });
    expect(target.products[0].priceCents).toBe(1500);
  });
  it("bloquea colisiones de nombre/slug y registros de destino ajenos al lote", () => {
    const source = parseCatalogSnapshot(fixture());
    const target = parseCatalogSnapshot({ categories: [{ ...fixture().categories[0], id: "other-category" }], products: [], storeSettings: [] });
    const plan = buildCatalogImportPlan(source, target);
    expect(plan.conflicts.some(conflict => conflict.reason === "unique-field-conflict")).toBe(true);
    expect(plan.conflicts.some(conflict => conflict.reason === "unexpected-target-record")).toBe(true);
  });
  it("mantiene una huella estable y rechaza campos ajenos al catálogo", () => {
    const source = parseCatalogSnapshot(fixture());
    expect(catalogFingerprint(source)).toBe(catalogFingerprint(parseCatalogSnapshot(fixture())));
    const raw = fixture();
    const changed = parseCatalogSnapshot({ ...raw, products: [{ ...raw.products[0], priceCents: BigInt(1300) }] });
    expect(catalogFingerprint(source)).not.toBe(catalogFingerprint(changed));
    expect(() => parseCatalogSnapshot({ ...raw, users: [] })).toThrow();
  });
});
