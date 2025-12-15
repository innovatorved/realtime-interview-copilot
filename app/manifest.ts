import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Realtime Interview Copilot",
    short_name: "Interview Copilot",
    description:
      "Get Interview Answers Realtime - Your AI-powered interview assistant",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2f855a",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
      {
        src: "/icons/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/icons/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    categories: ["productivity", "education", "business"],
  };
}
