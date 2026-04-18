import React, { useState } from "react";
import pages from "../data/manual_pages.json";

export default function ManualPages() {
  const [selectedPage, setSelectedPage] = useState(pages[0]?.page || null);

  const current = pages.find(p => p.page === selectedPage) || null;

  return (
    <div style={{ display: "flex", gap: 16 }}>
      <aside style={{ minWidth: 120 }}>
        {pages.map(p => (
          <button
            key={p.page}
            onClick={() => setSelectedPage(p.page)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "4px 6px",
              marginBottom: 2,
              borderRadius: 4,
              border: "none",
              background: p.page === selectedPage ? "#eee" : "transparent",
              cursor: "pointer",
              fontSize: 13
            }}
          >
            Page {p.page}
          </button>
        ))}
      </aside>

      <section style={{ flex: 1, whiteSpace: "pre-line", lineHeight: 1.4 }}>
        {current ? current.texte : "Aucune page sélectionnée."}
      </section>
    </div>
  );
}
