/** Shared HTTP helpers — JSON response factory and the byte encoder
 *  used by streaming routes. */

export const jsonHeaders = {
  "content-type": "application/json",
};

export const encoder = new TextEncoder();

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}
