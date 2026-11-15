import { db } from "./db";
import { loginBuckets, loginLimitRetentionMs, LoginProtectionUnavailable, planLoginAttempt } from "./admin-login-rate-limit";

export async function reserveAdminLoginAttempt(headers: Headers, email: string): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const buckets = loginBuckets(headers, email);
  // PostgreSQL Serializable prevents lost increments across serverless instances.
  // Retrying also handles two instances creating the same previously absent key.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS "now"`;
        if (!(clock?.now instanceof Date) || !Number.isFinite(clock.now.getTime())) throw new LoginProtectionUnavailable();
        const rows = await tx.adminLoginRateLimit.findMany({ where: { key: { in: buckets.map(bucket => bucket.key) } } });
        const plan = planLoginAttempt(buckets, rows, clock.now);
        if (!plan.allowed) return { allowed: false as const, retryAfterSeconds: plan.retryAfterSeconds };
        for (const row of plan.writes)
          await tx.adminLoginRateLimit.upsert({ where: { key: row.key }, create: row, update: { attempts: row.attempts, expiresAt: row.expiresAt } });
        // Bounded, opportunistic retention cleanup, confined to limiter records.
        const cutoff = new Date(clock.now.getTime() - loginLimitRetentionMs);
        const stale = await tx.adminLoginRateLimit.findMany({ where: { expiresAt: { lt: cutoff } }, select: { key: true }, orderBy: { expiresAt: "asc" }, take: 100 });
        if (stale.length) await tx.adminLoginRateLimit.deleteMany({ where: { key: { in: stale.map(row => row.key) }, expiresAt: { lt: cutoff } } });
        return { allowed: true as const };
      }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if ((code === "P2034" || code === "P2002") && attempt < 3) continue;
      // Do not propagate SQL parameters, connection strings or bucket identifiers.
      throw new LoginProtectionUnavailable();
    }
  }
  throw new LoginProtectionUnavailable();
}
