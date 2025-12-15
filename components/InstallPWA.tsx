"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui/button";

export function InstallPWA() {
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    setIsIOS(
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream,
    );
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to the install prompt: ${outcome}`);
      setDeferredPrompt(null);
    }
  };

  if (isStandalone) {
    return null; // Already installed
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {deferredPrompt && (
        <Button
          onClick={handleInstallClick}
          className="bg-[#2f855a] hover:bg-[#276749] text-white shadow-lg"
        >
          Install App
        </Button>
      )}
      {isIOS && !isStandalone && (
        <div className="bg-[#2f855a] text-white p-4 rounded-lg shadow-lg max-w-sm">
          <p className="text-sm">
            To install this app on your iOS device, tap the share button{" "}
            <span role="img" aria-label="share icon">
              ⎋
            </span>{" "}
            and then &quot;Add to Home Screen&quot;{" "}
            <span role="img" aria-label="plus icon">
              ➕
            </span>
            .
          </p>
        </div>
      )}
    </div>
  );
}
