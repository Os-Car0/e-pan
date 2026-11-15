import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { issueSession } from "@/lib/auth";
import { hasDatabaseUrl, databaseSetupMessage } from "@/lib/db-config";
import { reserveAdminLoginAttempt } from "@/lib/admin-login-rate-limit-store";

export const runtime = "nodejs";
const schema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });
// Public dummy hash, generated independently of every real user's credentials.
// Unknown accounts and non-staff roles still perform one cost-12 bcrypt check.
const dummyPasswordHash = "$2b$12$qkYZ8Hb8qG20b4trPGLP3eMBLNcNHOZTCI19T9HOK7v7EbXjFIP.e";
const json = (body: object, status: number, extraHeaders: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...extraHeaders } });

export async function POST(req: Request) {
  if (!hasDatabaseUrl()) return json({ error: databaseSetupMessage }, 503);
  let raw: unknown;
  try { raw = await req.json(); }
  catch { return json({ error: "JSON inválido" }, 400); }
  const input = schema.safeParse(raw);
  if (!input.success) return json({ error: "Credenciales inválidas" }, 400);
  try {
    const email = input.data.email.toLowerCase();
    const limit = await reserveAdminLoginAttempt(req.headers, email);
    if (!limit.allowed) return json({ error: "Demasiados intentos. Espera antes de volver a intentarlo." }, 429, { "Retry-After": String(limit.retryAfterSeconds) });
    const user = await db.user.findUnique({ where: { email }, select: { id: true, role: true, passwordHash: true } });
    const staff = user && (user.role === "ADMIN" || user.role === "BAKER");
    const matches = await bcrypt.compare(input.data.password, staff ? user.passwordHash : dummyPasswordHash);
    if (!staff || !matches) return json({ error: "Credenciales inválidas" }, 401);
    const token = await issueSession(user.id, user.role), response = json({ ok: true }, 200);
    response.cookies.set("epan_session", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 28800 });
    return response;
  } catch {
    console.error("admin_login_unavailable");
    return json({ error: "No se pudo verificar el acceso. Inténtalo más tarde." }, 503);
  }
}
