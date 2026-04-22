"""
main.py — Korymb Backend v3 — Entrypoint FastAPI.
Les domaines sont délégués à des routers modulaires (services/, routers/).
"""
from __future__ import annotations

import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv

os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

load_dotenv(Path(__file__).resolve().with_name(".env"), override=True)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from version import BACKEND_VERSION, BACKEND_REVISION_AT
from database import init_db
from state import (
    active_jobs,
    daily_tokens,
    KorymbJobCancelled,
    emit_job_event,
    publish_team,
)
from services.agents import (
    agents_def,
    refresh_agents_definitions_cache,
    delegatable_subagent_keys_ordered,
    FLEUR_CONTEXT,
    REALITY_ASSET_CONSTRAINTS,
    MODE_CADRAGE_CIO,
    MODE_CADRAGE_AGENT,
    SUB_AGENT_COORDINATION_FR,
    BUILTIN_AGENT_DEFINITIONS,
    _ascii_fold,
    canon_delegation_agent_key,
)
from auth import verify_secret

# ── Routers ───────────────────────────────────────────────────────────────────
from routers.missions import router as missions_router_phase1
from routers.config import router as config_router_phase1
from routers.agents import router as agents_router_phase1
from routers.memory import router as memory_router_phase1
from routers.core_memory import router as core_memory_router
from routers.core_config import router as core_config_router
from routers.core_agents import router as core_agents_router
from routers.core_health import router as core_health_router
from routers.core_jobs import router as core_jobs_router
from routers.core_missions import router as core_missions_router
from routers.core_chat import router as core_chat_router
from routers.core_templates import router as core_templates_router
from routers.core_scheduler import router as core_scheduler_router
from routers.core_social import router as core_social_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")
logger = logging.getLogger(__name__)
_PROCESS_STARTED_AT = time.time()

_KORYMB_BACKEND_DIR = Path(__file__).resolve().parent


# ── App FastAPI ────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    from scheduler import create_scheduler, register_db_tasks, set_scheduler
    _scheduler = create_scheduler()
    set_scheduler(_scheduler)
    if _scheduler is not None:
        register_db_tasks(_scheduler)
        _scheduler.start()
        logger.info("Scheduler autonome démarré")
    logger.info("Korymb backend démarré — build %s", BACKEND_VERSION)
    yield
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler autonome arrêté")
    logger.info("Korymb backend arrêté — build %s", BACKEND_VERSION)


app = FastAPI(title="Korymb — Moteur Agentique", version=BACKEND_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.env == "development" else [
        "https://korymb.eludein.art",
        "http://korymb.eludein.art",
        "https://api-korymb.eludein.art",
    ],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Korymb-Version"],
)

# ── Router registration ───────────────────────────────────────────────────────
app.include_router(missions_router_phase1)
app.include_router(config_router_phase1)
app.include_router(agents_router_phase1)
app.include_router(memory_router_phase1)
app.include_router(core_memory_router)
app.include_router(core_config_router)
app.include_router(core_agents_router)
app.include_router(core_health_router)
app.include_router(core_jobs_router)
app.include_router(core_missions_router)
app.include_router(core_chat_router)
app.include_router(core_templates_router)
app.include_router(core_scheduler_router)
app.include_router(core_social_router)


@app.middleware("http")
async def korymb_version_header_middleware(request, call_next):
    response = await call_next(request)
    response.headers["X-Korymb-Version"] = BACKEND_VERSION
    return response
