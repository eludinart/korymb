"""Délégation sélective CIO — les sous-agents ne partent que si le CIO ou le dirigeant le demande explicitement."""
from __future__ import annotations

from services.mission import (
    _direct_answer_looks_fabricated,
    _explicitly_requested_sub_agents,
    _has_executable_subagent_tasks,
    _inject_sous_taches_for_mentioned_agents,
    _lazy_delegation_blocks_auto_delegation,
    _materialize_subagents_when_plan_empty,
    _mentioned_sub_agents,
    _mission_needs_grounded_execution,
    _mission_requires_delegation,
    _mission_suggests_commercial,
    _mission_wants_contact_table,
)


def test_mentioned_sub_agents_detects_thematic_words():
    blob = "strategie commerciale pour les ateliers tarot"
    assert "commercial" in _mentioned_sub_agents(blob)


def test_explicit_request_ignores_thematic_mention():
    blob = "strategie commerciale pour les ateliers tarot sur le bateau"
    assert _explicitly_requested_sub_agents(blob) == []


def test_explicit_request_detects_direct_order():
    blob = "demande au commercial de trouver trois pistes linkedin"
    assert "commercial" in _explicitly_requested_sub_agents(blob)


def test_inject_selective_skips_thematic_mention():
    st: dict = {}
    logs: list[str] = []

    def log(msg: str) -> None:
        logs.append(msg)

    _inject_sous_taches_for_mentioned_agents(
        st,
        "Pense à la stratégie commerciale des ateliers",
        "Ateliers tarot",
        log,
        selective=True,
    )
    assert not _has_executable_subagent_tasks(st)
    assert logs == []


def test_inject_selective_adds_on_explicit_order():
    st: dict = {}
    logs: list[str] = []

    def log(msg: str) -> None:
        logs.append(msg)

    _inject_sous_taches_for_mentioned_agents(
        st,
        "Demande au commercial de lister 5 prospects coaches",
        "Prospection coaches",
        log,
        selective=True,
    )
    assert "commercial" in st
    assert _has_executable_subagent_tasks(st)
    assert any("sollicitation explicite" in x for x in logs)


def test_inject_non_selective_keeps_legacy_mention():
    st: dict = {}
    logs: list[str] = []

    def log(msg: str) -> None:
        logs.append(msg)

    _inject_sous_taches_for_mentioned_agents(
        st,
        "strategie commerciale ateliers",
        "Ateliers",
        log,
        selective=False,
    )
    assert "commercial" in st


def test_mission_requires_delegation_for_resalib_exploration():
    mission = (
        "Pas encore pour le Mail explore les profils de coach de thérapeute "
        "sur les réseaux coaching et resalib"
    )
    assert _mission_needs_grounded_execution(mission)
    assert _mission_requires_delegation(mission, mission)


def test_mission_requires_delegation_for_regenerate_table():
    assert _mission_requires_delegation("regenere le tableau", "regenere le tableau")


def test_direct_answer_rejects_xxxxx_placeholder_link():
    fake = "accessible via https://drive.google.com/file/d/XXXXX (remplacer XXXXX par l'ID réel)."
    assert _direct_answer_looks_fabricated(fake, [])


def test_direct_answer_rejects_fake_google_sheet_link():
    fake = (
        '**Lien** : [Tableau](https://docs.google.com/spreadsheets/d/1example/edit) '
        "*(remplacer par le lien réel après création)*"
    )
    assert _direct_answer_looks_fabricated(fake, [])
    realish = "**Lien** : https://docs.google.com/spreadsheets/d/abcRealId/edit"
    assert not _direct_answer_looks_fabricated(
        realish,
        ["[outil] upload_google_drive → ✅ Fichier Drive créé"],
    )
    assert _direct_answer_looks_fabricated(realish, [])


def test_lazy_delegation_bypassed_for_resalib_regenerate_table():
    mission = (
        "Prospection de 20 coachs-thérapeutes sur Resalib en PACA, "
        "avec nom, prenom, contact mail, tel — Régénère le tableau prospection"
    )
    assert not _lazy_delegation_blocks_auto_delegation(mission, mission, lazy_delegation=True)
    assert _mission_suggests_commercial(mission)

    st: dict = {}
    plan = {"agents": [], "sous_taches": {}}
    logs: list[str] = []

    def log(msg: str) -> None:
        logs.append(msg)

    _materialize_subagents_when_plan_empty(st, plan, mission, mission, log)
    assert _has_executable_subagent_tasks(st)
    assert "commercial" in st


def test_mission_wants_contact_table_detects_prospection_with_fields():
    mission = (
        "Prospection de 20 coachs-thérapeutes sur Resalib en PACA, "
        "avec nom, prenom, contact mail, tel — Régénère le tableau prospection"
    )
    assert _mission_wants_contact_table(mission)


def test_mission_wants_contact_table_ignores_plain_question():
    assert not _mission_wants_contact_table("Quelle heure est-il à Paris ?")
    assert not _mission_wants_contact_table("Rédige un post LinkedIn inspirant")
