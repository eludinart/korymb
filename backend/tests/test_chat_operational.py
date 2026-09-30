"""Heuristiques chat : QCM sur demande, conclusion forcée."""
from __future__ import annotations

from services.chat_intelligence import user_forces_direct_answer, user_wants_choice_questionnaire


def test_user_wants_choice_questionnaire():
    assert user_wants_choice_questionnaire("Fais-moi un QCM pour choisir")
    assert user_wants_choice_questionnaire("fait moi un qcm pour me simplifier la tache")
    assert user_wants_choice_questionnaire("questionnaire avec cases à cocher")
    assert not user_wants_choice_questionnaire("Que faire aujourd'hui pour Korymb ?")
    assert not user_wants_choice_questionnaire(
        "Donne-moi 5 priorités concrètes pour aujourd'hui sur Korymb, sans questionnaire."
    )


def test_user_forces_direct_answer():
    assert user_forces_direct_answer("et alors ?")
    assert user_forces_direct_answer("réponds sans questions")
    assert user_forces_direct_answer(
        "Donne-moi 5 priorités concrètes pour aujourd'hui sur Korymb, sans questionnaire."
    )
    assert user_forces_direct_answer("go")
    assert not user_forces_direct_answer("quelles options as-tu ?")
