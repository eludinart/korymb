---
name: eludein-agent-bus
category: devops
description: Poll le bus Korymb agent_bus ; notifier Telegram les messages to=hermes ou to=* ; ne pas done les messages destinés à grokbot/cursor.
---

# Agent bus Élude

## Quand

À chaque briefing / alerte, ou sur demande « messages bus ».

## Faire

1. `korymb-api.sh GET '/agent-bus/messages?to=hermes&status=open'`
2. `korymb-api.sh GET '/agent-bus/messages?to=*&status=open'`
3. Résumer sur Telegram (chat ops) : topic + from + extrait body + id
4. Si le message te demande une action ops readonly : exécuter, puis `done` avec comment
5. **Ne pas** `done` un message `to=grokbot` ou `to=cursor`

## Ne pas faire

- Valider HITL `/actions/{id}/resolve`
- Poster des secrets dans le body bus
