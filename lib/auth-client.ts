import { createAuthClient } from "better-auth/react";
import { BACKEND_API_URL } from "./constant";

export const authClient = createAuthClient({
  baseURL: `${BACKEND_API_URL}/api/auth`,
  trustedOrigins: [
    "null",
    "file://",
    "http://localhost:3000",
    "https://realtime-worker-api-prod.vedgupta.in",
  ],
});

export async function signOutAndTrack(): Promise<void> {
  try {
    await authClient.signOut();
  } catch {
    /* ignore sign-out network errors */
  } finally {
    window.dispatchEvent(new Event("auth:logout"));
  }
}
