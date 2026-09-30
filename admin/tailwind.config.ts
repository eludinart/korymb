import type { Config } from "tailwindcss";

/**
 * dark: lié à data-color-scheme (vérité produit), pas à l’OS.
 * Évite le piège prefers-color-scheme qui peignait des blocs noirs en mode Clair.
 */
const config: Config = {
  darkMode: ["selector", '[data-color-scheme="dark"]'],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [],
};

export default config;
