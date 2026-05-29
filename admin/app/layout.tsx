import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "../components/Providers";
import AppNav from "../components/AppNav";
import GlobalStatusBar from "../components/GlobalStatusBar";
import RuntimeHeader from "../components/RuntimeHeader";
import NotificationBell from "../components/director/NotificationBell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Korymb Next",
  description: "Front unifie Next.js",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased text-slate-900`}>
        <Providers>
          <header className="app-header-bar">
            <div className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-5 lg:px-6 xl:px-8">
              <div className="min-w-0 flex-1">
                <p className="app-brand">Korymb</p>
                <RuntimeHeader />
              </div>
              <NotificationBell />
              <AppNav />
            </div>
            <div className="app-status-strip">
              <div className="w-full min-w-0 px-3 py-2.5 sm:px-5 sm:py-3 lg:px-6 xl:px-8">
                <GlobalStatusBar />
              </div>
            </div>
          </header>
          <main className="w-full min-w-0 px-3 py-4 pb-safe sm:px-5 sm:py-6 lg:px-6 lg:py-8 xl:px-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
