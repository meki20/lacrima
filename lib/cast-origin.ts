/** Google's default Cast receiver is hosted on these origins. */
export function castOrigin(req: Request): string | null {
  const raw = req.headers.get("origin");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.origin !== raw) return null;
    const host = url.hostname.toLowerCase();
    return host === "www.gstatic.com" || host.endsWith(".apps.googleusercontent.com") ? raw : null;
  } catch {
    return null;
  }
}
