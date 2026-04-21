import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

export const QK = {
  llm: ["llm"],
  tokens: ["tokens"],
  health: ["health"],
  agents: ["agents"],
  jobs: ["jobs"],
  missionSessions: ["mission-sessions"],
  adminSettings: ["admin-settings"],
  adminAgents: ["admin-agents-definitions"],
};
