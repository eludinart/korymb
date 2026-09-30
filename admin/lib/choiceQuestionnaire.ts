/** Questionnaire à choix (QCM) — chat, missions, Décisions. */

export type ChoiceOption = {
  id: string;
  label: string;
};

export type ChoiceQuestion = {
  id: string;
  prompt: string;
  /** multi = cases ; single = radio ; text = libre (fallback). */
  selection: "multi" | "single" | "text";
  options: ChoiceOption[];
  required?: boolean;
};

export type ChoiceQuestionnairePayload = {
  title?: string;
  questions: ChoiceQuestion[];
  commentLabel?: string;
  commentRequired?: boolean;
  submitLabel?: string;
};

export type ChoiceAnswerPayload = {
  answers: Array<{ questionId: string; prompt: string; selected: string[] }>;
  comment: string;
};

const FENCE_RE = /```korymb-qcm\s*\n([\s\S]*?)```/i;
const FENCE_RE_G = /```korymb-qcm\s*\n([\s\S]*?)```/gi;

function slugId(raw: string, fallback: string): string {
  const s = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return s || fallback;
}

function normalizeOption(raw: unknown, index: number): ChoiceOption | null {
  if (typeof raw === "string") {
    const label = raw.trim();
    if (!label) return null;
    return { id: slugId(label, `opt-${index + 1}`), label };
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = String(o.label || o.text || o.title || o.value || "").trim();
  if (!label) return null;
  const id = String(o.id || o.key || slugId(label, `opt-${index + 1}`)).trim() || `opt-${index + 1}`;
  return { id, label };
}

/** Multi « autres / optionnel » : zéro case cochée = réponse valide. */
function looksOptionalPrompt(prompt: string): boolean {
  return /\b(autre|autres|optionnel|optionnelle|facultatif|facultative|si besoin|en plus|bonus)\b/i.test(
    prompt,
  );
}

function normalizeQuestion(raw: unknown, index: number): ChoiceQuestion | null {
  if (typeof raw === "string") {
    const prompt = raw.trim();
    if (!prompt) return null;
    return {
      id: slugId(prompt, `q-${index + 1}`),
      prompt,
      selection: "text",
      options: [],
      required: true,
    };
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const prompt = String(o.prompt || o.question || o.title || o.label || "").trim();
  if (!prompt) return null;
  const rawOpts = Array.isArray(o.options) ? o.options : Array.isArray(o.choices) ? o.choices : [];
  const options = rawOpts
    .map((opt, i) => normalizeOption(opt, i))
    .filter((x): x is ChoiceOption => Boolean(x));
  let selection: ChoiceQuestion["selection"] = "text";
  const sel = String(o.selection || o.mode || o.type || "").toLowerCase();
  if (options.length) {
    if (sel === "single" || sel === "radio" || sel === "one") selection = "single";
    else selection = "multi";
  } else if (sel === "text" || sel === "free") {
    selection = "text";
  }
  const id = String(o.id || o.key || slugId(prompt, `q-${index + 1}`)).trim() || `q-${index + 1}`;
  let required = true;
  if (typeof o.required === "boolean") {
    required = o.required;
  } else if (selection === "multi" && looksOptionalPrompt(prompt)) {
    required = false;
  }
  return {
    id,
    prompt,
    selection,
    options,
    required,
  };
}

/** Normalise un payload JSON (objet ou tableau de questions). */
export function normalizeChoiceQuestionnaire(raw: unknown): ChoiceQuestionnairePayload | null {
  if (!raw) return null;
  let obj: Record<string, unknown>;
  if (Array.isArray(raw)) {
    obj = { questions: raw };
  } else if (typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  } else {
    return null;
  }
  const list = Array.isArray(obj.questions)
    ? obj.questions
    : Array.isArray(obj.items)
      ? obj.items
      : Array.isArray(obj.qcm)
        ? obj.qcm
        : null;
  if (!list?.length) return null;
  const questions = list
    .map((q, i) => normalizeQuestion(q, i))
    .filter((q): q is ChoiceQuestion => Boolean(q))
    .slice(0, 8);
  if (!questions.length) return null;
  return {
    title: String(obj.title || obj.heading || "").trim() || undefined,
    questions,
    commentLabel: String(obj.comment_label || obj.commentLabel || "Commentaire (optionnel)").trim(),
    commentRequired: Boolean(obj.comment_required || obj.commentRequired),
    submitLabel: String(obj.submit_label || obj.submitLabel || "Valider et envoyer").trim(),
  };
}

/** Extrait le premier bloc ```korymb-qcm … ``` d'un message agent. */
export function parseChoiceQuestionnaireFromText(text: string): ChoiceQuestionnairePayload | null {
  const m = String(text || "").match(FENCE_RE);
  if (!m?.[1]) return null;
  try {
    const parsed = JSON.parse(m[1].trim()) as unknown;
    return normalizeChoiceQuestionnaire(parsed);
  } catch {
    return null;
  }
}

/** Retire les fences QCM du markdown affiché (le formulaire les remplace). */
export function stripChoiceQuestionnaireFences(text: string): string {
  return String(text || "")
    .replace(FENCE_RE_G, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatChoiceAnswersAsMessage(
  payload: ChoiceQuestionnairePayload,
  answers: ChoiceAnswerPayload,
): string {
  const lines: string[] = ["[Réponses QCM]"];
  if (payload.title) lines.push(`Sujet : ${payload.title}`);
  for (const row of answers.answers) {
    const selected = row.selected.length ? row.selected.join(", ") : "(aucun choix)";
    lines.push(`- ${row.prompt} → ${selected}`);
  }
  const comment = answers.comment.trim();
  if (comment) {
    lines.push("", `Commentaire : ${comment}`);
  }
  return lines.join("\n");
}

/** Pour CIO / inbox : spécifications optionnelles indexées par libellé de question. */
export type QuestionSpecMap = Record<
  string,
  { selection: ChoiceQuestion["selection"]; options: ChoiceOption[] }
>;

export function specsFromQuestionItems(items: unknown[]): {
  prompts: string[];
  specs: QuestionSpecMap;
} {
  const prompts: string[] = [];
  const specs: QuestionSpecMap = {};
  items.forEach((raw, i) => {
    const q = normalizeQuestion(raw, i);
    if (!q) return;
    if (!prompts.includes(q.prompt)) prompts.push(q.prompt);
    if (q.options.length) {
      specs[q.prompt] = { selection: q.selection === "text" ? "multi" : q.selection, options: q.options };
    }
  });
  return { prompts, specs };
}
