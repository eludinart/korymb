import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { expect, test } from "@playwright/test";
import { normalizeLooseMarkdown } from "../lib/normalizeLooseMarkdown";
import { sortTasks } from "../lib/taskSort";
import type { BizWorkTask } from "../lib/business";

test("une note sur plusieurs lignes s'affiche en entier", () => {
  const note = "Première ligne\nDeuxième ligne";
  const component = readFileSync("components/director/TaskNotes.tsx", "utf8");
  expect(component).toContain("AgentMessageMarkdown");
  expect(component).toContain('className="text-sm');
  const html = renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkBreaks],
      children: normalizeLooseMarkdown(note),
    }),
  );
  expect(html).toContain("Première ligne");
  expect(html).toContain("Deuxième ligne");
  expect(html).toMatch(/<br\s*\/?>/);
});

test("le tri par défaut met l'urgence avant le retard", () => {
  const tasks = [
    task({ id: "late", title: "En retard", due_at: "2026-10-20", urgent: false, created_at: "2026-10-01T00:00:00" }),
    task({ id: "hot", title: "Urgent", due_at: "2026-10-25", urgent: true, priority: "P1", created_at: "2026-10-19T00:00:00" }),
  ];
  expect(sortTasks(tasks, "urgent-overdue", "2026-10-21").map((item) => item.id)).toEqual(["hot", "late"]);
  expect(sortTasks(tasks, "created", "2026-10-21").map((item) => item.id)).toEqual(["hot", "late"]);
  expect(sortTasks(tasks, "overdue", "2026-10-21").map((item) => item.id)).toEqual(["late", "hot"]);
  expect(sortTasks(tasks, "priority", "2026-10-21").map((item) => item.id)).toEqual(["hot", "late"]);
});

function task(partial: Partial<BizWorkTask> & Pick<BizWorkTask, "id" | "title">): BizWorkTask {
  return {
    project_id: null,
    status: "open",
    due_at: null,
    priority: "",
    urgent: false,
    notes: "",
    assignee: "",
    calendar_event_id: "",
    created_at: "2026-10-01T00:00:00",
    updated_at: "2026-10-01T00:00:00",
    ...partial,
  };
}
