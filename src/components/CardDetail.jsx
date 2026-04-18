import React from "react";
import { useParams, Link } from "react-router-dom";
import cards from "../data/cards.json";

export default function CardDetail() {
  const { id } = useParams();
  const card = cards.find((c) => c.id === id);

  if (!card) {
    return <p>Carte introuvable.</p>;
  }

  return (
    <div>
      <Link to="/cartes" style={styles.back}>
        ← Retour aux cartes
      </Link>

      <h2>{card.nom}</h2>

      <p style={styles.meta}>
        {card.type} • {card.keywords.join(", ")}
      </p>

      <p style={styles.resume}>{card.resume}</p>

      <p style={styles.text}>{card.texte}</p>
    </div>
  );
}

const styles = {
  back: {
    fontSize: 13,
    textDecoration: "none",
    display: "inline-block",
    marginBottom: 8,
    color: "#000"
  },
  meta: {
    fontSize: 13,
    color: "#555",
  },
  resume: {
    fontWeight: "bold",
    margin: "8px 0",
  },
  text: {
    whiteSpace: "pre-line",
    lineHeight: 1.5,
  },
};
