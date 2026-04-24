"use client";

import { AssistantView } from "@/components/AssistantView";
import { AuthGuard } from "@/components/auth/auth-guard";

export default function AssistantPage() {
  return (
    <AuthGuard>
      <div className="h-screen w-screen overflow-hidden bg-transparent">
        <AssistantView />
      </div>
    </AuthGuard>
  );
}
