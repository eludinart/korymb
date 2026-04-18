import React, { useState } from "react";
import { Link } from "react-router-dom";
import cards from "../data/cards.json";

function drawRandomCard() {
  const index = Math.floor(Math.random() * cards.length);
  return cards[index];
}

export default function Draw() {
  const [card, setCard] = useState(null);

  const handleDraw = () => {
    const c = drawRandomCard();
    setCard(c);
  };

  return (
    <div>
      <h2>Tirage une carte</h2>

      <p style={{ marginBottom: 12 }}>
        Tirage simple pour une question, une couleur de journée, un point de focus.
      </p>

      <button style={styles.button} onClick={handleDraw}>
        Tirer une carte
      </button>

      {card && (
        <div style={styles.result}>
          <h3>{card.nom}</h3>
          <p style={styles.meta}>{card.type} • {card.keywords.join(", ")}</p>
          <p style={styles.resume}>{card.resume}</p>

          <Link to={`/cartes/${card.id}`} style={styles.link}>
            Voir la fiche complète →
          </Link>
        </div>
      )}
    </div>
  );
}

const styles = {
  button: {
    padding: "10px 14px",
    fontSize: 16,
    borderRadius: 8,
    border: "1px solid #ccc",
    background: "#f7f7f7",
    marginBottom: 12,
    cursor: "pointer"
  },
  result: {
    marginTop: 16,
    borderTop: "1px solid #eee",
    paddingTop: 12,
  },
  meta: {
    fontSize: 13,
    color: "#555",
  },
  resume: {
    marginTop: 6,
    marginBottom: 8,
  },
  link: {
    fontSize: 14,
    textDecoration: "none",
    color: "#000"
  },
};
