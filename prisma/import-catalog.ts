import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs, parseEnv } from "node:util";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  buildCatalogImportPlan, canonicalValue, catalogFingerprint, CatalogImportError, parseCatalogSnapshot,
  categoryImportSelect, productImportSelect, storeSettingsImportSelect,
  type CatalogSnapshot, type CatalogImportPlan,
} from "../src/lib/catalog-import";

const projectRoot = resolve(__dirname, "..");
const fileHash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function readSource(file: string): CatalogSnapshot {
  const before = fileHash(file);
  const db = new DatabaseSync(file, { readOnly: true });
  let rows: unknown;
  try {
    db.exec("BEGIN");
    const read = (sql: string) => { const statement = db.prepare(sql); statement.setReadBigInts(true); return statement.all(); };
    rows = {
      categories: read("SELECT id,name,slug FROM Category ORDER BY id"),
      products: read("SELECT id,name,slug,description,priceCents,imageUrl,active,inventory,madeToOrder,categoryId,createdAt,updatedAt FROM Product ORDER BY id"),
      storeSettings: read("SELECT id,pickupEnabled,deliveryEnabled,deliveryFeeCents,address,hours,updatedAt FROM StoreSettings ORDER BY id"),
    };
  } finally {
    try { db.exec("ROLLBACK"); } finally { db.close(); }
  }
  if (fileHash(file) !== before) throw new CatalogImportError("source-changed-during-read");
  const snapshot = parseCatalogSnapshot(rows);
  if (!snapshot.categories.length || !snapshot.products.length) throw new CatalogImportError("source-catalog-empty");
  return snapshot;
}

function inspectImages(source: CatalogSnapshot, sourcePublic: string) {
  const referenced = new Set<string>();
  const images = source.products.map(product => {
    if (!product.imageUrl.startsWith("/uploads/")) {
      const url = new URL(product.imageUrl);
      return { productId: product.id, local: false, host: url.hostname, temporaryQuery: [...url.searchParams.keys()].some(key => /token|signature|expires|api.?key/i.test(key)) };
    }
    const url = new URL(product.imageUrl, "https://local.invalid");
    const relative = decodeURIComponent(url.pathname);
    if (!relative.startsWith("/uploads/")) throw new CatalogImportError("invalid-local-image-path");
    const original = resolve(sourcePublic, "." + relative);
    const published = resolve(projectRoot, "public", "." + relative);
    if (!original.startsWith(resolve(sourcePublic) + sep) || !published.startsWith(resolve(projectRoot, "public") + sep)) throw new CatalogImportError("invalid-local-image-path");
    referenced.add(relative);
    const sourceExists = existsSync(original), publicationExists = existsSync(published);
    const sameBytes = sourceExists && publicationExists && fileHash(original) === fileHash(published);
    if (!sameBytes) throw new CatalogImportError("missing-or-different-local-product-image");
    return { productId: product.id, local: true, path: relative, sourceExists, publicationExists, sameBytes };
  });
  const directory = resolve(sourcePublic, "uploads");
  const unreferencedLocalFiles = existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && !referenced.has("/uploads/" + entry.name)).map(entry => "/uploads/" + entry.name).sort() : [];
  return { images, referencedLocalImages: referenced.size, unreferencedLocalFiles };
}

async function targetSnapshot(tx: Prisma.TransactionClient) {
  const [categories, products, storeSettings] = await Promise.all([
    tx.category.findMany({ select: categoryImportSelect, orderBy: { id: "asc" } }),
    tx.product.findMany({ select: productImportSelect, orderBy: { id: "asc" } }),
    tx.storeSettings.findMany({ select: storeSettingsImportSelect, orderBy: { id: "asc" } }),
  ]);
  return parseCatalogSnapshot({ categories, products, storeSettings });
}

function planSummary(plan: CatalogImportPlan) {
  return Object.fromEntries((["Category", "Product", "StoreSettings"] as const).map(table => [table, {
    create: plan.create[table].length, identical: plan.identical[table].length,
    conflicts: plan.conflicts.filter(conflict => conflict.table === table).length,
  }]));
}

async function main() {
  const { values } = parseArgs({
    options: { source: { type: "string" }, apply: { type: "boolean", default: false }, "expected-source-sha256": { type: "string" }, "expected-target-sha256": { type: "string" }, help: { type: "boolean", default: false } },
    strict: true, allowPositionals: false,
  });
  if (values.help) {
    console.log("Default: read-only check. Use --source <SQLite path>. Future writes require --apply, --expected-source-sha256 <reviewed hash> and --expected-target-sha256 <reviewed hash>.");
    return;
  }
  if (values.apply && (!values["expected-source-sha256"] || !values["expected-target-sha256"])) throw new CatalogImportError("apply-requires-both-reviewed-fingerprints");
  const sourceFile = resolve(values.source ?? resolve(projectRoot, "..", "E-pan", "prisma", "dev.db"));
  const source = readSource(sourceFile);
  const sourceFingerprint = catalogFingerprint(source);
  if (values["expected-source-sha256"] && values["expected-source-sha256"] !== sourceFingerprint) throw new CatalogImportError("source-differs-from-reviewed-snapshot");
  const imageManifest = inspectImages(source, resolve(dirname(sourceFile), "..", "public"));
  if (imageManifest.images.some(image => image.temporaryQuery)) throw new CatalogImportError("temporary-image-url-needs-review");
  const env = parseEnv(readFileSync(resolve(projectRoot, ".env"), "utf8"));
  if (!env.DIRECT_URL) throw new CatalogImportError("missing-direct-url");
  const targetUrl = new URL(env.DIRECT_URL);
  if (targetUrl.protocol !== "postgresql:" || !targetUrl.hostname.endsWith(".neon.tech") || targetUrl.hostname.includes("-pooler.") || !["require", "verify-ca", "verify-full"].includes(targetUrl.searchParams.get("sslmode") ?? "") || !targetUrl.username || !targetUrl.password)
    throw new CatalogImportError("invalid-direct-postgresql-target");
  const targetFingerprint = createHash("sha256").update(JSON.stringify({ hostname: targetUrl.hostname, port: targetUrl.port || "5432", database: targetUrl.pathname, username: targetUrl.username })).digest("hex");
  if (values["expected-target-sha256"] && values["expected-target-sha256"] !== targetFingerprint) throw new CatalogImportError("target-differs-from-reviewed-database");
  const client = new PrismaClient({ datasourceUrl: env.DIRECT_URL, log: [] });
  try {
    if (!values.apply) {
      const result = await client.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const target = await targetSnapshot(tx);
        const mode = await tx.$queryRawUnsafe<{ mode: string }[]>("SELECT current_setting('transaction_read_only') AS mode");
        return { target, plan: buildCatalogImportPlan(source, target), readOnly: mode[0].mode === "on" };
      }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 30000 });
      console.log(JSON.stringify({
        mode: "read-only-check", sourceFingerprint, targetFingerprint,
        sourceCounts: { Category: source.categories.length, Product: source.products.length, StoreSettings: source.storeSettings.length },
        sourceSummary: { activeProducts: source.products.filter(product => product.active).length, untrackedInventoryProducts: source.products.filter(product => product.inventory === null).length, madeToOrderProducts: source.products.filter(product => product.madeToOrder).length, store: source.storeSettings.map(settings => ({ id: settings.id, pickupEnabled: settings.pickupEnabled, deliveryEnabled: settings.deliveryEnabled, deliveryFeeCents: settings.deliveryFeeCents, addressPresent: settings.address !== null, hoursPresent: settings.hours !== null })) },
        targetCounts: { Category: result.target.categories.length, Product: result.target.products.length, StoreSettings: result.target.storeSettings.length },
        plan: planSummary(result.plan), conflicts: result.plan.conflicts, imageManifest,
        readOnlyTransaction: result.readOnly, importExecuted: false,
      }, null, 2));
      if (result.plan.conflicts.length) throw new CatalogImportError("target-conflicts-require-review");
      return;
    }

    // This branch is intentionally not executed during preparation. No upsert,
    // update, delete, seed, nested relation writes or other models are permitted.
    const result = await client.$transaction(async tx => {
      const target = await targetSnapshot(tx);
      const plan = buildCatalogImportPlan(source, target);
      if (plan.conflicts.length) throw new CatalogImportError("target-conflicts-require-review");
      for (const row of source.categories) if (plan.create.Category.includes(row.id)) await tx.category.create({ data: row });
      for (const row of source.products) if (plan.create.Product.includes(row.id)) await tx.product.create({ data: row });
      for (const row of source.storeSettings) if (plan.create.StoreSettings.includes(row.id)) await tx.storeSettings.create({ data: row });
      const after = await targetSnapshot(tx);
      if (JSON.stringify(canonicalValue(buildCatalogImportPlan(source, after).create)) !== JSON.stringify(canonicalValue({ Category: [], Product: [], StoreSettings: [] })) || buildCatalogImportPlan(source, after).conflicts.length)
        throw new CatalogImportError("post-import-verification-failed");
      return planSummary(plan);
    }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 30000 });
    console.log(JSON.stringify({ mode: "apply", sourceFingerprint, targetFingerprint, result, importExecuted: true }, null, 2));
  } finally { await client.$disconnect(); }
}

main().catch(error => {
  const code = error instanceof CatalogImportError ? error.code : /^P\d{4}$/.test(String(error?.code)) ? String(error.code) : "catalog-import-failed";
  console.error(JSON.stringify({ success: false, code }));
  process.exitCode = 1;
});
