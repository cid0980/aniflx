import type { Metadata } from "next";
import type { ReactNode } from "react";
import PwaInstall from "@/components/PwaInstall";
import "./globals.css";

/**
 * To change the app name:
 *   Update `title` and `applicationName` below.
 *   Also update `name` / `short_name` in src/app/manifest.ts
 *   And the header text in src/app/page.tsx
 *
 * To change the icon:
 *   Replace public/icon-192.png (192×192) and public/icon-512.png (512×512)
 */
export const metadata: Metadata = {
  title: "Cid's Anime",
  description: "Personal anime streaming app for Cid.",
  manifest: "/manifest.webmanifest",
  applicationName: "Cid's Anime",
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
  other: {
    'theme-color': '#0a0a0f',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Cid's Anime",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <div className="fixed right-3 top-3 z-[100] sm:right-4 sm:top-4">
          <PwaInstall />
        </div>
        {children}
      </body>
    </html>
  );
}
