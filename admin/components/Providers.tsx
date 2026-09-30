"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient";
import { ColorSchemeProvider } from "./ColorSchemeProvider";
import PwaRegister from "./PwaRegister";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ColorSchemeProvider>
        <PwaRegister />
        {children}
      </ColorSchemeProvider>
    </QueryClientProvider>
  );
}
