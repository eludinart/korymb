import type { Metadata } from "next";
import "./globals.css";
import Providers from "../components/Providers";
import LayoutSwitch from "../components/LayoutSwitch";

export const metadata: Metadata = {
  title: "Korymb — Cockpit agentique",
  description: "Pilotez votre activité avec missions IA, briefing et livrables.",
  manifest: "/manifest.json",
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased text-slate-900">
        <Providers>
          <LayoutSwitch>{children}</LayoutSwitch>
        </Providers>
      </body>
    </html>
  );
}
