"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient";
import { ColorSchemeProvider } from "./ColorSchemeProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ColorSchemeProvider>{children}</ColorSchemeProvider>
    </QueryClientProvider>
  );
}
