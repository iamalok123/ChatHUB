from __future__ import annotations

import json
import sqlite3

from fastapi.testclient import TestClient

from tests.helpers import (
    REQUEST_HEADERS,
    create_space,
    signup,
    stream_chat,
)


def _main_branch(client: TestClient, space_id: str) -> dict:
    response = client.get(f"/api/spaces/{space_id}/branches")
    assert response.status_code == 200, response.text
    return next(
        branch for branch in response.json() if branch["parent_branch_id"] is None
    )


def _add_memory(
    client: TestClient,
    branch_id: str,
    content: str,
    *,
    kind: str = "fact",
    importance: float = 0.8,
) -> dict:
    response = client.post(
        f"/api/branches/{branch_id}/memories",
        json={"content": content, "kind": kind, "importance": importance},
        headers=REQUEST_HEADERS,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _memories(client: TestClient, branch_id: str) -> dict:
    response = client.get(f"/api/branches/{branch_id}/memories")
    assert response.status_code == 200, response.text
    return response.json()


def _contents(payload: dict) -> set[str]:
    return {item["content"] for item in payload["memories"]}


def _messages(client: TestClient, branch_id: str) -> list[dict]:
    response = client.get(f"/api/branches/{branch_id}/messages")
    assert response.status_code == 200, response.text
    return response.json()


def _done(events: list[dict]) -> dict:
    return next(event["data"] for event in events if event["event"] == "done")


def test_fork_preview_and_fork_at_message_with_choices(client: TestClient) -> None:
    signup(client)
    space = create_space(client)
    main = _main_branch(client, space["id"])
    pinned = _add_memory(client, main["id"], "The user prefers short answers")

    status, events = stream_chat(client, main["id"], "First question")
    assert status == 200
    first = _done(events)

    status, events = stream_chat(client, main["id"], "Second question")
    assert status == 200
    second = _done(events)

    preview = client.get(
        f"/api/branches/{main['id']}/fork-preview",
        params={"commit_id": first["assistant_commit_id"]},
    )
    assert preview.status_code == 200, preview.text
    assert {item["id"] for item in preview.json()["memories"]} == {pinned["id"]}

    response = client.post(
        f"/api/branches/{main['id']}/fork",
        json={
            "name": "Focused",
            "commit_id": first["assistant_commit_id"],
            "exclude_memory_ids": [pinned["id"]],
        },
        headers=REQUEST_HEADERS,
    )
    assert response.status_code == 201, response.text
    child = response.json()
    assert child["parent_branch_id"] == main["id"]
    assert child["fork_commit_id"] == first["assistant_commit_id"]
    assert child["message_count"] == 2
    assert _contents(_memories(client, child["id"])) == set()

    pinned_fork = client.post(
        f"/api/branches/{main['id']}/fork",
        json={
            "name": "Pinned",
            "commit_id": second["assistant_commit_id"],
            "pin_memory_ids": [pinned["id"]],
        },
        headers=REQUEST_HEADERS,
    )
    assert pinned_fork.status_code == 201, pinned_fork.text
    pinned_child = _memories(client, pinned_fork.json()["id"])
    pinned_item = next(
        item for item in pinned_child["memories"] if item["id"] == pinned["id"]
    )
    assert pinned_item["pinned"] is True
    assert pinned_item["inherited"] is True

    unpinned_fork = client.post(
        f"/api/branches/{pinned_fork.json()['id']}/fork",
        json={
            "name": "Unpinned",
            "unpin_memory_ids": [pinned["id"]],
        },
        headers=REQUEST_HEADERS,
    )
    assert unpinned_fork.status_code == 201, unpinned_fork.text
    unpinned_item = next(
        item
        for item in _memories(client, unpinned_fork.json()["id"])["memories"]
        if item["id"] == pinned["id"]
    )
    assert unpinned_item["pinned"] is False

    overlap = client.post(
        f"/api/branches/{main['id']}/fork",
        json={
            "name": "Contradictory",
            "pin_memory_ids": [pinned["id"]],
            "unpin_memory_ids": [pinned["id"]],
        },
        headers=REQUEST_HEADERS,
    )
    assert overlap.status_code == 422
    later = _add_memory(client, main["id"], "Created after the fork point")
    assert later["content"] not in _contents(_memories(client, child["id"]))


def test_merge_only_selected_memories_and_never_messages(
    client: TestClient, db: sqlite3.Connection
) -> None:
    signup(client)
    space = create_space(client)
    main = _main_branch(client, space["id"])
    status, events = stream_chat(client, main["id"], "Main conversation")
    assert status == 200
    assert _done(events)
    child_response = client.post(
        f"/api/branches/{main['id']}/fork",
        json={"name": "Feature"},
        headers=REQUEST_HEADERS,
    )
    assert child_response.status_code == 201, child_response.text
    child = child_response.json()
    status, events = stream_chat(client, child["id"], "Child conversation")
    assert status == 200
    assert _done(events)

    keep = _add_memory(client, child["id"], "Decision: use SQLite WAL")
    skip = _add_memory(client, child["id"], "Task: sketch the graph view")
    main_messages_before = _messages(client, main["id"])
    child_messages = _messages(client, child["id"])
    assert child_messages

    preview = client.get(
        f"/api/branches/{child['id']}/merge-preview",
        params={"target": main["id"]},
    )
    assert preview.status_code == 200, preview.text
    assert {item["id"] for item in preview.json()["memories"]} >= {
        keep["id"],
        skip["id"],
    }

    merged = client.post(
        f"/api/branches/{child['id']}/merge",
        json={"target_branch_id": main["id"], "memory_ids": [keep["id"]]},
        headers=REQUEST_HEADERS,
    )
    assert merged.status_code == 200, merged.text
    result = merged.json()
    assert result["copied_count"] == 1
    assert len(_messages(client, main["id"])) == len(main_messages_before)

    main_memories = _memories(client, main["id"])
    assert keep["content"] in _contents(main_memories)
    assert skip["content"] not in _contents(main_memories)
    copied = next(
        item for item in main_memories["memories"] if item["content"] == keep["content"]
    )
    assert copied["origin_branch_id"] == main["id"]
    assert copied["derived_from_id"] == keep["id"]

    commit = db.execute(
        "SELECT * FROM commits WHERE id = ?", (result["merge_commit_id"],)
    ).fetchone()
    assert commit is not None
    assert commit["role"] == "merge"
    assert commit["source_branch_id"] == child["id"]

    duplicate = client.post(
        f"/api/branches/{child['id']}/merge",
        json={"target_branch_id": main["id"], "memory_ids": [keep["id"]]},
        headers=REQUEST_HEADERS,
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "nothing_to_merge"

    summary_only = client.post(
        f"/api/branches/{child['id']}/merge",
        json={
            "target_branch_id": main["id"],
            "memory_ids": [],
            "summary": "No new memories to promote.",
        },
        headers=REQUEST_HEADERS,
    )
    assert summary_only.status_code == 200, summary_only.text
    assert summary_only.json()["copied_count"] == 0

    downward = client.post(
        f"/api/branches/{main['id']}/merge",
        json={"target_branch_id": child["id"], "memory_ids": [keep["id"]]},
        headers=REQUEST_HEADERS,
    )
    assert downward.status_code == 422
    assert downward.json()["error"]["code"] == "invalid_merge_target"

    summary = client.post(
        f"/api/branches/{child['id']}/merge-summary",
        json={"target_branch_id": main["id"], "memory_ids": [skip["id"]]},
        headers=REQUEST_HEADERS,
    )
    assert summary.status_code == 200, summary.text
    assert summary.json()["mock"] is True
    assert skip["content"] in summary.json()["summary"]


def test_sync_pulls_post_fork_parent_memories(client: TestClient) -> None:
    signup(client)
    space = create_space(client)
    main = _main_branch(client, space["id"])
    child_response = client.post(
        f"/api/branches/{main['id']}/fork",
        json={"name": "Child"},
        headers=REQUEST_HEADERS,
    )
    assert child_response.status_code == 201, child_response.text
    child = child_response.json()
    child_messages_before = _messages(client, child["id"])

    status, _events = stream_chat(client, main["id"], "Parent message after fork")
    assert status == 200
    fresh = _add_memory(client, main["id"], "Parent memory added after the fork")
    preview = client.get(f"/api/branches/{child['id']}/sync-preview")
    assert preview.status_code == 200, preview.text
    assert fresh["id"] in {item["id"] for item in preview.json()["memories"]}

    synced = client.post(
        f"/api/branches/{child['id']}/sync",
        json={"memory_ids": [fresh["id"]]},
        headers=REQUEST_HEADERS,
    )
    assert synced.status_code == 200, synced.text
    result = synced.json()
    assert result["copied_count"] == 1
    assert fresh["content"] in _contents(_memories(client, child["id"]))
    assert len(_messages(client, child["id"])) == len(child_messages_before)

    again = client.post(
        f"/api/branches/{child['id']}/sync",
        json={"memory_ids": [fresh["id"]]},
        headers=REQUEST_HEADERS,
    )
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "nothing_to_sync"

    root = client.get(f"/api/branches/{main['id']}/sync-preview")
    assert root.status_code == 409
    assert root.json()["error"]["code"] == "root_has_no_parent"


def test_diff_reports_memory_and_message_divergence(client: TestClient) -> None:
    signup(client)
    space = create_space(client)
    main = _main_branch(client, space["id"])
    removed = _add_memory(client, main["id"], "Old decision to remove")
    changed = _add_memory(client, main["id"], "Preference: use tabs")
    child_response = client.post(
        f"/api/branches/{main['id']}/fork",
        json={"name": "Diff child"},
        headers=REQUEST_HEADERS,
    )
    assert child_response.status_code == 201, child_response.text
    child = child_response.json()

    excluded = client.post(
        f"/api/branches/{child['id']}/memories/{removed['id']}/override",
        json={"action": "exclude"},
        headers=REQUEST_HEADERS,
    )
    assert excluded.status_code == 200, excluded.text
    edited = client.post(
        f"/api/branches/{child['id']}/memories/{changed['id']}/override",
        json={"action": "edit", "content": "Preference: use spaces"},
        headers=REQUEST_HEADERS,
    )
    assert edited.status_code == 200, edited.text
    added = _add_memory(client, child["id"], "New child decision")

    stream_chat(client, main["id"], "Parent message after fork")
    status, child_events = stream_chat(client, child["id"], "Child message after fork")
    assert status == 200
    assert _done(child_events)

    response = client.get(
        f"/api/branches/{child['id']}/diff", params={"against": main["id"]}
    )
    assert response.status_code == 200, response.text
    diff = response.json()
    assert diff["against_branch_id"] == main["id"]
    assert diff["added_count"] == 1
    assert diff["added"][0]["content"] == added["content"]
    assert diff["removed_count"] == 1
    assert diff["removed"][0]["content"] == removed["content"]
    assert diff["changed_count"] == 1
    assert diff["changed"][0]["before"]["content"] == changed["content"]
    assert diff["changed"][0]["after"]["content"] == "Preference: use spaces"
    assert diff["messages_added_count"] > 0
    assert diff["messages_upstream_count"] > 0

    invalid = client.get(
        f"/api/branches/{child['id']}/diff", params={"against": child["id"]}
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "invalid_diff_target"


def test_checkpoints_create_list_and_fork(client: TestClient) -> None:
    signup(client)
    space = create_space(client)
    main = _main_branch(client, space["id"])
    status, events = stream_chat(client, main["id"], "Checkpoint this")
    assert status == 200
    done = _done(events)

    created = client.post(
        f"/api/branches/{main['id']}/checkpoints",
        json={"name": "baseline", "commit_id": done["assistant_commit_id"]},
        headers=REQUEST_HEADERS,
    )
    assert created.status_code == 201, created.text
    checkpoint = created.json()
    assert checkpoint["commit_id"] == done["assistant_commit_id"]
    assert checkpoint["commit_role"] == "assistant"

    listed = client.get(f"/api/branches/{main['id']}/checkpoints")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [checkpoint["id"]]

    forked = client.post(
        f"/api/branches/{main['id']}/checkpoints/{checkpoint['id']}/fork",
        headers=REQUEST_HEADERS,
    )
    assert forked.status_code == 201, forked.text
    child = forked.json()
    assert child["parent_branch_id"] == main["id"]
    assert child["name"] == "baseline"
    assert child["fork_commit_id"] == checkpoint["commit_id"]
    assert child["message_count"] == 2

    invalid = client.post(
        f"/api/branches/{main['id']}/checkpoints",
        json={"name": "missing", "commit_id": "does-not-exist"},
        headers=REQUEST_HEADERS,
    )
    assert invalid.status_code == 404


def test_branch_rename_archive_and_root_protection(client: TestClient) -> None:
    signup(client)
    space = create_space(client)
    main = _main_branch(client, space["id"])
    child_response = client.post(
        f"/api/branches/{main['id']}/fork",
        json={"name": "Feature work"},
        headers=REQUEST_HEADERS,
    )
    assert child_response.status_code == 201, child_response.text
    child = child_response.json()

    root_archive = client.patch(
        f"/api/branches/{main['id']}",
        json={"archived": True},
        headers=REQUEST_HEADERS,
    )
    assert root_archive.status_code == 409
    assert root_archive.json()["error"]["code"] == "root_branch_protected"

    renamed = client.patch(
        f"/api/branches/{child['id']}",
        json={"name": "Renamed feature"},
        headers=REQUEST_HEADERS,
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Renamed feature"

    archived = client.patch(
        f"/api/branches/{child['id']}",
        json={"archived": True},
        headers=REQUEST_HEADERS,
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["archived"] is True
    listed = client.get(f"/api/spaces/{space['id']}/branches")
    assert listed.status_code == 200
    stored = next(branch for branch in listed.json() if branch["id"] == child["id"])
    assert stored["archived"] is True

    restored = client.patch(
        f"/api/branches/{child['id']}",
        json={"archived": False},
        headers=REQUEST_HEADERS,
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["archived"] is False

    signup(
        client,
        email="grace@example.com",
        password="another correct horse",
        display_name="Grace",
    )
    foreign = client.patch(
        f"/api/branches/{child['id']}",
        json={"name": "Not mine"},
        headers=REQUEST_HEADERS,
    )
    assert foreign.status_code == 404


def test_operations_hide_foreign_branches(client: TestClient) -> None:
    signup(client)
    first_space = create_space(client, "First user space")
    first_main = _main_branch(client, first_space["id"])

    signup(
        client,
        email="grace@example.com",
        password="another correct horse",
        display_name="Grace",
    )
    second_space = create_space(client, "Second user space")
    second_main = _main_branch(client, second_space["id"])

    preview = client.get(
        f"/api/branches/{first_main['id']}/fork-preview",
        params={"commit_id": first_main["head_commit_id"]},
    )
    assert preview.status_code == 404

    fork_response = client.post(
        f"/api/branches/{first_main['id']}/fork",
        json={"name": "Foreign"},
        headers=REQUEST_HEADERS,
    )
    assert fork_response.status_code == 404

    merge_response = client.post(
        f"/api/branches/{second_main['id']}/merge",
        json={"target_branch_id": first_main["id"], "memory_ids": ["missing"]},
        headers=REQUEST_HEADERS,
    )
    assert merge_response.status_code == 404

    checkpoint_list = client.get(f"/api/branches/{first_main['id']}/checkpoints")
    assert checkpoint_list.status_code == 404

    diff_response = client.get(
        f"/api/branches/{second_main['id']}/diff",
        params={"against": first_main["id"]},
    )
    assert diff_response.status_code == 404

    exported = client.get(f"/api/spaces/{first_space['id']}/export")
    assert exported.status_code == 404


def test_export_tolerates_deleted_merge_source(client: TestClient) -> None:
    signup(client)
    space = create_space(client)
    main = _main_branch(client, space["id"])
    child_response = client.post(
        f"/api/branches/{main['id']}/fork",
        json={"name": "Temporary source"},
        headers=REQUEST_HEADERS,
    )
    assert child_response.status_code == 201, child_response.text
    child = child_response.json()
    memory = _add_memory(client, child["id"], "A memory promoted before cleanup")

    merged = client.post(
        f"/api/branches/{child['id']}/merge",
        json={"target_branch_id": main["id"], "memory_ids": [memory["id"]]},
        headers=REQUEST_HEADERS,
    )
    assert merged.status_code == 200, merged.text
    deleted = client.delete(
        f"/api/branches/{child['id']}", headers=REQUEST_HEADERS
    )
    assert deleted.status_code == 204

    exported = client.get(f"/api/spaces/{space['id']}/export")
    assert exported.status_code == 200, exported.text
    data = exported.json()
    merge_commit = next(
        commit
        for commit in data["commits"]
        if commit["id"] == merged.json()["merge_commit_id"]
    )
    assert merge_commit["source_branch_id"] == child["id"]
    assert child["id"] not in {branch["id"] for branch in data["branches"]}

    imported = client.post(
        "/api/spaces/import", json=data, headers=REQUEST_HEADERS
    )
    assert imported.status_code == 201, imported.text
    new_space = imported.json()["space"]["id"]
    new_main = _main_branch(client, new_space)
    assert memory["content"] in _contents(_memories(client, new_main["id"]))


def test_export_import_roundtrip_remaps_ids(client: TestClient) -> None:
    signup(client)
    space = create_space(client, "Exported space")
    main = _main_branch(client, space["id"])
    status, events = stream_chat(client, main["id"], "Keep this conversation")
    assert status == 200
    _done(events)
    memory = _add_memory(client, main["id"], "Portable memory")
    child_response = client.post(
        f"/api/branches/{main['id']}/fork",
        json={"name": "Portable child", "pin_memory_ids": [memory["id"]]},
        headers=REQUEST_HEADERS,
    )
    assert child_response.status_code == 201, child_response.text
    child = child_response.json()
    checkpoint = client.post(
        f"/api/branches/{child['id']}/checkpoints",
        json={"name": "portable-point"},
        headers=REQUEST_HEADERS,
    )
    assert checkpoint.status_code == 201, checkpoint.text

    exported = client.get(f"/api/spaces/{space['id']}/export")
    assert exported.status_code == 200, exported.text
    data = exported.json()
    assert data["version"] == 1
    assert "owner_id" not in json.dumps(data)
    original_counts = (
        len(data["branches"]),
        len(data["commits"]),
        len(data["memories"]),
        len(data["overrides"]),
        len(data["proposals"]),
        len(data["checkpoints"]),
    )

    imported = client.post(
        "/api/spaces/import", json=data, headers=REQUEST_HEADERS
    )
    assert imported.status_code == 201, imported.text
    result = imported.json()
    assert result["space"]["id"] != space["id"]
    assert result["branch_count"] == original_counts[0]
    assert result["commit_count"] == original_counts[1]
    assert result["memory_count"] == original_counts[2]

    new_id = result["space"]["id"]
    new_branches = {
        branch["name"]: branch
        for branch in client.get(f"/api/spaces/{new_id}/branches").json()
    }
    assert set(new_branches) == {"main", "Portable child"}
    assert all(
        branch["id"] not in {main["id"], child["id"]}
        for branch in new_branches.values()
    )
    assert new_branches["Portable child"]["parent_branch_id"] == new_branches["main"]["id"]
    assert new_branches["Portable child"]["fork_commit_id"] not in {
        commit["id"] for commit in data["commits"]
    }

    new_messages = _messages(client, new_branches["main"]["id"])
    assert [item["content"] for item in new_messages] == [
        item["content"] for item in _messages(client, main["id"])
    ]
    assert memory["content"] in _contents(
        _memories(client, new_branches["main"]["id"])
    )
    imported_child_memories = _memories(
        client, new_branches["Portable child"]["id"]
    )
    imported_pinned = next(
        item
        for item in imported_child_memories["memories"]
        if item["content"] == memory["content"]
    )
    assert imported_pinned["pinned"] is True
    new_checkpoints = client.get(
        f"/api/branches/{new_branches['Portable child']['id']}/checkpoints"
    )
    assert new_checkpoints.status_code == 200
    assert [item["name"] for item in new_checkpoints.json()] == ["portable-point"]

    re_exported = client.get(f"/api/spaces/{new_id}/export")
    assert re_exported.status_code == 200
    second = re_exported.json()
    assert (
        len(second["branches"]),
        len(second["commits"]),
        len(second["memories"]),
        len(second["overrides"]),
        len(second["proposals"]),
        len(second["checkpoints"]),
    ) == original_counts

    other = signup(
        client,
        email="grace@example.com",
        password="another correct horse",
        display_name="Grace",
    )
    assert other.email == "grace@example.com"
    forbidden = client.get(f"/api/spaces/{space['id']}/export")
    assert forbidden.status_code == 404
