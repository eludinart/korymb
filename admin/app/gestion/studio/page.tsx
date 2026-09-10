"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import { connectionSetupHref, formatStatus, studioApi, type StudioFormat, type StudioPiece, type StudioRun } from "../../../lib/studio";

const DEFAULT_FORMATS = ["article", "social_instagram"];

export default function StudioPage() {
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ["studio-catalog"],
    queryFn: () => studioApi.catalog(),
    staleTime: 60_000,
  });
  const runs = useQuery({
    queryKey: ["studio-runs"],
    queryFn: () => studioApi.runs(),
    refetchInterval: 8_000,
  });

  const [prompt, setPrompt] = useState("");
  const [formats, setFormats] = useState<string[]>(DEFAULT_FORMATS);
  const [tone, setTone] = useState("invite");
  const [audience, setAudience] = useState("coachs");
  const [cta, setCta] = useState("");
  const [destination, setDestination] = useState("mission");
  const [visibility, setVisibility] = useState("internal");
  const [extra, setExtra] = useState("");
  const [mediaMode, setMediaMode] = useState("");
  const [publishTitle, setPublishTitle] = useState("");
  const [publishType, setPublishType] = useState("document");
  const [publishFileId, setPublishFileId] = useState("");
  const [publishMarkdown, setPublishMarkdown] = useState("");
  const [publishJobId, setPublishJobId] = useState("");

  const groupedFormats = useMemo(() => {
    const items = catalog.data?.formats || [];
    const groups: Record<string, StudioFormat[]> = {};
    for (const item of items) {
      const g = item.group || "autre";
      (groups[g] ||= []).push(item);
    }
    return groups;
  }, [catalog.data]);

  const generate = useMutation({
    mutationFn: () =>
      studioApi.generate({
        prompt,
        formats,
        tone,
        audience,
        cta,
        destination,
        visibility,
        extra,
        require_user_validation: true,
        media_engine_mode: mediaMode || catalog.data?.media?.mode || "economy",
      }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["studio-runs"] });
      if (data.job_id) setPublishJobId(data.job_id);
    },
  });

  const publish = useMutation({
    mutationFn: () =>
      studioApi.publish({
        title: publishTitle,
        resource_type: publishType,
        visibility,
        file_id: publishFileId,
        body_markdown: publishMarkdown,
        job_id: publishJobId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["studio-runs"] });
      setPublishTitle("");
      setPublishFileId("");
      setPublishMarkdown("");
    },
  });

  const toggleFormat = (id: string) => {
    setFormats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const brand = catalog.data?.brand;
  const connections = catalog.data?.connections || [];
  const missingBrand = brand && (!brand.has_global_memory || !brand.has_community_memory);
  const selectedTone = (catalog.data?.tones || []).find((t) => t.id === tone);

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="violet"
        badge="Studio"
        title="Création de contenus"
        description="Un brief, une mission. Quand c’est prêt, vous validez ici : dans l’espace Korymb, ou sur le réseau si le connecteur est branché."
        actions={
          <>
            <Link href="/administration/memory" className="btn-link-secondary">
              Voix de marque
            </Link>
            <Link href="/administration/integrations" className="btn-link-secondary">
              Outils connectés
            </Link>
          </>
        }
      />

      {catalog.isLoading ? <LoadingLine label="Chargement du studio…" /> : null}
      {catalog.isError ? (
        <AlertBox tone="error" title="Studio indisponible">
          Impossible de charger le catalogue. Vérifiez que le backend tourne.
        </AlertBox>
      ) : null}

      {brand ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-violet-800">Marque</p>
            <p className="mt-1 text-base font-bold text-slate-900">{brand.name}</p>
            <p className="text-sm text-slate-600">{brand.tagline || "Accroche vitrine à renseigner"}</p>
          </div>
          <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-violet-800">Mémoire</p>
            <p className="mt-1 text-sm text-slate-700">
              Global {brand.has_global_memory ? "à jour" : "vide"} · Community{" "}
              {brand.has_community_memory ? "à jour" : "vide"}
            </p>
            {missingBrand ? (
              <Link href="/administration/memory" className="mt-2 inline-block text-xs font-semibold text-violet-800 underline">
                Enrichir la voix de marque
              </Link>
            ) : (
              <p className="mt-2 text-xs text-emerald-700">Le studio s’appuie sur votre contexte entreprise.</p>
            )}
          </div>
          <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-violet-800">Outils prêts</p>
            <p className="mt-1 text-sm text-slate-700">
              {connections.filter((c) => c.configured).length}/{connections.length} connectés
            </p>
            <p className="mt-1 text-xs text-slate-500">Les formats grisés fonctionnent en texte ; le fichier réel attend la clé.</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.9fr)]">
        <div className="space-y-5">
          <SectionCard title="Brief">
            <label className="block text-sm font-semibold text-slate-800" htmlFor="studio-prompt">
              De quoi parle-t-on ?
            </label>
            <textarea
              id="studio-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              placeholder="Ex. Ouvrir Agapé comme posture d’accueil, pour les coachs qui démarrent Fleur d’ÅmÔurs — invitation à la soirée de juin, sans promesse divinatoire."
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-slate-600">
                Ton
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                >
                  {(catalog.data?.tones || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Audience
                <select
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                >
                  {(catalog.data?.audiences || []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                CTA (optionnel)
                <input
                  value={cta}
                  onChange={(e) => setCta(e.target.value)}
                  placeholder="Réserver, lire, s’inscrire…"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                />
              </label>
            </div>
            {selectedTone?.hint ? (
              <p className="mt-2 text-xs leading-relaxed text-slate-500">Ton : {selectedTone.hint}</p>
            ) : null}
            <fieldset className="mt-4">
              <legend className="text-xs font-semibold text-slate-600">Moteurs média</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(catalog.data?.media?.modes?.length
                  ? catalog.data.media.modes
                  : [
                      { id: "economy", label: "Économique", hint: "Moteurs gratuits d’abord." },
                      { id: "quality", label: "Qualité publication", hint: "Clés payantes d’abord." },
                    ]
                ).map((mode) => {
                  const current = mediaMode || catalog.data?.media?.mode || "economy";
                  const on = current === mode.id;
                  return (
                    <label
                      key={mode.id}
                      className={`flex cursor-pointer gap-2 rounded-xl border p-3 ${
                        on ? "border-violet-500 bg-violet-50" : "border-slate-200"
                      }`}
                    >
                      <input
                        type="radio"
                        name="media-engine-mode"
                        value={mode.id}
                        checked={on}
                        onChange={() => setMediaMode(mode.id)}
                      />
                      <span>
                        <span className="block text-sm font-semibold text-slate-800">{mode.label}</span>
                        <span className="block text-[11px] leading-snug text-slate-500">{mode.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="mt-3 block text-xs font-semibold text-slate-600">
              Consignes supplémentaires
              <textarea
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                rows={2}
                placeholder="Hashtags à éviter, date à citer, référence à un module…"
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
              />
            </label>
          </SectionCard>

          <SectionCard title="Formats">
            <p className="mb-3 text-sm text-slate-600">Cochez une ou plusieurs pièces. Un pack multi-formats passe par le CIO.</p>
            <div className="space-y-4">
              {Object.entries(groupedFormats).map(([group, items]) => (
                <div key={group}>
                  <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-violet-800">{group}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {items.map((fmt) => {
                      const on = formats.includes(fmt.id);
                      return (
                        <button
                          key={fmt.id}
                          type="button"
                          onClick={() => toggleFormat(fmt.id)}
                          className={`rounded-xl border px-3 py-3 text-left transition ${
                            on
                              ? "border-violet-500 bg-violet-50 shadow-sm"
                              : "border-slate-200 bg-white hover:border-violet-200"
                          }`}
                        >
                          <span className="text-lg" aria-hidden>
                            {fmt.icon}
                          </span>
                          <p className="text-sm font-bold text-slate-900">{fmt.label}</p>
                          <p className="text-[11px] leading-snug text-slate-500">{fmt.description}</p>
                          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {fmt.duration_hint}
                            {!fmt.ready ? " · texte sans fichier tant que l’outil manque" : ""}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Destination">
            <div className="grid gap-2 sm:grid-cols-2">
              {(catalog.data?.destinations || []).map((d) => (
                <label
                  key={d.id}
                  className={`flex cursor-pointer gap-2 rounded-xl border p-3 ${
                    destination === d.id ? "border-violet-500 bg-violet-50" : "border-slate-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="destination"
                    value={d.id}
                    checked={destination === d.id}
                    onChange={() => setDestination(d.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-bold text-slate-900">{d.label}</span>
                    <span className="block text-[11px] text-slate-500">{d.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {destination === "resource" ? (
              <label className="mt-3 block text-xs font-semibold text-slate-600">
                Visibilité dans l’espace
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value)}
                  className="mt-1 w-full max-w-sm rounded-lg border border-slate-200 px-2 py-2 text-sm"
                >
                  {(catalog.data?.visibilities || []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={generate.isPending || prompt.trim().length < 8 || formats.length === 0}
                onClick={() => generate.mutate()}
                className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {generate.isPending ? "Lancement…" : "Produire ce brief"}
              </button>
              <p className="text-xs text-slate-500">
                {formats.length} format{formats.length > 1 ? "s" : ""} · vous validerez la publication ici, une fois la mission terminée
              </p>
            </div>
            {generate.isError ? (
              <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                {generate.error instanceof Error ? generate.error.message : "Lancement impossible."}
              </p>
            ) : null}
            {generate.isSuccess ? (
              <p className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Production lancée.{" "}
                <Link href={`/missions?job=${encodeURIComponent(generate.data.job_id)}`} className="font-semibold underline">
                  Ouvrir la mission
                </Link>
                <span className="mt-1 block text-xs">{generate.data.next?.hint}</span>
              </p>
            ) : null}
          </SectionCard>

          <SectionCard title="Valider et publier">
            <p className="text-sm text-slate-600">
              La mission produit les pièces. Ensuite : dans Korymb, un clic crée la ressource ; hors application, le
              même clic envoie le post si le connecteur (Instagram, Facebook, LinkedIn, YouTube, etc.) est branché.
              Une pièce publiée quitte cette file. Sinon, vous pouvez la retirer (confirmation SUPPRIMER). Sans
              validation au bout de 2 jours, une notification vous le rappelle.
            </p>
            <label className="mt-3 block max-w-sm text-xs font-semibold text-slate-600">
              Visibilité dans l’espace
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
              >
                {(catalog.data?.visibilities || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <StudioReleaseList
              runs={runs.data || []}
              loading={runs.isLoading}
              visibility={visibility}
              onReleased={() => void qc.invalidateQueries({ queryKey: ["studio-runs"] })}
            />
            <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Publication manuelle (file_id ou texte)</summary>
              <p className="mt-2 text-xs text-slate-500">
                Secours si la pièce n’a pas été reconnue. Collez un <code className="rounded bg-white px-1">file_id</code>{" "}
                (rfil-…) ou un texte pour un PDF brandé.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">
                  Titre
                  <input
                    value={publishTitle}
                    onChange={(e) => setPublishTitle(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Type
                  <select
                    value={publishType}
                    onChange={(e) => setPublishType(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  >
                    <option value="document">Document</option>
                    <option value="podcast">Podcast</option>
                    <option value="video">Vidéo</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  file_id
                  <input
                    value={publishFileId}
                    onChange={(e) => setPublishFileId(e.target.value)}
                    placeholder="rfil-…"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Job studio (optionnel)
                  <input
                    value={publishJobId}
                    onChange={(e) => setPublishJobId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  />
                </label>
              </div>
              <label className="mt-3 block text-xs font-semibold text-slate-600">
                Texte → PDF (si pas de fichier)
                <textarea
                  value={publishMarkdown}
                  onChange={(e) => setPublishMarkdown(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={publish.isPending || !publishTitle.trim() || (!publishFileId.trim() && !publishMarkdown.trim())}
                onClick={() => publish.mutate()}
                className="mt-3 rounded-xl border border-violet-300 bg-white px-4 py-2 text-sm font-bold text-violet-900 disabled:opacity-50"
              >
                {publish.isPending ? "Publication…" : "Créer la ressource planning"}
              </button>
              {publish.isError ? (
                <p className="mt-2 text-sm text-red-700">
                  {publish.error instanceof Error ? publish.error.message : "Publication impossible."}
                </p>
              ) : null}
              {publish.isSuccess ? (
                <p className="mt-2 text-sm text-emerald-800">
                  {publish.data.message}{" "}
                  <Link href="/gestion/planning" className="font-semibold underline">
                    Voir le planning
                  </Link>
                </p>
              ) : null}
            </details>
          </SectionCard>
        </div>

        <aside className="space-y-5">
          <SectionCard title="Chaîne de production">
            <ol className="list-decimal space-y-2 pl-4 text-sm text-slate-600">
              <li>Brief + formats ici — une mission se lance.</li>
              <li>Le Community Manager rédige dans la voix de la mémoire.</li>
              <li>Quand c’est prêt, vous validez ici : ressource dans l’espace, ou envoi sur le réseau si le connecteur est branché.</li>
              <li>YouTube : pas d’upload automatique (clé Data API) — le pack va dans l’espace.</li>
            </ol>
            <ul className="mt-3 space-y-1 text-xs text-slate-500">
              {(catalog.data?.ethics || []).map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="Outils">
            <ul className="space-y-2">
              {connections.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 text-sm">
                  <span>
                    <span className="font-semibold text-slate-800">{c.label}</span>
                    <span className="block text-[11px] text-slate-500">{c.role}</span>
                    {c.note ? <span className="block text-[11px] text-emerald-800">{c.note}</span> : null}
                  </span>
                  <Link
                    href={connectionSetupHref(c)}
                    className={`shrink-0 text-[11px] font-bold ${c.configured ? "text-emerald-700 hover:underline" : "text-amber-800 underline"}`}
                  >
                    {c.configured ? "OK" : "Brancher"}
                  </Link>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="Productions récentes">
            {runs.isLoading ? <p className="text-sm text-slate-400">Chargement…</p> : null}
            {(runs.data || []).length === 0 ? (
              <p className="text-sm text-slate-500">Aucune production studio pour l’instant.</p>
            ) : (
              <ul className="space-y-2">
                {(runs.data || []).map((run) => (
                  <li key={run.job_id} className="rounded-lg border border-slate-100 p-2">
                    <Link href={`/missions?job=${encodeURIComponent(run.job_id)}`} className="text-sm font-semibold text-violet-900 underline">
                      {formatStatus(run.status)}
                    </Link>
                    <p className="text-[11px] text-slate-500">{(run.formats || []).join(" · ") || run.job_id}</p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </aside>
      </div>
    </PageShell>
  );
}

function readyStatus(status?: string) {
  const s = (status || "").toLowerCase();
  return s === "completed" || s === "done";
}

function StudioReleaseList({
  runs,
  loading,
  visibility,
  onReleased,
}: {
  runs: StudioRun[];
  loading: boolean;
  visibility: string;
  onReleased: () => void;
}) {
  const [busyKey, setBusyKey] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [dismissTarget, setDismissTarget] = useState<{ jobId: string; formatId: string; label: string } | null>(null);
  const [dismissTyped, setDismissTyped] = useState("");
  const release = useMutation({
    mutationFn: (body: { job_id: string; format_id: string; target: string }) =>
      studioApi.release({ ...body, visibility }),
    onSuccess: (data) => {
      setErrMsg("");
      setOkMsg(data.message || "Publié.");
      onReleased();
    },
    onError: (error) => {
      setOkMsg("");
      setErrMsg(error instanceof Error ? error.message : "Publication impossible.");
    },
    onSettled: () => setBusyKey(""),
  });
  const dismiss = useMutation({
    mutationFn: (body: { job_id: string; format_id?: string; confirm: string }) => studioApi.dismiss(body),
    onSuccess: (data) => {
      setErrMsg("");
      setOkMsg(data.message || "Retirée de la file.");
      setDismissTarget(null);
      setDismissTyped("");
      onReleased();
    },
    onError: (error) => {
      setOkMsg("");
      setErrMsg(error instanceof Error ? error.message : "Retrait impossible.");
    },
    onSettled: () => setBusyKey(""),
  });

  const fire = (jobId: string, formatId: string, target: string) => {
    const key = `${jobId}:${formatId}:${target}`;
    setBusyKey(key);
    setErrMsg("");
    setOkMsg("");
    release.mutate({ job_id: jobId, format_id: formatId, target });
  };

  const askDismiss = (jobId: string, formatId: string, label: string) => {
    setErrMsg("");
    setOkMsg("");
    setDismissTyped("");
    setDismissTarget({ jobId, formatId, label });
  };

  const confirmDismiss = () => {
    if (!dismissTarget) return;
    setBusyKey(`dismiss:${dismissTarget.jobId}:${dismissTarget.formatId}`);
    dismiss.mutate({
      job_id: dismissTarget.jobId,
      format_id: dismissTarget.formatId,
      confirm: dismissTyped.trim(),
    });
  };

  const pending = dismiss.isPending || release.isPending;
  const confirmOk = dismissTyped.trim() === "SUPPRIMER";

  if (loading) return <p className="mt-3 text-sm text-slate-400">Chargement des productions…</p>;
  if (!runs.length && !okMsg) {
    return <p className="mt-3 text-sm text-slate-500">Lancez un brief : les pièces à valider apparaîtront ici.</p>;
  }

  return (
    <div className="mt-4 space-y-3">
      {errMsg ? (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{errMsg}</p>
      ) : null}
      {okMsg ? (
        <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {okMsg}{" "}
          {okMsg.toLowerCase().includes("retir") ? null : (
            <Link href="/gestion/planning" className="font-semibold underline">
              Voir le planning
            </Link>
          )}
        </p>
      ) : null}
      {dismissTarget ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3" role="dialog" aria-labelledby="studio-dismiss-title">
          <p id="studio-dismiss-title" className="text-sm font-bold text-red-950">
            Retirer « {dismissTarget.label} » de cette file ?
          </p>
          <p className="mt-1 text-xs text-red-900">
            La pièce disparaît d’ici. La mission reste dans Missions. Tapez <strong>SUPPRIMER</strong> pour confirmer.
          </p>
          <label className="mt-2 block text-xs font-semibold text-red-950">
            Confirmation
            <input
              value={dismissTyped}
              onChange={(e) => setDismissTyped(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-red-200 bg-white px-2 py-2 text-sm"
              placeholder="SUPPRIMER"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!confirmOk || pending}
              onClick={confirmDismiss}
              className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              {pending && busyKey.startsWith("dismiss:") ? "Retrait…" : "Confirmer le retrait"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setDismissTarget(null);
                setDismissTyped("");
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}
      {runs.map((run) => {
        const ready = readyStatus(run.status);
        const pieces = run.pieces || [];
        return (
          <article key={run.job_id} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-bold text-slate-900">{formatStatus(run.status)}</p>
              <div className="flex flex-wrap items-center gap-3">
                {run.can_dismiss ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => askDismiss(run.job_id, "", (run.formats || []).join(" · ") || "cette production")}
                    className="text-[11px] font-semibold text-red-800 underline disabled:opacity-50"
                  >
                    Retirer de la file
                  </button>
                ) : null}
                <Link href={`/missions?job=${encodeURIComponent(run.job_id)}`} className="text-[11px] font-semibold text-violet-800 underline">
                  Mission
                </Link>
              </div>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">{(run.formats || []).join(" · ") || run.job_id}</p>
            {!ready ? (
              <p className="mt-2 text-xs text-slate-500">La validation s’affiche ici dès que la mission est terminée.</p>
            ) : null}
            {ready && pieces.length === 0 ? (
              <p className="mt-2 text-xs text-amber-800">Aucune pièce reconnue. Utilisez la publication manuelle ci-dessous.</p>
            ) : null}
            {ready
              ? pieces.map((piece) => (
                  <StudioPieceRow
                    key={`${run.job_id}:${piece.format_id}`}
                    jobId={run.job_id}
                    piece={piece}
                    busyKey={busyKey}
                    pending={pending}
                    onRelease={fire}
                    onDismiss={askDismiss}
                  />
                ))
              : null}
          </article>
        );
      })}
    </div>
  );
}

function StudioPieceRow({
  jobId,
  piece,
  busyKey,
  pending,
  onRelease,
  onDismiss,
}: {
  jobId: string;
  piece: StudioPiece;
  busyKey: string;
  pending: boolean;
  onRelease: (jobId: string, formatId: string, target: string) => void;
  onDismiss: (jobId: string, formatId: string, label: string) => void;
}) {
  const inAppKey = `${jobId}:${piece.format_id}:korymb`;
  const channelKey = `${jobId}:${piece.format_id}:${piece.channel}`;
  const youtubeNote = piece.channel === "youtube" || piece.format_id === "youtube";
  return (
    <div className="mt-2 rounded-lg border border-white bg-white p-2.5 shadow-sm">
      <p className="text-sm font-semibold text-slate-900">{piece.label}</p>
      {piece.title && piece.title !== piece.label ? (
        <p className="text-xs text-slate-600">{piece.title}</p>
      ) : null}
      {piece.body_preview ? <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-slate-500">{piece.body_preview}</p> : null}
      {youtubeNote ? (
        <p className="mt-1 text-[11px] text-slate-500">
          YouTube : pas d’upload automatique. Le pack se publie dans l’espace Korymb.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {piece.can_publish_in_app ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onRelease(jobId, piece.format_id, "korymb")}
            className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {busyKey === inAppKey ? "Publication…" : "Valider et publier dans l’espace"}
          </button>
        ) : null}
        {piece.can_publish_channel ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onRelease(jobId, piece.format_id, piece.channel)}
            className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-bold text-violet-900 disabled:opacity-50"
          >
            {busyKey === channelKey ? "Envoi…" : `Valider et publier sur ${piece.channel_label}`}
          </button>
        ) : null}
        {!piece.can_publish_channel && piece.channel && !["korymb", "mission", "youtube"].includes(piece.channel) && !piece.connector_ready ? (
          <Link
            href={connectionSetupHref({ id: "", setup: piece.connector_setup })}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900"
          >
            Brancher {piece.channel_label}
          </Link>
        ) : null}
        {piece.can_publish_in_app || piece.can_publish_channel ? null : piece.connector_ready && piece.channel !== "youtube" ? (
          <p className="text-[11px] text-slate-500">Contenu trop court ou fichier manquant pour publier.</p>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => onDismiss(jobId, piece.format_id, piece.title || piece.label)}
          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-800 disabled:opacity-50"
        >
          Retirer
        </button>
      </div>
    </div>
  );
}
