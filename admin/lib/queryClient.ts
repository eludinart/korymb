import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
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
  jobsCards: ["jobs-cards"],
  jobsLight: ["jobs-light"],
  missionSessions: ["mission-sessions"],
  adminSettings: ["admin-settings"],
  adminAgents: ["admin-agents-definitions"],
};
