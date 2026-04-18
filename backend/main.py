import logging
import os
import sys
import uuid
import threading
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
from crew import build_crew
from database import init_db, save_job, update_job, get_job as db_get_job, list_jobs as db_list_jobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")
logger = logging.getLogger(__name__)

# Prix Anthropic claude-sonnet-4-6 ($/M tokens)
PRICE_IN  = 3.0
PRICE_OUT = 15.0


# ── Modèles ─────────────────────────────────────────────────────────────────
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


# ── Auth ─────────────────────────────────────────────────────────────────────
api_key_header = APIKeyHeader(name="X-Agent-Secret", auto_error=True)
def verify_secret(key: str = Depends(api_key_header)) -> str:
    if key != settings.agent_api_secret:
        raise HTTPException(status_code=403, detail="Secret invalide.")
    return key


# ── État en mémoire ──────────────────────────────────────────────────────────
active_jobs: dict[str, dict] = {}
daily_tokens: dict[str, dict] = {}  # {"2026-04-18": {"in": N, "out": N}}


def _today() -> str:
    return date.today().isoformat()

def _add_daily(t_in: int, t_out: int):
    today = _today()
    if today not in daily_tokens:
        daily_tokens[today] = {"in": 0, "out": 0}
    daily_tokens[today]["in"]  += t_in
    daily_tokens[today]["out"] += t_out


# ── App ──────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("Korymb — moteur agentique démarré.")
    yield
    logger.info("Korymb — arrêt.")

app = FastAPI(title="Korymb — Moteur Agentique", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.env == "development" else [
        "https://korymb.eludein.art",
        "https://api-korymb.eludein.art",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── Routes ───────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "korymb-backend", "version": "2.0.0"}


@app.get("/agents")
def list_agents():
    return {"agents": [
        {"key": "commercial",        "label": "Commercial",         "role": "Prospection & emails",      "tools": ["web", "linkedin", "email"]},
        {"key": "community_manager", "label": "Community Manager",  "role": "Instagram & Facebook",      "tools": ["web", "instagram", "facebook"]},
        {"key": "developpeur",       "label": "Développeur",        "role": "Code & architecture",       "tools": ["web"]},
        {"key": "comptable",         "label": "Comptable",          "role": "Finances & facturation",    "tools": []},
        {"key": "coordinateur",      "label": "CIO — Orchestrateur","role": "Stratégie & délégation",    "tools": ["web", "linkedin"], "is_manager": True},
    ]}


@app.get("/tokens")
def get_tokens():
    today = _today()
    t = daily_tokens.get(today, {"in": 0, "out": 0})
    cost = (t["in"] * PRICE_IN + t["out"] * PRICE_OUT) / 1_000_000
    return {
        "today": today,
        "tokens_in":  t["in"],
        "tokens_out": t["out"],
        "total":      t["in"] + t["out"],
        "cost_usd":   round(cost, 4),
        "alert":      (t["in"] + t["out"]) >= settings.token_alert_threshold,
        "budget_exceeded": (t["in"] + t["out"]) >= settings.max_tokens_per_job * 10,
        "max_per_job": settings.max_tokens_per_job,
        "alert_threshold": settings.token_alert_threshold,
    }


@app.post("/run", response_model=MissionResponse, dependencies=[Depends(verify_secret)])
async def run_mission(request: MissionRequest, background_tasks: BackgroundTasks):
    job_id   = str(uuid.uuid4())[:8]
    job_logs: list = []
    token_counter = {"in": 0, "out": 0}
    stop_event = threading.Event()

    active_jobs[job_id] = {
        "status": "running", "agent": request.agent,
        "mission": request.mission, "result": None,
        "logs": job_logs, "tokens_in": 0, "tokens_out": 0,
    }
    save_job(job_id, request.agent, request.mission)

    def execute():
        job_logs.append(f"[korymb] Mission démarrée — agent : {request.agent}")
        if request.agent == "coordinateur":
            job_logs.append("[korymb] Mode orchestration — le CIO délègue aux agents.")
        crew = None
        try:
            crew = build_crew(
                mission=request.mission, agent_key=request.agent,
                job_logs=job_logs, token_counter=token_counter,
                context=request.context,
            )
            result = crew.kickoff()

            # Vérification budget après exécution
            total = token_counter["in"] + token_counter["out"]
            if total >= settings.max_tokens_per_job:
                job_logs.append(f"⚠️ Budget tokens dépassé ({total}/{settings.max_tokens_per_job}). Mission arrêtée.")
                active_jobs[job_id]["status"] = "error: budget_exceeded"
                update_job(job_id, "error: budget_exceeded", None, job_logs,
                           token_counter["in"], token_counter["out"])
            else:
                active_jobs[job_id]["status"]     = "completed"
                active_jobs[job_id]["result"]     = str(result)
                active_jobs[job_id]["tokens_in"]  = token_counter["in"]
                active_jobs[job_id]["tokens_out"] = token_counter["out"]
                job_logs.append(f"[korymb] Mission terminée. Tokens : {token_counter['in']}↑ {token_counter['out']}↓")
                update_job(job_id, "completed", str(result), job_logs,
                           token_counter["in"], token_counter["out"])

            _add_daily(token_counter["in"], token_counter["out"])
            logger.info("Job [%s] terminé. Tokens : %d in / %d out", job_id, token_counter["in"], token_counter["out"])

        except Exception as e:
            active_jobs[job_id]["status"] = f"error: {e}"
            job_logs.append(f"[korymb] Erreur : {e}")
            update_job(job_id, f"error: {e}", None, job_logs, token_counter["in"], token_counter["out"])
            _add_daily(token_counter["in"], token_counter["out"])
            logger.error("Job [%s] échoué : %s", job_id, e)
        finally:
            if crew and hasattr(crew, "_korymb_cleanup"):
                crew._korymb_cleanup()

    background_tasks.add_task(execute)
    return MissionResponse(status="accepted", job_id=job_id, agent=request.agent)


@app.post("/chat", dependencies=[Depends(verify_secret)])
async def chat(request: ChatRequest):
    """
    Chat direct avec un agent (réponse synchrone, pas de job en arrière-plan).
    Idéal pour questions rapides, brainstorming, feedback immédiat.
    """
    import anthropic
    from agents import AGENTS

    from knowledge import FLEUR_CONTEXT, _MANUEL
    agent_def = AGENTS.get(request.agent) or AGENTS["coordinateur"]

    # Contexte Fleur d'Amours complet injecté dans chaque conversation
    knowledge_context = (
        f"\n\n---\n## BASE DE CONNAISSANCE FLEUR D'AMOURS\n"
        f"{FLEUR_CONTEXT}\n\n"
        f"### Manuel (extrait — {len(_MANUEL)} caractères disponibles) :\n"
        f"{_MANUEL[:6000]}\n---"
    )

    system_prompt = (
        f"{agent_def.backstory}"
        f"{knowledge_context}\n\n"
        "Réponds de façon concise et directe en t'appuyant sur cette base de connaissance. "
        "Tu es dans un chat interactif."
    )

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
        text = resp.content[0].text
        _add_daily(resp.usage.input_tokens, resp.usage.output_tokens)
        return {"response": text, "agent": request.agent}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/jobs/{job_id}", dependencies=[Depends(verify_secret)])
def get_job(job_id: str, log_offset: int = 0):
    job = active_jobs.get(job_id)
    if job:
        logs = job.get("logs", [])
        total = job.get("tokens_in", 0) + job.get("tokens_out", 0)
        return {
            "job_id":     job_id,
            "status":     job["status"],
            "agent":      job["agent"],
            "mission":    job["mission"],
            "result":     job.get("result"),
            "logs":       logs[log_offset:],
            "log_total":  len(logs),
            "tokens_in":  job.get("tokens_in", 0),
            "tokens_out": job.get("tokens_out", 0),
            "tokens_total": total,
            "cost_usd":   round((job.get("tokens_in",0)*PRICE_IN + job.get("tokens_out",0)*PRICE_OUT) / 1_000_000, 5),
            "token_alert": total >= settings.token_alert_threshold,
        }
    row = db_get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job introuvable.")
    logs = row.get("logs", [])
    total = row.get("tokens_in", 0) + row.get("tokens_out", 0)
    return {
        "job_id":     job_id,
        "status":     row["status"],
        "agent":      row["agent"],
        "mission":    row["mission"],
        "result":     row.get("result"),
        "logs":       logs[log_offset:],
        "log_total":  len(logs),
        "tokens_in":  row.get("tokens_in", 0),
        "tokens_out": row.get("tokens_out", 0),
        "tokens_total": total,
        "cost_usd":   round((row.get("tokens_in",0)*PRICE_IN + row.get("tokens_out",0)*PRICE_OUT) / 1_000_000, 5),
        "created_at": row.get("created_at"),
    }


@app.get("/jobs", dependencies=[Depends(verify_secret)])
def list_jobs(limit: int = 50):
    db_jobs = {j["id"]: j for j in db_list_jobs(limit)}
    for jid, job in active_jobs.items():
        db_jobs[jid] = {"id": jid, **job, "logs": []}
    jobs = sorted(db_jobs.values(), key=lambda j: j.get("created_at", ""), reverse=True)
    return {"jobs": [{
        "job_id":     j.get("id", j.get("job_id", "")),
        "agent":      j["agent"],
        "mission":    j["mission"],
        "status":     j["status"],
        "tokens_in":  j.get("tokens_in", 0),
        "tokens_out": j.get("tokens_out", 0),
        "created_at": j.get("created_at", ""),
    } for j in jobs[:limit]]}
