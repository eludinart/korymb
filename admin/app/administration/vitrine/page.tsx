"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PracticeTheme } from "../../../components/practice/PracticeTheme";
import { StorefrontView } from "../../../components/practice/StorefrontView";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../../../lib/api";
import {
  OFFER_KIND_LABELS,
  PRACTICE_ACCENTS,
  PRACTICE_PAPERS,
  PRACTICE_TYPEFACES,
} from "../../../lib/practiceTheme";
import type { StorefrontOffer, StorefrontPublic } from "../../../lib/storefront";

type StorefrontSettings = StorefrontPublic & {
  subscriber_count?: number;
  subscribers?: Array<{
    id: string;
    email: string;
    display_name?: string;
    status?: string;
    invite_code?: string;
  }>;
};

const emptyOffer = (): StorefrontOffer => ({ title: "", summary: "", kind: "" });

async function uploadBrand(kind: "logo" | "cover", file: File) {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`/api/korymb-bin/storefront/brand-files?kind=${kind}`, {
    method: "POST",
    body,
    credentials: "include",
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { file?: { id: string }; detail?: unknown; error?: string };
  if (!res.ok || !data.file) {
    throw new Error(formatHttpApiErrorPayload(data) || data.error || "Upload impossible");
  }
  return data.file.id;
}

export default function VitrineAdminPage() {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [intro, setIntro] = useState("");
  const [location, setLocation] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactUrl, setContactUrl] = useState("");
  const [accent, setAccent] = useState("emerald");
  const [paper, setPaper] = useState("warm");
  const [typeface, setTypeface] = useState("sans");
  const [logoId, setLogoId] = useState("");
  const [coverId, setCoverId] = useState("");
  const [offers, setOffers] = useState<StorefrontOffer[]>([emptyOffer()]);
  const [hydrated, setHydrated] = useState(false);
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState("");

  const settings = useQuery({
    queryKey: ["storefront-settings"],
    queryFn: async () => {
      const { data } = await requestJson("/storefront/settings", { headers: agentHeaders() });
      return data as StorefrontSettings;
    },
  });

  useEffect(() => {
    if (!settings.data || hydrated) return;
    const s = settings.data;
    setEnabled(Boolean(s.public_enabled));
    setSlug(s.slug || "");
    setName(s.name || "");
    setTagline(s.tagline || "");
    setIntro(s.intro || "");
    setLocation(s.location || "");
    setContactEmail(s.contact_email || "");
    setContactUrl(s.contact_url || "");
    setAccent(s.accent || "emerald");
    setPaper(s.paper || "warm");
    setTypeface(s.typeface || "sans");
    setLogoId(s.logo_file_id || "");
    setCoverId(s.cover_file_id || "");
    setOffers(s.offers && s.offers.length ? s.offers : [emptyOffer()]);
    setHydrated(true);
  }, [settings.data, hydrated]);

  const save = useMutation({
    mutationFn: async () => {
      const { data } = await requestJson("/storefront/settings", {
        method: "PATCH",
        headers: agentHeaders(),
        body: JSON.stringify({
          public_enabled: enabled,
          slug,
          name,
          tagline,
          intro,
          location,
          contact_email: contactEmail,
          contact_url: contactUrl,
          accent,
          paper,
          typeface,
          logo_file_id: logoId,
          cover_file_id: coverId,
          offers: offers.filter((o) => o.title.trim()),
        }),
      });
      return data as StorefrontSettings;
    },
    onSuccess: (data) => {
      setOk("Page publique enregistrée.");
      setHydrated(false);
      void qc.invalidateQueries({ queryKey: ["storefront-settings"] });
      void qc.invalidateQueries({ queryKey: ["storefront-public"] });
      if (data) setSlug(data.slug || slug);
    },
  });

  const preview: StorefrontPublic = {
    id: settings.data?.id || "preview",
    name: name || "Votre pratique",
    slug: slug || "preview",
    tagline,
    intro,
    location,
    contact_email: contactEmail,
    contact_url: contactUrl,
    accent,
    paper,
    typeface,
    has_logo: Boolean(logoId),
    has_cover: Boolean(coverId),
    logo_url: slug && logoId ? `/api/public/storefront/${encodeURIComponent(slug)}/brand/logo?inline=true` : "",
    cover_url: slug && coverId ? `/api/public/storefront/${encodeURIComponent(slug)}/brand/cover?inline=true` : "",
    offers: offers.filter((o) => o.title.trim()),
    events: settings.data?.events || [],
    resources: settings.data?.resources || [],
    resources_upcoming: settings.data?.resources_upcoming || [],
    public_enabled: enabled,
  };

  async function onBrand(kind: "logo" | "cover", list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setBusy(kind);
    setOk("");
    try {
      const id = await uploadBrand(kind, file);
      if (kind === "logo") setLogoId(id);
      else setCoverId(id);
      setHydrated(false);
      void qc.invalidateQueries({ queryKey: ["storefront-settings"] });
    } catch (err) {
      save.reset();
      setOk("");
      alert(err instanceof Error ? err.message : "Upload impossible");
    } finally {
      setBusy("");
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setOk("");
    save.mutate();
  }

  return (
    <PageShell className="space-y-6" size="wide">
      <PageHeader
        accent="violet"
        badge="Page publique"
        title="Ce que voient vos inscrits — et les autres"
        description="Identité, couleurs, prochaine date. Les ressources publiques n’exigent pas de compte. Les inscrits sont des participants (inscription validée ou invitation), pas les fiches CRM."
        actions={
          slug ? (
            <Link href={`/p/${encodeURIComponent(slug)}`} className="btn-link-secondary" target="_blank" rel="noreferrer">
              Ouvrir la page
            </Link>
          ) : null
        }
      />

      {settings.isLoading ? <LoadingLine label="Chargement…" /> : null}
      {settings.isError ? (
        <AlertBox tone="error" title="Impossible de charger">
          {settings.error instanceof Error ? settings.error.message : "Droits administrateur requis."}
        </AlertBox>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form onSubmit={onSubmit} className="space-y-6">
          <SectionCard title="Publication">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>
                <span className="font-semibold text-slate-900">Page visible</span>
                <span className="mt-1 block text-slate-600">
                  Adresse : <code className="rounded bg-slate-100 px-1">/p/{slug || "…"}</code>
                </span>
              </span>
            </label>
            <label className="mt-4 block text-sm">
              <span className="font-medium text-slate-700">Nom public</span>
              <input className="input-field mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="mt-4 block text-sm">
              <span className="font-medium text-slate-700">Slug</span>
              <input className="input-field mt-1 w-full max-w-sm" value={slug} onChange={(e) => setSlug(e.target.value)} required minLength={2} />
            </label>
          </SectionCard>

          <SectionCard title="Identité">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Lieu</span>
              <input className="input-field mt-1 w-full" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="SÏvåñà, Tourves" />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">E-mail de contact</span>
                <input className="input-field mt-1 w-full" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Site ou réseau</span>
                <input className="input-field mt-1 w-full" value={contactUrl} onChange={(e) => setContactUrl(e.target.value)} placeholder="https://" />
              </label>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Logo</span>
                <input className="mt-1 block w-full text-sm" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={Boolean(busy)} onChange={(e) => void onBrand("logo", e.target.files)} />
                {logoId ? (
                  <button type="button" className="mt-1 text-xs font-semibold text-slate-600 underline" onClick={() => setLogoId("")}>
                    Retirer le logo
                  </button>
                ) : null}
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Photo de couverture</span>
                <input className="mt-1 block w-full text-sm" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={Boolean(busy)} onChange={(e) => void onBrand("cover", e.target.files)} />
                {coverId ? (
                  <button type="button" className="mt-1 text-xs font-semibold text-slate-600 underline" onClick={() => setCoverId("")}>
                    Retirer la photo
                  </button>
                ) : null}
              </label>
            </div>
            {busy ? <p className="mt-2 text-sm text-slate-500">Envoi de l’image…</p> : null}
          </SectionCard>

          <SectionCard title="Peau visuelle">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Accent</span>
                <select className="input-field mt-1 w-full" value={accent} onChange={(e) => setAccent(e.target.value)}>
                  {Object.entries(PRACTICE_ACCENTS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Papier</span>
                <select className="input-field mt-1 w-full" value={paper} onChange={(e) => setPaper(e.target.value)}>
                  {Object.entries(PRACTICE_PAPERS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Typo</span>
                <select className="input-field mt-1 w-full" value={typeface} onChange={(e) => setTypeface(e.target.value)}>
                  {Object.entries(PRACTICE_TYPEFACES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </SectionCard>

          <SectionCard title="Présentation">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Accroche</span>
              <input className="input-field mt-1 w-full" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={240} />
            </label>
            <label className="mt-4 block text-sm">
              <span className="font-medium text-slate-700">Texte d’accueil</span>
              <textarea className="input-field mt-1 w-full" rows={5} value={intro} onChange={(e) => setIntro(e.target.value)} maxLength={4000} />
            </label>
          </SectionCard>

          <SectionCard title="Offres">
            <div className="space-y-4">
              {offers.map((offer, idx) => (
                <div key={idx} className="grid gap-2 rounded-xl border border-slate-100 p-3">
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Titre</span>
                    <input
                      className="input-field mt-1 w-full"
                      value={offer.title}
                      onChange={(e) => {
                        const next = [...offers];
                        next[idx] = { ...offer, title: e.target.value };
                        setOffers(next);
                      }}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Format</span>
                    <select
                      className="input-field mt-1 w-full max-w-xs"
                      value={offer.kind || ""}
                      onChange={(e) => {
                        const next = [...offers];
                        next[idx] = { ...offer, kind: e.target.value };
                        setOffers(next);
                      }}
                    >
                      <option value="">Non précisé</option>
                      {Object.entries(OFFER_KIND_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Résumé</span>
                    <textarea
                      className="input-field mt-1 w-full"
                      rows={2}
                      value={offer.summary || ""}
                      onChange={(e) => {
                        const next = [...offers];
                        next[idx] = { ...offer, summary: e.target.value };
                        setOffers(next);
                      }}
                    />
                  </label>
                </div>
              ))}
              <button type="button" className="btn-secondary text-sm" onClick={() => setOffers((prev) => [...prev, emptyOffer()])}>
                Ajouter une offre
              </button>
            </div>
          </SectionCard>

          <SectionCard title={`Participants (${settings.data?.subscriber_count ?? 0})`}>
            <p className="mb-3 text-sm text-slate-600">
              Ce n’est pas la liste CRM. Un participant s’inscrit (à valider) ou reçoit une invitation par e-mail avec un code, puis se connecte une première fois.
            </p>
            <InviteParticipantForm
              onDone={() => {
                void qc.invalidateQueries({ queryKey: ["storefront-settings"] });
                void qc.invalidateQueries({ queryKey: ["storefront-participants"] });
              }}
            />
            {(settings.data?.subscribers || []).length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">Personne ne s’est encore inscrit ni invité.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-100 text-sm">
                {(settings.data?.subscribers || []).map((s) => (
                  <ParticipantRow
                    key={s.id}
                    participant={s}
                    onDone={() => {
                      void qc.invalidateQueries({ queryKey: ["storefront-settings"] });
                      void qc.invalidateQueries({ queryKey: ["storefront-participants"] });
                    }}
                  />
                ))}
              </ul>
            )}
          </SectionCard>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
            {save.isError ? (
              <p className="text-sm text-red-700">{save.error instanceof Error ? save.error.message : "Erreur"}</p>
            ) : null}
            {ok && !save.isPending ? <p className="text-sm font-semibold text-emerald-800">{ok}</p> : null}
          </div>
        </form>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-violet-800">Aperçu téléphone</p>
          <div className="overflow-hidden rounded-[1.75rem] border-4 border-slate-900 bg-slate-900 p-2 shadow-sm">
            <div className="max-h-[34rem] overflow-y-auto rounded-[1.2rem] bg-white">
              <PracticeTheme identity={preview}>
                <StorefrontView data={preview} compact />
              </PracticeTheme>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">Les dates viennent du planning déjà publié.</p>
        </aside>
      </div>
    </PageShell>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: "À valider",
  guest: "Invité",
  active: "Actif",
  disabled: "Désactivé",
};

function InviteParticipantForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const invite = useMutation({
    mutationFn: async () => {
      const { data } = await requestJson("/storefront/participants/invite", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ email, display_name: displayName }),
      });
      return data as { participant?: { invite_code?: string; mail_sent?: boolean; email?: string } };
    },
    onSuccess: (data) => {
      const p = data.participant || {};
      const code = p.invite_code ? ` Code : ${p.invite_code}.` : "";
      const mail = p.mail_sent ? " E-mail envoyé." : " L’e-mail n’a pas pu partir — transmettez le code à la main.";
      setOk(`Invitation créée pour ${p.email || email}.${code}${mail}`);
      setError("");
      setEmail("");
      setDisplayName("");
      onDone();
    },
    onError: (e: Error) => {
      setOk("");
      setError(e.message);
    },
  });
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        invite.mutate();
      }}
    >
      <input
        className="input-field"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="e-mail de l’invité"
      />
      <input
        className="input-field"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Prénom"
      />
      <button type="submit" className="btn-primary" disabled={invite.isPending}>
        {invite.isPending ? "Envoi…" : "Inviter"}
      </button>
      {error ? <p className="sm:col-span-3 text-sm text-red-700">{error}</p> : null}
      {ok ? <p className="sm:col-span-3 text-sm text-emerald-800">{ok}</p> : null}
    </form>
  );
}

function ParticipantRow({
  participant,
  onDone,
}: {
  participant: { id: string; email: string; display_name?: string; status?: string; invite_code?: string };
  onDone: () => void;
}) {
  const validate = useMutation({
    mutationFn: async () => {
      const { data } = await requestJson(`/storefront/participants/${encodeURIComponent(participant.id)}/validate`, {
        method: "POST",
        headers: agentHeaders(),
      });
      return data;
    },
    onSuccess: onDone,
  });
  const status = participant.status || "active";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div>
        <span className="font-semibold text-slate-900">{participant.display_name || participant.email}</span>
        <span className="ml-2 text-slate-500">{participant.email}</span>
        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
          {STATUS_LABELS[status] || status}
        </span>
        {status === "guest" && participant.invite_code ? (
          <span className="ml-2 font-mono text-xs text-slate-600">code {participant.invite_code}</span>
        ) : null}
      </div>
      {status === "pending" ? (
        <button type="button" className="btn-secondary text-xs" disabled={validate.isPending} onClick={() => validate.mutate()}>
          {validate.isPending ? "Validation…" : "Valider l’inscription"}
        </button>
      ) : null}
    </li>
  );
}
