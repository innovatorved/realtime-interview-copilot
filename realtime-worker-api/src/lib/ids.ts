/** Shared id-shape validators. Both regexes are intentionally identical
 *  in shape (alphanumeric + `-_`, 1..128 chars) but kept as separate
 *  named exports so any future divergence does not silently break callers. */

export const SAFE_SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export const SAFE_RESOURCE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
