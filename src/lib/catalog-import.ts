import { createHash } from "node:crypto";
import { z } from "zod";
import { productInput } from "./admin-validation";

const maxInt = 2_147_483_647;
function sqliteInteger(value: unknown) {
  if (typeof value === "bigint" && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return value;
}
const integer = (minimum: number, maximum = maxInt) => z.preprocess(sqliteInteger, z.number().int().min(minimum).max(maximum));
const boolean = z.preprocess(value => {
  if (value === 0 || value === BigInt(0)) return false;
  if (value === 1 || value === BigInt(1)) return true;
  return value;
}, z.boolean());
const date = z.preprocess(value => {
  const normalized = sqliteInteger(value);
  if (typeof normalized === "number" && Number.isSafeInteger(normalized)) return new Date(normalized);
  if (typeof normalized === "string" && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) return new Date(normalized);
  return normalized;
}, z.date().refine(value => value.getUTCFullYear() >= 1 && value.getUTCFullYear() <= 9999));
const id = z.string().min(1).max(100).refine(value => value.trim() === value);
const slug = z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const category = z.object({ id, name: z.string().min(1).max(200), slug }).strict();
const product = z.object({
  id, name: z.string(), slug, description: z.string(), priceCents: integer(1), imageUrl: z.string(),
  active: boolean, inventory: integer(0).nullable(), madeToOrder: boolean, categoryId: id,
  createdAt: date, updatedAt: date,
}).strict();
const settings = z.object({
  id: z.literal("store"), pickupEnabled: boolean, deliveryEnabled: boolean, deliveryFeeCents: integer(0),
  address: z.string().nullable(), hours: z.string().nullable(), updatedAt: date,
}).strict();

const snapshotSchema = z.object({
  categories: z.array(category), products: z.array(product), storeSettings: z.array(settings).max(1),
}).strict().superRefine((value, context) => {
  const unique = (rows: { id: string }[], fields: string[], prefix: string) => {
    for (const field of fields) {
      const seen = new Set<unknown>();
      rows.forEach((row, index) => {
        const current = (row as unknown as Record<string, unknown>)[field];
        if (seen.has(current)) context.addIssue({ code: "custom", path: [prefix, index, field], message: "Duplicate unique field" });
        seen.add(current);
      });
    }
  };
  unique(value.categories, ["id", "name", "slug"], "categories");
  unique(value.products, ["id", "slug"], "products");
  unique(value.storeSettings, ["id"], "storeSettings");
  const categoryIds = new Set(value.categories.map(row => row.id));
  value.products.forEach((row, index) => {
    if (!categoryIds.has(row.categoryId)) context.addIssue({ code: "custom", path: ["products", index, "categoryId"], message: "Missing category" });
    const validation = productInput.safeParse(row);
    if (!validation.success) for (const issue of validation.error.issues) context.addIssue({ code: "custom", path: ["products", index, ...issue.path], message: "Invalid product field" });
    if (!row.imageUrl.startsWith("/uploads/")) {
      try {
        const url = new URL(row.imageUrl);
        if (url.protocol !== "https:" || url.username || url.password) throw new Error();
      } catch { context.addIssue({ code: "custom", path: ["products", index, "imageUrl"], message: "Invalid public image URL" }); }
    }
  });
});

export type CatalogSnapshot = z.infer<typeof snapshotSchema>;
export type CatalogTable = "Category" | "Product" | "StoreSettings";
export class CatalogImportError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "CatalogImportError"; }
}

export function parseCatalogSnapshot(value: unknown): CatalogSnapshot {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) throw new CatalogImportError("invalid-catalog:" + parsed.error.issues.map(issue => issue.path.join(".")).join(","));
  return parsed.data;
}

export function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonicalValue(item)]));
  return value;
}

export function catalogFingerprint(snapshot: CatalogSnapshot) {
  const sorted = (rows: { id: string }[]) => [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return createHash("sha256").update(JSON.stringify(canonicalValue({
    categories: sorted(snapshot.categories), products: sorted(snapshot.products), storeSettings: sorted(snapshot.storeSettings),
  }))).digest("hex");
}

export type CatalogImportPlan = {
  create: Record<CatalogTable, string[]>;
  identical: Record<CatalogTable, string[]>;
  conflicts: { table: CatalogTable; id: string; reason: string; fields: string[] }[];
};

export function buildCatalogImportPlan(source: CatalogSnapshot, target: CatalogSnapshot): CatalogImportPlan {
  const plan: CatalogImportPlan = {
    create: { Category: [], Product: [], StoreSettings: [] },
    identical: { Category: [], Product: [], StoreSettings: [] }, conflicts: [],
  };
  const compare = (table: CatalogTable, sourceRows: { id: string }[], targetRows: { id: string }[], uniqueFields: string[]) => {
    const sourceIds = new Set(sourceRows.map(row => row.id));
    for (const row of targetRows) if (!sourceIds.has(row.id)) plan.conflicts.push({ table, id: row.id, reason: "unexpected-target-record", fields: ["id"] });
    for (const row of sourceRows) {
      const input = row as unknown as Record<string, unknown>;
      for (const field of uniqueFields) if (targetRows.some(other => other.id !== row.id && (other as unknown as Record<string, unknown>)[field] === input[field]))
        plan.conflicts.push({ table, id: row.id, reason: "unique-field-conflict", fields: [field] });
      const existing = targetRows.find(other => other.id === row.id);
      if (!existing) { plan.create[table].push(row.id); continue; }
      const output = existing as unknown as Record<string, unknown>;
      const fields = Object.keys(input).filter(field => JSON.stringify(canonicalValue(input[field])) !== JSON.stringify(canonicalValue(output[field])));
      if (fields.length) plan.conflicts.push({ table, id: row.id, reason: "existing-record-differs", fields });
      else plan.identical[table].push(row.id);
    }
  };
  compare("Category", source.categories, target.categories, ["name", "slug"]);
  compare("Product", source.products, target.products, ["slug"]);
  compare("StoreSettings", source.storeSettings, target.storeSettings, []);
  return plan;
}

export const categoryImportSelect = { id: true, name: true, slug: true } as const;
export const productImportSelect = {
  id: true, name: true, slug: true, description: true, priceCents: true, imageUrl: true, active: true,
  inventory: true, madeToOrder: true, categoryId: true, createdAt: true, updatedAt: true,
} as const;
export const storeSettingsImportSelect = {
  id: true, pickupEnabled: true, deliveryEnabled: true, deliveryFeeCents: true, address: true, hours: true, updatedAt: true,
} as const;
