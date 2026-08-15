import { createAuthClient } from "better-auth/react";
import { sendGTMEvent } from "@next/third-parties/google";
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
  const dispatchLogout = () => window.dispatchEvent(new Event("auth:logout"));
  try {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          sendGTMEvent({ event: "logout" });
          dispatchLogout();
        },
      },
    });
    dispatchLogout();
  } catch {
    dispatchLogout();
  }
}
