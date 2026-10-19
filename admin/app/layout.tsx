import type { Metadata } from "next";
import "./globals.css";
import "./theme-contrast.css";
import Providers from "../components/Providers";
import LayoutSwitch from "../components/LayoutSwitch";

/** Boot anti-flash — synchrone avec admin/lib/colorScheme.ts (STORAGE_KEY). */
const COLOR_SCHEME_BOOT =
  '(function(){try{var s=localStorage.getItem("korymb-color-scheme-v1");var dark=s==="dark";var r=document.documentElement;if(dark)r.classList.add("dark");else r.classList.remove("dark");r.dataset.colorScheme=dark?"dark":"light";r.style.colorScheme=dark?"dark":"light"}catch(e){}})();';

export const metadata: Metadata = {
  title: "Korymb",
  description: "Pilotez votre activité avec missions IA, briefing et livrables.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Korymb",
    statusBarStyle: "default",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  interactiveWidget: "resizes-content" as const,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2ff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: COLOR_SCHEME_BOOT }} />
      </head>
      <body className="antialiased text-slate-900 dark:text-slate-100">
        <Providers>
          <LayoutSwitch>{children}</LayoutSwitch>
        </Providers>
      </body>
    </html>
  );
}
