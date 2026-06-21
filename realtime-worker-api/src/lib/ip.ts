/** Resolve the candidate client IP from request headers. */
export function getClientIpFromHeaders(
  headers: Headers | undefined,
): string | null {
  if (!headers) return null;
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

/** Resolve the candidate client IP for a request. */
export function getClientIp(request: Request): string {
  return getClientIpFromHeaders(request.headers) ?? "unknown";
}
