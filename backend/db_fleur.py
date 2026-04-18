"""
db_fleur.py — Connecteur lecture seule à la base MariaDB de l'app Fleur d'Amours.

En production (VPS Coolify) : connexion directe via hostname interne.
En développement local    : requiert un tunnel SSH sur le port 3307.
  → ssh -f -N -L 3307:juehpsnqkm60d2o6dhs38c5t:3306 root@92.113.28.43
"""
import os
import json
import pymysql
from crewai.tools import tool
from config import settings

_DB_CONFIG = {
    "host":    os.getenv("FLEUR_DB_HOST",     settings.fleur_db_host),
    "port":    int(os.getenv("FLEUR_DB_PORT", settings.fleur_db_port)),
    "user":    settings.fleur_db_user,
    "password": settings.fleur_db_password,
    "database": settings.fleur_db_name,
    "charset":  "utf8mb4",
    "connect_timeout": 5,
    "read_timeout": 10,
}


def _get_conn():
    return pymysql.connect(**_DB_CONFIG, cursorclass=pymysql.cursors.DictCursor)


def _safe_query(sql: str, params=None) -> list[dict]:
    """Exécute une requête SELECT en lecture seule."""
    sql_upper = sql.strip().upper()
    if not sql_upper.startswith("SELECT") and not sql_upper.startswith("SHOW") and not sql_upper.startswith("DESC"):
        raise ValueError("Seules les requêtes SELECT/SHOW/DESC sont autorisées.")
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return cur.fetchall()


# ── Outils agents ────────────────────────────────────────────────────────────

@tool("Lister les tables de la base Fleur d'Amours")
def db_list_tables(dummy: str = "") -> str:
    """
    Retourne la liste des tables et leur nombre de lignes dans la base de données
    de l'application Fleur d'Amours. Utilise cet outil en premier pour comprendre
    la structure des données disponibles.
    """
    try:
        tables = _safe_query("SHOW TABLES")
        result = []
        for row in tables:
            table = list(row.values())[0]
            count = _safe_query(f"SELECT COUNT(*) as n FROM `{table}`")[0]["n"]
            result.append(f"- {table} : {count} lignes")
        return "Tables disponibles :\n" + "\n".join(result)
    except Exception as e:
        return f"Connexion DB impossible : {e}\nVérifier que le tunnel SSH est actif ou que le backend tourne sur le VPS."


@tool("Décrire une table de la base Fleur d'Amours")
def db_describe_table(table_name: str) -> str:
    """
    Retourne la structure (colonnes, types) d'une table spécifique.
    Utilise cet outil avant d'interroger une table pour en comprendre les champs.
    """
    try:
        rows = _safe_query(f"DESCRIBE `{table_name}`")
        lines = [f"  {r['Field']} ({r['Type']}) {'NOT NULL' if r['Null']=='NO' else 'nullable'}" for r in rows]
        return f"Structure de {table_name} :\n" + "\n".join(lines)
    except Exception as e:
        return f"Erreur : {e}"


@tool("Interroger la base de données Fleur d'Amours")
def db_query(sql: str) -> str:
    """
    Exécute une requête SELECT sur la base de données de l'app Fleur d'Amours.
    LECTURE SEULE — uniquement SELECT, SHOW, DESCRIBE.
    Exemples utiles :
      - Compter les utilisateurs : SELECT COUNT(*) FROM users
      - Voir les dernières réponses : SELECT * FROM questionnaire_results ORDER BY created_at DESC LIMIT 10
      - Analyser par type : SELECT type, COUNT(*) FROM fleurs GROUP BY type
    Retourne max 50 lignes. Pour des analyses agrégées, utilise GROUP BY.
    """
    try:
        rows = _safe_query(sql)
        if not rows:
            return "Aucun résultat."
        # Limite à 50 lignes
        rows = rows[:50]
        keys = list(rows[0].keys())
        lines = [" | ".join(keys)]
        lines.append("-" * len(lines[0]))
        for r in rows:
            lines.append(" | ".join(str(v) if v is not None else "NULL" for v in r.values()))
        return "\n".join(lines) + f"\n\n({len(rows)} lignes)"
    except ValueError as e:
        return f"Requête non autorisée : {e}"
    except Exception as e:
        return f"Erreur SQL : {e}"


@tool("Analyser les données utilisateurs Fleur d'Amours")
def db_analyze_users(question: str) -> str:
    """
    Analyse les données utilisateurs/clients de l'app Fleur d'Amours.
    Pose une question en langage naturel et l'outil choisit la bonne requête.
    Exemples : 'combien d utilisateurs', 'répartition des abonnements',
    'derniers inscrits', 'utilisateurs actifs ce mois'
    """
    q = question.lower()
    try:
        if any(k in q for k in ["combien", "total", "count", "nombre"]):
            # Essaie différents noms de table courants
            for table in ["users", "user", "accounts", "members", "clients"]:
                try:
                    r = _safe_query(f"SELECT COUNT(*) as total FROM `{table}`")
                    return f"Total dans `{table}` : {r[0]['total']} entrées"
                except Exception:
                    continue
            return "Table users non trouvée. Utilise db_list_tables pour voir les tables disponibles."

        elif any(k in q for k in ["récent", "dernier", "nouveau", "inscrit"]):
            for table in ["users", "user", "accounts"]:
                try:
                    r = _safe_query(f"SELECT * FROM `{table}` ORDER BY created_at DESC LIMIT 10")
                    if r:
                        keys = list(r[0].keys())
                        lines = [" | ".join(keys)] + [" | ".join(str(v) for v in row.values()) for row in r]
                        return "\n".join(lines)
                except Exception:
                    continue

        elif any(k in q for k in ["abonnement", "plan", "subscription", "premium"]):
            for col in ["plan", "subscription", "tier", "role"]:
                try:
                    r = _safe_query(f"SELECT {col}, COUNT(*) as n FROM users GROUP BY {col}")
                    return "\n".join([f"{row[col]}: {row['n']}" for row in r])
                except Exception:
                    continue

        return db_list_tables("")

    except Exception as e:
        return f"Erreur : {e}"
