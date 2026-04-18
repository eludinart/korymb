import React from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div style={styles.container}>
      <p>Accès rapide au manuel et aux tirages du Tarot Fleur d'Amours.</p>

      <button style={styles.button} onClick={() => navigate("/tirage")}>
        Faire un tirage
      </button>

      <button style={styles.button} onClick={() => navigate("/manuel")}>
        Consulter le manuel
      </button>

      <button style={styles.button} onClick={() => navigate("/cartes")}>
        Voir les cartes
      </button>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  button: {
    padding: "10px 14px",
    fontSize: 16,
    borderRadius: 8,
    border: "1px solid #ccc",
    background: "#f7f7f7",
    cursor: "pointer"
  },
};
