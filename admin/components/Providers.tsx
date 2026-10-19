"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient";
import { ActionToastProvider } from "../lib/actionToast";
import { UndoRibbonProvider } from "../lib/undoRibbon";
import { ColorSchemeProvider } from "./ColorSchemeProvider";
import PwaRegister from "./PwaRegister";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ColorSchemeProvider>
        <ActionToastProvider>
          <UndoRibbonProvider>
            <PwaRegister />
            {children}
          </UndoRibbonProvider>
        </ActionToastProvider>
      </ColorSchemeProvider>
    </QueryClientProvider>
  );
}
