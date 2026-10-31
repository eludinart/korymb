/** Libellés de coquille — routes inchangées, vocabulaire d'activité (pas un secteur). */

import { GLOSSARY } from "./glossary";

export const UX_COPY = {
  briefing: {
    label: "Aujourd'hui",
    hint: "Ce qui a besoin de vous",
  },
  decisions: {
    label: "À confirmer",
    subtitle: "Quelques points à valider",
    hint: "Relire avant d’envoyer ou d’enregistrer",
  },
  missions: {
    label: "Missions",
    subtitle: "En cours",
    hint: "Travaux lancés (mode avancé)",
  },
  chat: {
    label: "Conversation",
    hint: "Parler à Korymb — il retient ton entreprise",
  },
  gestion: {
    label: "Gestion",
    hint: "Personnes, calendrier, messages",
  },
  livrables: {
    label: "Documents",
    hint: "Pièces produites",
  },
  contacts: {
    label: "Personnes",
    hint: "Personnes et organisations suivies",
  },
  playbooks: {
    label: "Modèles",
    hint: GLOSSARY.modeles.plain,
  },
} as const;
