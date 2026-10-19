import type { Job } from "./types";

export type ProjectMissionLink = {
  id: string;
  title: string;
  jobIds?: string[] | null;
};

export type ResolvedMissionProject = {
  key: string;
  title: string;
  href?: string;
};

export type MissionListEntry =
  | { kind: "job"; job: Job }
  | { kind: "project"; key: string; title: string; href?: string; jobs: Job[] };

const TITLE_SEP = " — ";

export function foldProjectTitle(value: string): string {
  return value.trim().toLocaleLowerCase("fr").replace(/\s+/g, " ");
}

/** Première ligne de consigne, avant le détail et le contexte projet. */
export function missionHeadline(mission?: string | null): string {
  const raw = String(mission || "").replace(/\r\n/g, "\n").trim();
  return raw.split("\n").map((line) => line.trim()).find(Boolean) || "";
}

/** « Tâche — Projet » sur la première ligne. Le tiret du titre projet (–) n'est pas le séparateur. */
export function splitMissionProjectTitle(mission?: string | null): { task: string; projectHint: string } {
  const line = missionHeadline(mission);
  const at = line.indexOf(TITLE_SEP);
  if (at <= 0) return { task: line, projectHint: "" };
  return {
    task: line.slice(0, at).trim(),
    projectHint: line.slice(at + TITLE_SEP.length).trim(),
  };
}

function projectHref(id: string): string {
  return `/gestion/projets/${encodeURIComponent(id)}`;
}

function titleMatch(hint: string, projects: ProjectMissionLink[]): ProjectMissionLink | undefined {
  const folded = foldProjectTitle(hint);
  if (!folded) return undefined;
  return projects.find((project) => {
    const title = foldProjectTitle(project.title || "");
    if (!title) return false;
    return folded === title || folded.startsWith(`${title} `);
  });
}

/** Projet CRM d'une mission : id en config, missions liées, sinon le titre dans la consigne. */
export function resolveMissionProject(
  job: Pick<Job, "job_id" | "mission" | "mission_config">,
  projects: ProjectMissionLink[],
): ResolvedMissionProject | null {
  const hint = splitMissionProjectTitle(job.mission).projectHint;
  const configured = String(job.mission_config?.project_id || "").trim();
  if (configured) {
    const known = projects.find((project) => project.id === configured);
    return {
      key: configured,
      title: known?.title?.trim() || hint || "Projet",
      href: projectHref(configured),
    };
  }
  const linked = projects.find((project) => (project.jobIds || []).includes(job.job_id));
  if (linked?.id) {
    return {
      key: linked.id,
      title: linked.title?.trim() || hint || "Projet",
      href: projectHref(linked.id),
    };
  }
  if (!hint) return null;
  const byTitle = titleMatch(hint, projects);
  if (byTitle?.id) {
    return { key: byTitle.id, title: byTitle.title.trim(), href: projectHref(byTitle.id) };
  }
  return { key: `title:${foldProjectTitle(hint)}`, title: hint };
}

/**
 * Regroupe les missions d'un même projet (2 ou plus) à la place de la première.
 * L'ordre relatif du tri dirigeant est conservé. Une mission seule reste une carte.
 */
export function groupMissionsByProject(jobs: Job[], projects: ProjectMissionLink[]): MissionListEntry[] {
  const resolved = jobs.map((job) => ({ job, project: resolveMissionProject(job, projects) }));
  const counts = new Map<string, number>();
  for (const row of resolved) {
    if (!row.project) continue;
    counts.set(row.project.key, (counts.get(row.project.key) || 0) + 1);
  }
  const emitted = new Set<string>();
  const out: MissionListEntry[] = [];
  for (const row of resolved) {
    const project = row.project;
    if (!project || (counts.get(project.key) || 0) < 2) {
      out.push({ kind: "job", job: row.job });
      continue;
    }
    if (emitted.has(project.key)) continue;
    emitted.add(project.key);
    out.push({
      kind: "project",
      key: project.key,
      title: project.title,
      href: project.href,
      jobs: resolved.filter((item) => item.project?.key === project.key).map((item) => item.job),
    });
  }
  return out;
}

/** Intitulé de tâche quand la mission est déjà sous l'en-tête de son projet. */
export function missionTaskTitle(mission: string | null | undefined, projectTitle: string): string {
  const split = splitMissionProjectTitle(mission);
  if (!split.task || !split.projectHint) return "";
  const hint = foldProjectTitle(split.projectHint);
  const wanted = foldProjectTitle(projectTitle);
  if (!wanted || hint === wanted || hint.startsWith(`${wanted} `)) return split.task;
  return "";
}
