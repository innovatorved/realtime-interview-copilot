"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Loader2 } from "lucide-react";
import { sendGTMEvent } from "@next/third-parties/google";

interface AuthWizardProps {
  initialStep?: "welcome" | "signup" | "signin";
  onSuccess?: () => void;
}

export function AuthWizard({
  initialStep = "welcome",
  onSuccess,
}: AuthWizardProps) {
  const [step, setStep] = useState<"welcome" | "signup" | "signin">(
    initialStep,
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalMessage, setModalMessage] = useState("");

  const router = useRouter();

  const showModal = (title: string, message: string) => {
    setModalTitle(title);
    setModalMessage(message);
    setModalOpen(true);
  };

  const handleSuccess = () => {
    if (onSuccess) {
      onSuccess();
    } else {
      router.push("/");
    }
  };

  const handleSignup = async () => {
    if (!email || !password || !name) {
      showModal("Error", "Please fill in all fields.");
      return;
    }
    setLoading(true);
    try {
      await authClient.signUp.email(
        {
          email,
          password,
          name,
        },
        {
          onSuccess: () => {
            console.log("Signup successful");
            sendGTMEvent({ event: "signup", value: "email" });
            showModal(
              "Success",
              "Account created successfully! Redirecting...",
            );
            setTimeout(() => handleSuccess(), 1500);
          },
          onError: (ctx) => {
            console.error("Signup error context:", ctx);
            sendGTMEvent({ event: "signup_error", error: ctx.error.message });
            showModal("Sign Up Failed", ctx.error.message);
            setLoading(false);
          },
        },
      );
    } catch (e: any) {
      console.error("Signup exception:", e);
      showModal("Error", e.message || "An unexpected error occurred");
      setLoading(false);
    }
  };

  const handleSignin = async () => {
    if (!email || !password) {
      showModal("Error", "Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      await authClient.signIn.email(
        {
          email,
          password,
        },
        {
          onSuccess: () => {
            console.log("Signin successful");
            sendGTMEvent({ event: "login", value: "email" });
            // Optional: Show success modal or just redirect
            handleSuccess();
          },
          onError: (ctx) => {
            console.error("Signin error context:", ctx);
            sendGTMEvent({ event: "login_error", error: ctx.error.message });
            showModal("Sign In Failed", ctx.error.message);
            setLoading(false);
          },
        },
      );
    } catch (e: any) {
      console.error("Signin exception:", e);
      showModal("Error", e.message || "An unexpected error occurred");
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-black/90">
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalTitle}
      >
        <p className="text-gray-300">{modalMessage}</p>
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => setModalOpen(false)}
            className="bg-gray-700 hover:bg-gray-600 text-white"
          >
            Close
          </Button>
        </div>
      </Modal>

      <Card className="w-[400px] border-gray-600/50 bg-gray-900/60 backdrop-blur-md shadow-2xl animate-in fade-in zoom-in-95 duration-500">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            {step === "welcome" && "Welcome Back"}
            {step === "signup" && "Create Account"}
            {step === "signin" && "Sign In"}
          </CardTitle>
          <CardDescription className="text-gray-400 text-xs">
            {step === "welcome" && "Choose how you want to continue"}
            {step === "signup" &&
              "Enter your details below to create your account"}
            {step === "signin" &&
              "Enter your email below to login to your account"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {step === "welcome" && (
            <div className="grid gap-4 animate-in slide-in-from-left-4 duration-300">
              <Button
                className="w-full bg-green-600 hover:bg-green-700 text-white transition-all font-semibold"
                onClick={() => setStep("signup")}
              >
                Create Account
              </Button>
              <Button
                variant="outline"
                className="w-full border-gray-600/50 bg-transparent text-gray-300 hover:bg-gray-800 hover:text-white transition-all"
                onClick={() => setStep("signin")}
              >
                Sign In
              </Button>
            </div>
          )}

          {step === "signup" && (
            <div className="grid gap-4 animate-in slide-in-from-right-4 duration-300">
              <div className="grid gap-2">
                <Label htmlFor="name" className="text-gray-300">
                  Name
                </Label>
                <Input
                  id="name"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-gray-800/50 border-gray-600/50 text-white placeholder:text-gray-500 focus:border-green-500/50 transition-all"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email" className="text-gray-300">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-gray-800/50 border-gray-600/50 text-white placeholder:text-gray-500 focus:border-green-500/50 transition-all"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password" className="text-gray-300">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-gray-800/50 border-gray-600/50 text-white placeholder:text-gray-500 focus:border-green-500/50 transition-all"
                />
              </div>
              <div className="text-xs text-center text-gray-400">
                Already have an account?{" "}
                <button
                  className="text-green-400 hover:text-green-300 hover:underline transition-colors pointer"
                  onClick={() => setStep("signin")}
                >
                  Sign In
                </button>
              </div>
            </div>
          )}

          {step === "signin" && (
            <div className="grid gap-4 animate-in slide-in-from-right-4 duration-300">
              <div className="grid gap-2">
                <Label htmlFor="email" className="text-gray-300">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-gray-800/50 border-gray-600/50 text-white placeholder:text-gray-500 focus:border-green-500/50 transition-all"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password" className="text-gray-300">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-gray-800/50 border-gray-600/50 text-white placeholder:text-gray-500 focus:border-green-500/50 transition-all"
                />
              </div>
              <div className="text-xs text-center text-gray-400">
                Don&apos;t have an account?{" "}
                <button
                  className="text-green-400 hover:text-green-300 hover:underline transition-colors pointer"
                  onClick={() => setStep("signup")}
                >
                  Create Account
                </button>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between border-t border-gray-700/30 pt-4">
          {step !== "welcome" && (
            <Button
              variant="ghost"
              onClick={() => setStep("welcome")}
              className="text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
            >
              Back
            </Button>
          )}
          {step === "signup" && (
            <Button
              onClick={handleSignup}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700 text-white border-0 transition-all duration-300 shadow-lg shadow-green-900/20 font-semibold"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {loading ? "Creating..." : "Sign Up"}
            </Button>
          )}
          {step === "signin" && (
            <Button
              onClick={handleSignin}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700 text-white border-0 transition-all duration-300 shadow-lg shadow-green-900/20 font-semibold"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {loading ? "Signing In..." : "Sign In"}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
