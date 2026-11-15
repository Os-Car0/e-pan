import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { AdminBootstrapError, assertFirstAdminCanBeCreated, reviewAdminCredentials } from "../src/lib/admin-bootstrap";

async function main() {
  const { values } = parseArgs({ options: {
    create: { type: "boolean", default: false },
    "expected-target-sha256": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log("Default: READ ONLY. Future creation requires --create and --expected-target-sha256 <reviewed target fingerprint>. Credentials are read only from the private local .env.");
    return;
  }
  const raw = readFileSync(resolve(__dirname, "..", ".env"), "utf8"), env = parseEnv(raw);
  for (const name of ["DIRECT_URL", "AUTH_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN_NAME"]) {
    if (raw.split(/\r?\n/).filter(line => new RegExp("^\\s*(?:export\\s+)?" + name + "\\s*=").test(line)).length > 1)
      throw new AdminBootstrapError("duplicate-bootstrap-variable");
  }
  if (!env.DIRECT_URL) throw new AdminBootstrapError("missing-direct-url");
  const target = new URL(env.DIRECT_URL);
  if (target.protocol !== "postgresql:" || !target.hostname.endsWith(".neon.tech") || target.hostname.includes("-pooler.") || !target.username || !target.password || !["require", "verify-ca", "verify-full"].includes(target.searchParams.get("sslmode") ?? ""))
    throw new AdminBootstrapError("invalid-direct-neon-target");
  const targetFingerprint = createHash("sha256").update(JSON.stringify({ hostname: target.hostname, port: target.port || "5432", database: target.pathname, username: target.username })).digest("hex");
  if (values.create && !values["expected-target-sha256"]) throw new AdminBootstrapError("creation-requires-reviewed-target-fingerprint");
  if (values["expected-target-sha256"] && values["expected-target-sha256"] !== targetFingerprint) throw new AdminBootstrapError("target-differs-from-reviewed-database");
  const review = reviewAdminCredentials(env);
  const email = env.ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const client = new PrismaClient({ datasourceUrl: env.DIRECT_URL, log: [] });
  try {
    const state = await client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const userCount = await tx.user.count(), adminCount = await tx.user.count({ where: { role: "ADMIN" } });
      const matchingEmailCount = email ? await tx.user.count({ where: { email: { equals: email, mode: "insensitive" } } }) : 0;
      const mode = await tx.$queryRawUnsafe<{ mode: string }[]>("SELECT current_setting('transaction_read_only') AS mode");
      return { userCount, adminCount, matchingEmailCount, transactionReadOnly: mode[0].mode === "on" };
    }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 30000 });
    console.log(JSON.stringify({ mode: "read-only-check", targetFingerprint, credentialReview: review, ...state, readyForCreation: review.ready && state.userCount === 0, recordsWritten: 0 }, null, 2));
    if (!values.create) {
      if (!review.ready || state.userCount !== 0) process.exitCode = 1;
      return;
    }
    // Never run this branch during preparation. There is no seed, default account,
    // upsert, password reset, promotion or mutation of any other model.
    assertFirstAdminCanBeCreated(review, state.userCount);
    const password = env.ADMIN_PASSWORD, name = env.ADMIN_NAME?.trim();
    if (!password || !name) throw new AdminBootstrapError("missing-administrator-credentials");
    const passwordHash = await bcrypt.hash(password, 12);
    if (bcrypt.getRounds(passwordHash) !== 12 || !await bcrypt.compare(password, passwordHash)) throw new AdminBootstrapError("password-hash-verification-failed");
    await client.$transaction(async tx => {
      assertFirstAdminCanBeCreated(review, await tx.user.count());
      if (await tx.user.count({ where: { email: { equals: email, mode: "insensitive" } } })) throw new AdminBootstrapError("admin-email-already-exists");
      const user = await tx.user.create({ data: { name, email, passwordHash, role: "ADMIN" }, select: { role: true } });
      if (user.role !== "ADMIN" || await tx.user.count() !== 1 || await tx.user.count({ where: { email, role: "ADMIN" } }) !== 1) throw new AdminBootstrapError("created-admin-verification-failed");
    }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 30000 });
    console.log(JSON.stringify({ administratorCreated: true, recordsCreated: 1, role: "ADMIN", otherModelsModified: false }));
  } finally { await client.$disconnect(); }
}

main().catch(error => {
  const code = error instanceof AdminBootstrapError ? error.code : /^P\d{4}$/.test(String(error?.code)) ? String(error.code) : "admin-bootstrap-failed";
  console.error(JSON.stringify({ success: false, code }));
  process.exitCode = 1;
});
