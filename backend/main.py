"""
main.py — Korymb Backend v3 — Anthropic SDK direct, sans CrewAI dans le flux d'exécution.
"""
import logging
import os
import sys
import uuid
import anthropic
from contextlib import asynccontextmanager
from datetime import date

os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from pydantic import BaseModel

from config import settings
from database import init_db, save_job, update_job, get_job as db_get_job, list_jobs as db_list_jobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")
logger = logging.getLogger(__name__)

PRICE_IN  = 3.0   # $/M tokens
PRICE_OUT = 15.0

# ── Définitions des agents (statique, aucune dépendance CrewAI) ──────────────
AGENTS_DEF = {
    "commercial": {
        "label": "Commercial",
        "role": "Prospection & emails",
        "tools": ["web", "linkedin", "email"],
        "system": (
            "Tu es le Commercial d'Élude In Art. Tu es expert en prospection et développement commercial "
            "pour le Tarot Fleur d'ÅmÔurs. Tu privilégies l'approche maïeutique : tu ouvres des espaces "
            "de sens plutôt que de forcer une vente. Ton public cible : coachs, thérapeutes, facilitateurs.\n\n"
        ),
    },
    "community_manager": {
        "label": "Community Manager",
        "role": "Instagram & Facebook",
        "tools": ["web", "instagram", "facebook"],
        "system": (
            "Tu es le Community Manager d'Élude In Art. Tu crées du contenu engageant et authentique "
            "pour Instagram et Facebook autour du Tarot Fleur d'ÅmÔurs. Tu ne survends pas — tu invites.\n\n"
        ),
    },
    "developpeur": {
        "label": "Développeur",
        "role": "Code & architecture",
        "tools": ["web"],
        "system": (
            "Tu es le Développeur d'Élude In Art. Tu développes et maintiens les outils numériques : "
            "Korymb (QG agents), app Fleur d'ÅmÔurs (Next.js), backend FastAPI, questionnaires Ritual. "
            "Stack : React/Vite, Next.js, FastAPI, Docker, Coolify.\n\n"
        ),
    },
    "comptable": {
        "label": "Comptable",
        "role": "Finances & facturation",
        "tools": [],
        "system": (
            "Tu es le Comptable d'Élude In Art (micro-entreprise d'Éric, Tourves, Var). "
            "Tu suis les finances, prépares devis et factures, analyses les revenus.\n\n"
        ),
    },
    "coordinateur": {
        "label": "CIO — Orchestrateur",
        "role": "Stratégie & délégation",
        "tools": ["web", "linkedin"],
        "is_manager": True,
        "system": (
            "Tu es le CIO d'Élude In Art. Tu as la vision d'ensemble et coordonnes la stratégie globale. "
            "Tu décomposes les objectifs en missions actionnables, assures la cohérence entre toutes les actions "
            "et valides les livrables avant de les soumettre au dirigeant.\n\n"
        ),
    },
}

FLEUR_CONTEXT = (
    "Contexte métier Élude In Art :\n"
    "- Créateur : Éric (Tourves, 83170, Var) — eludinart@gmail.com — 0659582428\n"
    "- Site : eludein.art | App : app-fleurdamours.eludein.art\n"
    "- Produit phare : Tarot Fleur d'ÅmÔurs (65 cartes, outil d'analyse systémique des relations)\n"
    "  → 4 familles : 8 formes d'amour (Agapé, Éros, Philia, Storgé, Pragma, Ludus, Mania, Philautia), "
    "cycle végétal (Racines→Nectar), éléments (Feu, Éther, Eau, Air, Terre + cycles), cycle de la vie\n"
    "  → Pas de divination — cartographie systémique des dynamiques relationnelles\n"
    "  → Cible : coachs, thérapeutes, facilitateurs, couples, professionnels de l'accompagnement\n"
    "- Autres services : constellations systémiques, accompagnement relationnel, VIBRÆ (son), "
    "SÏvåñà (écolieu Haut-Var), stages & ateliers\n"
    "- Modules Pro : 7 modules pour former des professionnels à l'usage du tarot\n"
    "- Business model : vente tarot physique, séances individuelles, modules pro, abonnements Stripe\n"
)


# ── Modèles Pydantic ──────────────────────────────────────────────────────────
class MissionRequest(BaseModel):
    mission: str
    agent: str = "coordinateur"
    context: dict | None = None

class ChatRequest(BaseModel):
    message: str
    agent: str = "coordinateur"
    history: list[dict] = []

class MissionResponse(BaseModel):
    status: str
    job_id: str
    agent: str


# ── Auth ──────────────────────────────────────────────────────────────────────
api_key_header = APIKeyHeader(name="X-Agent-Secret", auto_error=True)
def verify_secret(key: str = Depends(api_key_header)) -> str:
    if key != settings.agent_api_secret:
        raise HTTPException(status_code=403, detail="Secret invalide.")
    return key


# ── État en mémoire ────────────────────────────────────────────────────────────
active_jobs: dict[str, dict] = {}
daily_tokens: dict[str, dict] = {}

def _today() -> str:
    return date.today().isoformat()

def _add_daily(t_in: int, t_out: int):
    today = _today()
    if today not in daily_tokens:
        daily_tokens[today] = {"in": 0, "out": 0}
    daily_tokens[today]["in"]  += t_in
    daily_tokens[today]["out"] += t_out


# ── App FastAPI ────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("Korymb v3 — démarré.")
    yield
    logger.info("Korymb v3 — arrêt.")

app = FastAPI(title="Korymb — Moteur Agentique", version="3.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.env == "development" else [
        "https://korymb.eludein.art",
        "http://korymb.eludein.art",
        "https://api-korymb.eludein.art",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "korymb-backend", "version": "3.0.0"}


@app.get("/agents")
def list_agents():
    return {"agents": [
        {"key": k, "label": v["label"], "role": v["role"],
         "tools": v.get("tools", []), "is_manager": v.get("is_manager", False)}
        for k, v in AGENTS_DEF.items()
    ]}


@app.get("/tokens")
def get_tokens():
    today = _today()
    t = daily_tokens.get(today, {"in": 0, "out": 0})
    cost = (t["in"] * PRICE_IN + t["out"] * PRICE_OUT) / 1_000_000
    return {
        "today": today, "tokens_in": t["in"], "tokens_out": t["out"],
        "total": t["in"] + t["out"], "cost_usd": round(cost, 4),
        "alert": (t["in"] + t["out"]) >= settings.token_alert_threshold,
        "budget_exceeded": (t["in"] + t["out"]) >= settings.max_tokens_per_job * 10,
        "max_per_job": settings.max_tokens_per_job,
        "alert_threshold": settings.token_alert_threshold,
    }


@app.post("/run", response_model=MissionResponse, dependencies=[Depends(verify_secret)])
async def run_mission(request: MissionRequest, background_tasks: BackgroundTasks):
    job_id   = str(uuid.uuid4())[:8]
    job_logs: list = []
    agent_cfg = AGENTS_DEF.get(request.agent, AGENTS_DEF["coordinateur"])

    active_jobs[job_id] = {
        "status": "running", "agent": request.agent,
        "mission": request.mission, "result": None,
        "logs": job_logs, "tokens_in": 0, "tokens_out": 0,
    }
    save_job(job_id, request.agent, request.mission)

    system_prompt = agent_cfg["system"] + FLEUR_CONTEXT

    def _call(client, system, user, max_tokens=4096):
        """Appel Anthropic simple et propre."""
        resp = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return resp.content[0].text, resp.usage.input_tokens, resp.usage.output_tokens

    def execute():
        job_logs.append(f"[korymb] Mission démarrée — {agent_cfg['label']}")
        context_str = f"\n\nContexte : {request.context}" if request.context else ""
        mission_txt = f"{request.mission}{context_str}"
        t_in_total = t_out_total = 0

        try:
            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

            # ── Mode CIO : orchestration multi-agents ──────────────────────
            if request.agent == "coordinateur":
                job_logs.append("[korymb] CIO — analyse de la mission...")

                # Étape 1 : CIO planifie et identifie les agents nécessaires
                plan_txt, ti, to = _call(client,
                    system_prompt + "\n\nTu dois répondre UNIQUEMENT avec un JSON structuré.",
                    f"""Mission : {mission_txt}

Analyse cette mission et réponds avec ce JSON exact (sans markdown) :
{{
  "agents": ["commercial"|"community_manager"|"developpeur"|"comptable"],
  "sous_taches": {{"agent_key": "description de la sous-tâche"}},
  "synthese_attendue": "ce que le CIO doit produire en synthèse finale"
}}

Choisis uniquement les agents VRAIMENT nécessaires (1 à 3 max)."""
                )
                t_in_total += ti; t_out_total += to

                import json as _json
                try:
                    plan = _json.loads(plan_txt.strip())
                except Exception:
                    # Si le JSON échoue, exécution directe par le CIO
                    plan = {"agents": [], "sous_taches": {}, "synthese_attendue": ""}

                job_logs.append(f"[korymb] Plan : {list(plan.get('sous_taches', {}).keys()) or ['CIO direct']}")

                # Étape 2 : chaque agent sous-traitant exécute sa tâche
                resultats = {}
                for agent_key, tache in plan.get("sous_taches", {}).items():
                    if agent_key not in AGENTS_DEF:
                        continue
                    job_logs.append(f"[korymb] {AGENTS_DEF[agent_key]['label']} travaille...")
                    agent_sys = AGENTS_DEF[agent_key]["system"] + FLEUR_CONTEXT
                    res, ti, to = _call(client, agent_sys,
                        f"Sous-mission : {tache}\n\nContexte de la mission globale : {request.mission}")
                    t_in_total += ti; t_out_total += to
                    resultats[agent_key] = res
                    job_logs.append(f"[korymb] {AGENTS_DEF[agent_key]['label']} — terminé.")

                # Étape 3 : CIO synthétise
                job_logs.append("[korymb] CIO — synthèse finale...")
                if resultats:
                    contributions = "\n\n".join([
                        f"=== {AGENTS_DEF[k]['label']} ===\n{v}"
                        for k, v in resultats.items()
                    ])
                    synthese_user = (
                        f"Mission originale : {request.mission}\n\n"
                        f"Contributions des agents :\n{contributions}\n\n"
                        f"Produis une synthèse décisionnelle structurée et actionnable."
                    )
                    result, ti, to = _call(client, system_prompt, synthese_user)
                else:
                    # CIO répond directement si aucun agent sous-traitant
                    result, ti, to = _call(client, system_prompt, mission_txt)
                t_in_total += ti; t_out_total += to

            # ── Mode agent direct ──────────────────────────────────────────
            else:
                job_logs.append(f"[korymb] {agent_cfg['label']} travaille...")
                result, t_in_total, t_out_total = _call(client, system_prompt, mission_txt)

            _add_daily(t_in_total, t_out_total)
            active_jobs[job_id].update({
                "status": "completed", "result": result,
                "tokens_in": t_in_total, "tokens_out": t_out_total,
            })
            job_logs.append(f"[korymb] Terminé — {t_in_total}↑ {t_out_total}↓ tokens.")
            update_job(job_id, "completed", result, job_logs, t_in_total, t_out_total)
            logger.info("Job [%s] OK — %d tokens.", job_id, t_in_total + t_out_total)

        except Exception as e:
            active_jobs[job_id]["status"] = f"error: {e}"
            job_logs.append(f"[korymb] Erreur : {e}")
            update_job(job_id, f"error: {e}", None, job_logs, t_in_total, t_out_total)
            logger.error("Job [%s] échoué : %s", job_id, e)

    background_tasks.add_task(execute)
    return MissionResponse(status="accepted", job_id=job_id, agent=request.agent)


@app.post("/chat", dependencies=[Depends(verify_secret)])
async def chat(request: ChatRequest):
    agent_cfg = AGENTS_DEF.get(request.agent, AGENTS_DEF["coordinateur"])
    system_prompt = agent_cfg["system"] + FLEUR_CONTEXT + "\nRéponds de façon concise et directe."

    messages = []
    for h in request.history[-10:]:
        if h.get("role") in ("user", "assistant"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": request.message})

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        resp = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=2048,
            system=system_prompt,
            messages=messages,
        )
        _add_daily(resp.usage.input_tokens, resp.usage.output_tokens)
        return {"response": resp.content[0].text, "agent": request.agent}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/jobs/{job_id}", dependencies=[Depends(verify_secret)])
def get_job(job_id: str, log_offset: int = 0):
    job = active_jobs.get(job_id)
    if job:
        logs = job.get("logs", [])
        total = job.get("tokens_in", 0) + job.get("tokens_out", 0)
        return {
            "job_id": job_id, "status": job["status"],
            "agent": job["agent"], "mission": job["mission"],
            "result": job.get("result"),
            "logs": logs[log_offset:], "log_total": len(logs),
            "tokens_in": job.get("tokens_in", 0),
            "tokens_out": job.get("tokens_out", 0),
            "tokens_total": total,
            "cost_usd": round((job.get("tokens_in",0)*PRICE_IN + job.get("tokens_out",0)*PRICE_OUT) / 1_000_000, 5),
            "token_alert": total >= settings.token_alert_threshold,
        }
    row = db_get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job introuvable.")
    logs = row.get("logs", [])
    total = row.get("tokens_in", 0) + row.get("tokens_out", 0)
    return {
        "job_id": job_id, "status": row["status"],
        "agent": row["agent"], "mission": row["mission"],
        "result": row.get("result"),
        "logs": logs[log_offset:], "log_total": len(logs),
        "tokens_in": row.get("tokens_in", 0),
        "tokens_out": row.get("tokens_out", 0),
        "tokens_total": total,
        "cost_usd": round((row.get("tokens_in",0)*PRICE_IN + row.get("tokens_out",0)*PRICE_OUT) / 1_000_000, 5),
        "created_at": row.get("created_at"),
    }


@app.delete("/jobs/{job_id}", dependencies=[Depends(verify_secret)])
def delete_job(job_id: str):
    active_jobs.pop(job_id, None)
    from database import get_conn
    with get_conn() as conn:
        conn.execute("DELETE FROM jobs WHERE id=?", (job_id,))
        conn.commit()
    return {"deleted": job_id}

@app.delete("/jobs", dependencies=[Depends(verify_secret)])
def clear_jobs():
    active_jobs.clear()
    from database import get_conn
    with get_conn() as conn:
        conn.execute("DELETE FROM jobs")
        conn.commit()
    return {"cleared": True}

@app.get("/jobs", dependencies=[Depends(verify_secret)])
def list_jobs(limit: int = 50):
    db_jobs = {j["id"]: j for j in db_list_jobs(limit)}
    for jid, job in active_jobs.items():
        db_jobs[jid] = {"id": jid, **job, "logs": []}
    jobs = sorted(db_jobs.values(), key=lambda j: j.get("created_at", ""), reverse=True)
    return {"jobs": [{
        "job_id": j.get("id", j.get("job_id", "")),
        "agent": j["agent"], "mission": j["mission"], "status": j["status"],
        "tokens_in": j.get("tokens_in", 0), "tokens_out": j.get("tokens_out", 0),
        "created_at": j.get("created_at", ""),
    } for j in jobs[:limit]]}
