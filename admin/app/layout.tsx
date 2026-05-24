import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "../components/Providers";
import AppNav from "../components/AppNav";
import GlobalStatusBar from "../components/GlobalStatusBar";
import RuntimeHeader from "../components/RuntimeHeader";

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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-50 text-slate-900`}
      >
        <Providers>
          <header className="sticky top-0 z-20 w-full min-w-0 border-b border-slate-200 bg-white shadow-sm pt-safe">
            <div className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3 lg:px-6 xl:px-8">
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold tracking-tight sm:text-xl">Korymb Next</p>
                <RuntimeHeader />
              </div>
              <AppNav />
            </div>
            <div className="w-full min-w-0 border-t border-slate-100 bg-slate-50/90">
              <div className="w-full min-w-0 px-3 py-2 sm:px-5 sm:py-3 lg:px-6 xl:px-8">
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
