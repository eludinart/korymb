"""API science-facts / science-entities — édition grand public Identité + Dirigeant."""
from __future__ import annotations


def test_put_and_delete_science_facts(client):
    put = client.put(
        "/business/science-facts",
        json={
            "facts": {
                "brand": "Mer et Découverte",
                "boats": ["Cigno Nero", "ILYAKA"],
                "org": {"Tronc principal": "Cédric", "Vie pro": "maritime"},
            }
        },
    )
    assert put.status_code == 200, put.text
    facts = put.json()["facts"]
    assert facts["brand"] == "Mer et Découverte"
    assert facts["boats"] == ["Cigno Nero", "ILYAKA"]
    assert isinstance(facts["org"], str)
    assert "Cédric" in facts["org"]
    assert "{" not in facts["org"]

    overview = client.get("/business/science-overview")
    assert overview.status_code == 200
    ov_facts = overview.json()["facts"]
    assert ov_facts["brand"] == "Mer et Découverte"
    assert "{" not in str(ov_facts.get("org") or "")

    deleted = client.delete("/business/science-facts/boats")
    assert deleted.status_code == 200
    assert "boats" not in deleted.json()["facts"]


def test_put_custom_section(client):
    res = client.put(
        "/business/science-facts",
        json={"facts": {"Vision 2026": "Développer les sorties mer"}},
    )
    assert res.status_code == 200, res.text
    facts = res.json()["facts"]
    assert any("vision" in k for k in facts)
    assert "Développer les sorties mer" in facts.values()


def test_upsert_science_person(client):
    res = client.post(
        "/business/science-entities",
        json={
            "name": "Cédric",
            "entity_type": "person",
            "attributes": {"role": "Dirigeant", "focus": "Organisation & IA"},
        },
    )
    assert res.status_code == 200, res.text
    entity = res.json()["entity"]
    assert entity["name"] == "Cédric"
    assert entity["entity_type"] == "person"
    persons = client.get("/business/science-overview").json().get("persons") or []
    assert any(p.get("name") == "Cédric" for p in persons)


def test_normalize_dict_string_display():
    from services.science_facts import format_fact_for_display, normalize_fact_value

    assert "Cédric" in (normalize_fact_value({"Tronc principal": "Cédric"}) or "")
    ugly = "{'Tronc principal': 'Cédric', 'Vie': ''}"
    shown = format_fact_for_display(ugly)
    assert "Cédric" in shown
    assert "{" not in shown
