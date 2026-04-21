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
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
              <div>
                <p className="text-xl font-bold tracking-tight">Korymb Next</p>
                <RuntimeHeader />
              </div>
              <AppNav />
            </div>
            <div className="border-t border-slate-100 bg-slate-50/90">
              <div className="mx-auto max-w-6xl px-6 py-3">
                <GlobalStatusBar />
              </div>
            </div>
          </header>
          <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
