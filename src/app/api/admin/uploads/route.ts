import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { createImageUploadAuthorization } from "@/lib/cloudinary";
import { imageUploadMimeTypes, maxImageUploadBytes } from "@/lib/image-upload";

export const runtime = "nodejs";

const input = z.object({
  type: z.enum(imageUploadMimeTypes),
  size: z.number().int().min(1).max(maxImageUploadBytes),
});

export async function POST(request: Request) {
  let staff;
  try { staff = await requireStaff(); }
  catch { return NextResponse.json({ error: "No se pudo verificar la sesión administrativa." }, { status: 503 }); }
  if (!staff) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (!input.safeParse(raw).success)
    return NextResponse.json({ error: "Selecciona una imagen compatible de hasta 10 MB." }, { status: 400 });

  const authorization = createImageUploadAuthorization();
  if (!authorization)
    return NextResponse.json({ error: "La carga de imágenes no está configurada." }, { status: 503 });

  // Only metadata passes through this function. The actual image is uploaded
  // directly by the browser, preserving the 10 MB limit on serverless hosts.
  return NextResponse.json(authorization, { headers: { "Cache-Control": "no-store" } });
}
