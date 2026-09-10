"""Vitrine publique et espace participant."""
from __future__ import annotations

from typing import Any

from services.business_db import (
    list_public_calendar_events,
    list_public_open_resources,
    list_public_resource_teasers,
    list_subscriber_sessions,
    list_subscriber_upcoming_resources,
    list_unlocked_resources,
)
from workspace_db import (
    get_workspace_by_id,
    get_workspace_by_slug,
    list_workspace_subscribers,
    public_workspace_payload,
    workspace_public_enabled,
)


def get_public_storefront(slug: str) -> dict[str, Any] | None:
    workspace = get_workspace_by_slug(slug)
    if not workspace or not workspace_public_enabled(workspace):
        return None
    payload = public_workspace_payload(workspace)
    wid = str(workspace["id"])
    payload["events"] = list_public_calendar_events(wid)
    payload["resources"] = list_public_open_resources(wid)
    payload["resources_upcoming"] = list_public_resource_teasers(wid, limit=3)
    payload.pop("logo_file_id", None)
    payload.pop("cover_file_id", None)
    return payload


def get_storefront_settings(workspace_id: str) -> dict[str, Any] | None:
    workspace = get_workspace_by_id(workspace_id)
    if not workspace:
        return None
    payload = public_workspace_payload(workspace)
    payload["subscribers"] = list_workspace_subscribers(workspace_id)
    payload["subscriber_count"] = len(payload["subscribers"])
    payload["events"] = list_public_calendar_events(str(workspace["id"]))
    payload["resources"] = list_public_open_resources(str(workspace["id"]))
    payload["resources_upcoming"] = list_public_resource_teasers(str(workspace["id"]), limit=3)
    return payload


def get_subscriber_home(
    workspace_id: str,
    *,
    viewer_email: str = "",
    viewer_user_id: str = "",
    viewer_active: bool = False,
    membership_status: str = "",
) -> dict[str, Any] | None:
    workspace = get_workspace_by_id(workspace_id)
    if not workspace:
        return None
    payload = public_workspace_payload(workspace)
    wid = str(workspace["id"])
    payload["events"] = list_subscriber_sessions(
        wid,
        viewer_email=viewer_email,
        viewer_user_id=viewer_user_id,
        viewer_active=viewer_active,
    )
    payload["resources"] = list_unlocked_resources(
        wid,
        viewer_email=viewer_email,
        viewer_user_id=viewer_user_id,
        viewer_active=viewer_active,
    )
    payload["resources_upcoming"] = list_subscriber_upcoming_resources(
        wid,
        viewer_email=viewer_email,
        viewer_user_id=viewer_user_id,
        viewer_active=viewer_active,
    )
    payload["membership_status"] = membership_status
    payload.pop("logo_file_id", None)
    payload.pop("cover_file_id", None)
    return payload
