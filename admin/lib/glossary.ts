/** Mots du logiciel, expliqués en une phrase. */

export const GLOSSARY = {
  modeles: {
    term: "Modèles",
    plain: "Une demande déjà écrite, prête à lancer.",
  },
  validation: {
    term: "À valider",
    plain: "À relire avant envoi — pas les messages. Rien ne part sans vous.",
  },
  motsLibres: {
    term: "Mots libres",
    plain: "Des mots pour retrouver une personne. Ce ne sont pas des catégories imposées.",
  },
} as const;

export const GLOSSARY_ENTRIES = [GLOSSARY.modeles, GLOSSARY.validation, GLOSSARY.motsLibres] as const;
