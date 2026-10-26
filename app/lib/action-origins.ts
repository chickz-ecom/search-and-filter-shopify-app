// Tunnel/reverse proxy chấm dứt TLS rồi chuyển http vào app → request.url là http:// trong khi header Origin của
// trình duyệt là https:// → React Router coi là CSRF và chặn mọi action (400 "Bad Request", vd. nút Sync now).
// Cho phép đúng hostname của app (SHOPIFY_APP_URL); origin lạ vẫn bị chặn.
export function allowedActionOrigins(appUrl: string | undefined): string[] {
  if (!appUrl) return [];
  try {
    const { hostname } = new URL(appUrl);
    return hostname === "localhost" ? [] : [hostname];
  } catch {
    return [];
  }
}
