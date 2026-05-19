/**
 * Better Auth often leaves `name` empty for email-first accounts. Every
 * surface that greets the user should fall back to email so nothing
 * renders blank or misleading.
 */
export type SessionUserLike = {
  name?: string | null;
  email?: string | null;
};

export function sessionDisplayName(
  user: SessionUserLike | null | undefined,
): string {
  if (!user) return "";
  const name = typeof user.name === "string" ? user.name.trim() : "";
  if (name.length > 0) return name;
  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (email.length > 0) {
    const at = email.indexOf("@");
    return at > 0 ? email.slice(0, at) : email;
  }
  return "Signed in";
}

/** Full email for tooltips when the visible label is a short handle. */
export function sessionUserTitle(
  user: SessionUserLike | null | undefined,
): string {
  if (!user) return "";
  const name = typeof user.name === "string" ? user.name.trim() : "";
  const email = typeof user.email === "string" ? user.email.trim() : "";
  const parts: string[] = [];
  if (name.length > 0) parts.push(name);
  if (email.length > 0 && email !== name) parts.push(email);
  return parts.join(" · ") || sessionDisplayName(user);
}
