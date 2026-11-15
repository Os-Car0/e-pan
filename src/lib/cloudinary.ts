// Server-only upload authorization. Never import this module into a client component.
import { createHash, randomUUID } from "node:crypto";

export function createImageUploadAuthorization() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !/^[a-zA-Z0-9_-]+$/.test(cloudName) || !apiKey || !apiSecret) return null;

  const parameters: Record<string, string> = {
    allowed_formats: "jpg,jpeg,png,gif,webp,avif,bmp,tiff,heic,heif",
    overwrite: "false",
    public_id: `e-pan/${randomUUID()}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  // https://cloudinary.com/documentation/authentication_signatures
  const payload = Object.keys(parameters).sort().map(key => `${key}=${parameters[key]}`).join("&");
  const signature = createHash("sha256").update(payload + apiSecret).digest("hex");
  const fields: Record<string, string> = { ...parameters, api_key: apiKey, signature };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    deliveryPrefix: `https://res.cloudinary.com/${cloudName}/image/upload/`,
    fields,
  };
}
