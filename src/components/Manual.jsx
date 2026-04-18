import React, { useState } from "react";
import manualData from "../data/manual.json";

export default function Manual() {
  const [selected, setSelected] = useState(
    manualData[0]?.sections[0]?.id || null
  );

  const currentSection = (() => {
    for (const chapter of manualData) {
      const section = chapter.sections.find((s) => s.id === selected);
      if (section) return section;
    }
    return null;
  })();

  return (
    <div style={styles.container}>
      <aside style={styles.sidebar}>
        {manualData.map((chapter) => (
          <div key={chapter.id} style={styles.chapter}>
            <div style={styles.chapterTitle}>{chapter.titre}</div>

            {chapter.sections.map((section) => (
              <button
                key={section.id}
                style={{
                  ...styles.sectionButton,
                  ...(section.id === selected ? styles.sectionButtonActive : {})
                }}
                onClick={() => setSelected(section.id)}
              >
                {section.titre}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <section style={styles.content}>
        {currentSection ? (
          <>
            <h2>{currentSection.titre}</h2>
            <p style={styles.text}>{currentSection.texte}</p>
          </>
        ) : (
          <p>Aucune section sélectionnée.</p>
        )}
      </section>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    gap: 16,
  },
  sidebar: {
    minWidth: 180,
    maxWidth: 220,
    fontSize: 14,
    position: "sticky",
    top: 0,
  },
  chapter: {
    marginBottom: 12,
  },
  chapterTitle: {
    fontWeight: "bold",
    marginBottom: 4,
  },
  sectionButton: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "4px 6px",
    marginBottom: 2,
    fontSize: 13,
    borderRadius: 4,
    border: "none",
    background: "transparent",
    cursor: "pointer"
  },
  sectionButtonActive: {
    background: "#eee",
  },
  content: {
    flex: 1,
    fontSize: 15,
  },
  text: {
    lineHeight: 1.5,
    whiteSpace: "pre-line",
  },
};
