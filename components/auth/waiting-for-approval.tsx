"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";

export function WaitingForApproval({ email }: { email?: string }) {
  const router = useRouter();

  const handleCheckStatus = () => {
    // Capture approval status check event with PostHog
    posthog.capture("approval_status_checked", {
      email: email,
    });
    // Reloading the page will trigger the AuthGuard to re-fetch the session
    window.location.reload();
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4">
      <Card className="w-full max-w-md border-gray-700 bg-gray-800/50 backdrop-blur-xl shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 ring-1 ring-green-500/20">
            <Lock className="h-6 w-6 text-green-400" />
          </div>
          <CardTitle className="text-xl font-bold text-white tracking-tight">
            Access Pending
          </CardTitle>
          <CardDescription className="text-gray-400 text-sm mt-1">
            Your account is waiting for administrator approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="rounded-xl bg-green-500/5 border border-green-500/10 p-4 text-sm text-green-200/80 text-center leading-relaxed">
            <p>
              We&apos;ve sent your request to the admin for{" "}
              <strong className="text-green-300">{email}</strong>. Please check
              back later or contact support if this persists.
            </p>
          </div>

          <Button
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white text-sm font-medium h-10 shadow-lg shadow-green-500/20 transition-all duration-200"
            onClick={handleCheckStatus}
          >
            Check Status
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
