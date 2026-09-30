"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient";
import { ActionToastProvider } from "../lib/actionToast";
import { ColorSchemeProvider } from "./ColorSchemeProvider";
import PwaRegister from "./PwaRegister";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ColorSchemeProvider>
        <ActionToastProvider>
          <PwaRegister />
          {children}
        </ActionToastProvider>
      </ColorSchemeProvider>
    </QueryClientProvider>
  );
}
