import React, { useState } from "react";
import { Link } from "react-router-dom";
import cards from "../data/cards.json";

export default function CardList() {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const types = Array.from(new Set(cards.map((c) => c.type)));

  const filtered = cards.filter((card) => {
    const matchQuery =
      !query ||
      card.nom.toLowerCase().includes(query.toLowerCase()) ||
      card.keywords.some((k) =>
        k.toLowerCase().includes(query.toLowerCase())
      );

    const matchType = !typeFilter || card.type === typeFilter;

    return matchQuery && matchType;
  });

  return (
    <div>
      <div style={styles.filters}>
        <input
          style={styles.input}
          placeholder="Rechercher une carte..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <select
          style={styles.select}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">Tous types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <ul style={styles.list}>
        {filtered.map((card) => (
          <li key={card.id} style={styles.item}>
            <Link to={`/cartes/${card.id}`} style={styles.link}>
              <div style={styles.cardTitle}>{card.nom}</div>
              <div style={styles.cardMeta}>
                {card.type} • {card.keywords.join(", ")}
              </div>
              <div style={styles.cardResume}>{card.resume}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const styles = {
  filters: {
    display: "flex",
    gap: 8,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    padding: "6px 8px",
    fontSize: 14,
  },
  select: {
    padding: "6px 8px",
    fontSize: 14,
  },
  list: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  item: {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: 8,
  },
  link: {
    textDecoration: "none",
    color: "inherit",
  },
  cardTitle: {
    fontWeight: "bold",
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 12,
    color: "#555",
    marginBottom: 4,
  },
  cardResume: {
    fontSize: 14,
  },
};
