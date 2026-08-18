import type { Metadata } from "next";
import type { ReactNode } from "react";
import PwaInstall from "@/components/PwaInstall";
import GateWrapper from "@/components/GateWrapper";
import "./globals.css";

export const metadata: Metadata = {
  title: "AniFlix",
  description: "Personal anime streaming app for Cid.",
  manifest: "/manifest.webmanifest",
  applicationName: "AniFlix",
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
  other: {
    'theme-color': '#08080e',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AniFlix",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <GateWrapper>
          <div className="fixed right-3 top-3 z-[100] sm:right-4 sm:top-4">
            <PwaInstall />
          </div>
          {children}
        </GateWrapper>
      </body>
    </html>
  );
}
