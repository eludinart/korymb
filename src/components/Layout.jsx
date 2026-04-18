import React from "react";
import { Link } from "react-router-dom";

export default function Layout({ children }) {
  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.title}>Tarot Fleur d'Amours</h1>
        <nav style={styles.nav}>
          <Link to="/" style={styles.navLink}>Accueil</Link>
          <Link to="/manuel" style={styles.navLink}>Manuel</Link>
          <Link to="/cartes" style={styles.navLink}>Cartes</Link>
          <Link to="/tirage" style={styles.navLink}>Tirage</Link>
        </nav>
      </header>

      <main style={styles.main}>{children}</main>
    </div>
  );
}

const styles = {
  app: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 800,
    margin: "0 auto",
    padding: "0 12px",
  },
  header: {
    padding: "12px 0",
  },
  title: {
    fontSize: 20,
    marginBottom: 8,
  },
  nav: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  navLink: {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #ccc",
    textDecoration: "none",
    fontSize: 14,
    color: "#000"
  },
  main: {
    padding: "12px 0 24px",
  },
};
