import { createAuthClient } from "better-auth/react";
import { BACKEND_API_URL } from "./constant";

export const authClient = createAuthClient({
  baseURL: `${BACKEND_API_URL}/api/auth`,
  trustedOrigins: [
    "http://localhost:3000",
    "https://realtime-worker-api-prod.vedgupta.in",
  ],
});
