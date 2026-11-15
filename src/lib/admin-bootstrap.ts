import { z } from "zod";

export class AdminBootstrapError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "AdminBootstrapError"; }
}

export function reviewAdminCredentials(env: Record<string, string | undefined>) {
  const issues: string[] = [];
  const email = env.ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const password = env.ADMIN_PASSWORD ?? "";
  const name = env.ADMIN_NAME?.trim() ?? "";
  const emailValid = z.email().max(254).safeParse(email).success;
  const exampleEmail = /@(?:example\.(?:com|org|net)|test\.com|localhost)$|\.(?:example|test|invalid)$/i.test(email)
    || /^(?:example|ejemplo|your[_.-]?email|tu[_.-]?correo|correo[_.-]?ejemplo)/i.test(email.split("@")[0]);
  if (!email) issues.push("ADMIN_EMAIL:missing");
  else if (!emailValid || exampleEmail) issues.push("ADMIN_EMAIL:invalid-or-example");
  if (!name) issues.push("ADMIN_NAME:missing");
  else if (name.length < 2 || name.length > 100 || /[\x00-\x1f]/.test(name)) issues.push("ADMIN_NAME:invalid");

  const characterMinimumMet = Array.from(password).length >= 15;
  const bcryptByteLimitMet = Buffer.byteLength(password, "utf8") <= 72;
  const lower = password.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  const knownWeak = /password|contrasena|changeme|qwerty|letmein|bienvenido|123456|abcdef|yourpassword|examplepassword/.test(compact)
    || /^(?:admin(?:istrador)?|epan|panaderia|secret|demo|test|replace|example|ejemplo)[a-z]*\d*$/.test(compact)
    || /^([\s\S]{1,12})\1+$/u.test(password) || (password.length > 0 && new Set(password).size < 6)
    || /^(?:<[\s\S]*>|\[[\s\S]*\])$/.test(password);
  const identityParts = [email.split("@")[0], ...name.toLowerCase().split(/\s+/)].filter(part => part.length >= 4);
  const containsIdentity = identityParts.some(part => password.toLowerCase().includes(part));
  if (!password) issues.push("ADMIN_PASSWORD:missing");
  else {
    if (!characterMinimumMet) issues.push("ADMIN_PASSWORD:minimum-15-characters");
    if (!bcryptByteLimitMet) issues.push("ADMIN_PASSWORD:bcrypt-72-byte-limit");
    if (/[\x00-\x1f]/.test(password)) issues.push("ADMIN_PASSWORD:control-characters");
    if (knownWeak || containsIdentity) issues.push("ADMIN_PASSWORD:predictable-or-example");
    if (password === env.AUTH_SECRET) issues.push("ADMIN_PASSWORD:must-differ-from-auth-secret");
  }
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) issues.push("AUTH_SECRET:missing-or-short");
  return {
    ready: issues.length === 0,
    variables: {
      ADMIN_EMAIL: { present: !!email, valid: emailValid && !exampleEmail },
      ADMIN_PASSWORD: { present: !!password, characterMinimumMet, bcryptByteLimitMet, predictableOrExampleDetected: knownWeak || containsIdentity },
      ADMIN_NAME: { present: !!name, valid: !!name && name.length >= 2 && name.length <= 100 && !/[\x00-\x1f]/.test(name) },
      AUTH_SECRET: { present: !!env.AUTH_SECRET, minimumLengthMet: (env.AUTH_SECRET?.length ?? 0) >= 32 },
    },
    issues,
  };
}

export function assertFirstAdminCanBeCreated(review: ReturnType<typeof reviewAdminCredentials>, userCount: number) {
  if (!review.ready) throw new AdminBootstrapError("admin-credentials-not-ready");
  if (userCount !== 0) throw new AdminBootstrapError("first-admin-requires-empty-user-table");
}
