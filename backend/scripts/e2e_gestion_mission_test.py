"""Mission E2E : commercial + outils gestion_* (prospection test)."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / "backend" / ".env"
BASE = os.getenv("KORYMB_API_BASE", "http://127.0.0.1:8020")


def _load_secret() -> str:
    if os.getenv("AGENT_API_SECRET"):
        return os.getenv("AGENT_API_SECRET", "").strip()
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("AGENT_API_SECRET="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("AGENT_API_SECRET introuvable")


MISSION = """
[Test intégration Gestion Korymb — NE PAS utiliser web_search ni search_linkedin]

Exécute uniquement les outils gestion_* dans cet ordre :
1) gestion_search_contacts query "Coach Test Integration"
2) gestion_upsert_contact : name "Coach Test Integration", email "coach.integration.test@eludein.art",
   company "Cabinet bien-être Var", contact_type prospect, tags [test, coach, var],
   profile_notes "Prospect test E2E — coach accompagnement, angle Fleur d'ÅmÔurs module Pro."
3) gestion_log_interaction type prospection, summary "Mission test prospection E2E Korymb"
4) gestion_create_quote : title "Module Pro — test E2E",
   lines_json [{"label":"Formation 1 jour","qty":1,"unit_price_cents":60000,"tax_rate":0}]
5) gestion_list_interactions pour le contact

Termine par #### LIVRABLE — Test intégration Gestion avec id contact, numéro devis et résumé.
""".strip()


def main() -> int:
    secret = _load_secret()
    headers = {"X-Agent-Secret": secret, "Content-Type": "application/json"}
    client = httpx.Client(base_url=BASE, headers=headers, timeout=120.0)

    health = client.get("/health").json()
    print(f"Health: {health.get('status')} v{health.get('version')}")

    payload = {
        "mission": MISSION,
        "agent": "commercial",
        "mission_config": {
            "mode": "single",
            "cio_plan_hitl_enabled": False,
            "require_user_validation": False,
            "recursive_refinement_enabled": False,
        },
    }
    run = client.post("/run", json=payload).json()
    job_id = run["job_id"]
    print(f"Job lancé: {job_id} agent={run.get('agent')}")

    status = ""
    job: dict = {}
    deadline = time.time() + 8 * 60
    while time.time() < deadline:
        time.sleep(6)
        job = client.get(f"/jobs/{job_id}").json()
        status = str(job.get("status") or "")
        tools = sorted({
            (e.get("payload") or {}).get("tool")
            for e in (job.get("events") or [])
            if e.get("type") == "tool_call" and (e.get("payload") or {}).get("tool")
        })
        print(f"  status={status} tools={', '.join(tools) or '—'}")
        if status in ("done", "failed", "cancelled", "error", "completed"):
            break

    result = (job.get("result") or "")[:1200]
    if result:
        print("--- Résultat (extrait) ---")
        print(result.encode("utf-8", errors="replace").decode("utf-8"))

    contacts = client.get("/business/contacts").json().get("contacts") or []
    match = next((c for c in contacts if c.get("email") == "coach.integration.test@eludein.art"), None)
    ok_contact = bool(match)
    if match:
        print(f"Contact OK: {match['id']} / {match['name']}")
        ints = client.get("/business/interactions", params={"contact_id": match["id"]}).json()
        rows = ints.get("interactions") or []
        print(f"Interactions: {len(rows)}")
        for row in rows[:5]:
            print(
                f"  - {row.get('interaction_type')}: {row.get('summary')} "
                f"[job={row.get('job_id')} agent={row.get('agent_key')}]"
            )
        job_linked = any(str(r.get("job_id") or "") == job_id for r in rows)
    else:
        print("Contact test NON trouvé")
        job_linked = False

    quotes = client.get("/business/quotes").json().get("quotes") or []
    qmatch = next(
        (q for q in quotes if "test E2E" in (q.get("title") or "") or "test e2e" in (q.get("title") or "").lower()),
        None,
    )
    ok_quote = bool(qmatch)
    if qmatch:
        print(f"Devis OK: {qmatch.get('quote_number')} total={qmatch.get('total_cents')}")

    gestion_tools = {
        t for t in {
            (e.get("payload") or {}).get("tool")
            for e in (job.get("events") or [])
            if e.get("type") == "tool_call"
        }
        if t and str(t).startswith("gestion_")
    }
    print(f"Outils gestion_* appelés: {sorted(gestion_tools)}")
    print(f"FIN job={job_id} status={status}")

    success = (
        status in ("done", "completed")
        and ok_contact
        and ok_quote
        and len(gestion_tools) >= 2
        and job_linked
    )
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
