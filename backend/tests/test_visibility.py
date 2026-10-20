from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.repo import branches, memories, spaces, users
from app.visibility import (
    effective_memories,
    is_ancestor,
    lineage,
    visible_commit_ids,
    visible_messages,
)
from tests.helpers import append, fork, refresh_branch


@pytest.fixture
def tree(db):
    owner = users.create(db, "vision@example.com", "hash", "Vision")
    space, main = spaces.create_with_main(db, owner["id"], "Space", "", {})

    first = append(db, main["id"], "user", "I live in Bhubaneswar")
    second = append(db, main["id"], "assistant", "Noted.")
    main = refresh_branch(db, main["id"])

    child1 = fork(db, main["id"], second["id"], "Child one")
    child2 = fork(db, main["id"], second["id"], "Child two")

    child1_user = append(db, child1["id"], "user", "Plan my week")
    child1_reply = append(db, child1["id"], "assistant", "Here is a plan.")
    child2_user = append(db, child2["id"], "user", "Sibling message")
    main_post_fork = append(db, main["id"], "user", "Created after the forks")

    main = refresh_branch(db, main["id"])
    child1 = refresh_branch(db, child1["id"])
    child2 = refresh_branch(db, child2["id"])

    return SimpleNamespace(
        owner=owner,
        space=space,
        main=main,
        child1=child1,
        child2=child2,
        first=first,
        second=second,
        child1_user=child1_user,
        child1_reply=child1_reply,
        child2_user=child2_user,
        main_post_fork=main_post_fork,
    )


def test_visible_chain_is_upstream_only(tree, db):
    main_visible = visible_commit_ids(db, tree.main)
    child_visible = visible_commit_ids(db, tree.child1)
    sibling_visible = visible_commit_ids(db, tree.child2)

    assert {tree.first["id"], tree.second["id"], tree.main_post_fork["id"]} <= main_visible
    assert tree.child1_user["id"] not in main_visible
    assert tree.child2_user["id"] not in main_visible

    assert {tree.first["id"], tree.second["id"], tree.child1_user["id"]} <= child_visible
    assert tree.child2_user["id"] not in child_visible
    assert tree.main_post_fork["id"] not in child_visible

    assert tree.child1_user["id"] not in sibling_visible
    assert tree.child2_user["id"] in sibling_visible
    assert tree.main_post_fork["id"] not in sibling_visible

    messages = [row["content"] for row in visible_messages(db, tree.child1)]
    assert messages == [
        "I live in Bhubaneswar",
        "Noted.",
        "Plan my week",
        "Here is a plan.",
    ]


def test_lineage_runs_root_to_leaf(tree, db):
    assert [branch["name"] for branch in lineage(db, tree.child1)] == [
        "main",
        "Child one",
    ]
    assert is_ancestor(db, tree.main["id"], tree.child1)
    assert not is_ancestor(db, tree.child2["id"], tree.child1)


def test_effective_memories_respect_visibility_and_soft_delete(tree, db):
    anchor_main = db.execute(
        "SELECT * FROM commits WHERE branch_id = ? AND role = 'anchor'",
        (tree.main["id"],),
    ).fetchone()
    assert anchor_main is not None

    shared = memories.create(
        db,
        space_id=tree.space["id"],
        origin_branch_id=tree.main["id"],
        source_commit_id=anchor_main["id"],
        content="I live in Bhubaneswar",
        kind="fact",
    )
    own = memories.create(
        db,
        space_id=tree.space["id"],
        origin_branch_id=tree.child1["id"],
        source_commit_id=tree.child1_user["id"],
        content="Prefers a short weekly plan",
        kind="preference",
    )
    sibling = memories.create(
        db,
        space_id=tree.space["id"],
        origin_branch_id=tree.child2["id"],
        source_commit_id=tree.child2_user["id"],
        content="Sibling secret",
    )
    post_fork = memories.create(
        db,
        space_id=tree.space["id"],
        origin_branch_id=tree.main["id"],
        source_commit_id=tree.main_post_fork["id"],
        content="Post-fork decision",
    )
    deleted = memories.create(
        db,
        space_id=tree.space["id"],
        origin_branch_id=tree.main["id"],
        source_commit_id=tree.first["id"],
        content="Old address",
    )
    memories.soft_delete(db, deleted["id"])

    child_items = {item["id"]: item for item in effective_memories(db, tree.child1)}
    assert set(child_items) == {shared["id"], own["id"]}
    assert child_items[shared["id"]]["inherited"] is True
    assert child_items[shared["id"]]["origin_branch_name"] == "main"
    assert child_items[own["id"]]["inherited"] is False

    main_ids = {item["id"] for item in effective_memories(db, tree.main)}
    assert shared["id"] in main_ids
    assert post_fork["id"] in main_ids
    assert own["id"] not in main_ids
    assert sibling["id"] not in main_ids
    assert deleted["id"] not in main_ids


def test_overrides_are_branch_local(tree, db):
    shared = memories.create(
        db,
        space_id=tree.space["id"],
        origin_branch_id=tree.main["id"],
        source_commit_id=tree.first["id"],
        content="I live in Bhubaneswar",
    )
    memories.set_override(db, tree.child1["id"], shared["id"], excluded=1)

    assert shared["id"] not in {item["id"] for item in effective_memories(db, tree.child1)}
    assert shared["id"] in {item["id"] for item in effective_memories(db, tree.main)}
    assert shared["id"] in {item["id"] for item in effective_memories(db, tree.child2)}

    memories.set_override(
        db,
        tree.child1["id"],
        shared["id"],
        excluded=0,
        content_override="I live in Cuttack",
        pinned=1,
    )
    child_items = {item["id"]: item for item in effective_memories(db, tree.child1)}
    main_items = {item["id"]: item for item in effective_memories(db, tree.main)}

    assert child_items[shared["id"]]["content"] == "I live in Cuttack"
    assert child_items[shared["id"]]["edited"] is True
    assert child_items[shared["id"]]["pinned"] is True
    assert main_items[shared["id"]]["content"] == "I live in Bhubaneswar"
    assert main_items[shared["id"]]["edited"] is False
    assert main_items[shared["id"]]["pinned"] is False
    assert memories.get(db, shared["id"])["content"] == "I live in Bhubaneswar"


def test_parent_exclusion_can_be_reincluded_on_child(tree, db):
    shared = memories.create(
        db,
        space_id=tree.space["id"],
        origin_branch_id=tree.main["id"],
        source_commit_id=tree.first["id"],
        content="Career goal: become a staff engineer",
    )
    memories.set_override(db, tree.main["id"], shared["id"], excluded=1)
    assert shared["id"] not in {item["id"] for item in effective_memories(db, tree.main)}
    assert shared["id"] not in {item["id"] for item in effective_memories(db, tree.child1)}

    memories.set_override(db, tree.child1["id"], shared["id"], excluded=0)
    assert shared["id"] in {item["id"] for item in effective_memories(db, tree.child1)}
    assert shared["id"] not in {item["id"] for item in effective_memories(db, tree.main)}


def test_supersede_only_hides_where_replacement_is_visible(tree, db):
    old = memories.create(
        db,
        space_id=tree.space["id"],
        origin_branch_id=tree.main["id"],
        source_commit_id=tree.first["id"],
        content="Lives in Bhubaneswar",
    )
    replacement = memories.create(
        db,
        space_id=tree.space["id"],
        origin_branch_id=tree.child1["id"],
        source_commit_id=tree.child1_reply["id"],
        content="Lives in Cuttack",
        supersedes_id=old["id"],
    )

    child_ids = {item["id"] for item in effective_memories(db, tree.child1)}
    assert old["id"] not in child_ids
    assert replacement["id"] in child_ids

    main_ids = {item["id"] for item in effective_memories(db, tree.main)}
    assert old["id"] in main_ids
    assert replacement["id"] not in main_ids


def test_fork_head_preview_ignores_later_memories(tree, db):
    later = memories.create(
        db,
        space_id=tree.space["id"],
        origin_branch_id=tree.main["id"],
        source_commit_id=tree.main_post_fork["id"],
        content="Knows about the post-fork decision",
    )
    at_fork = {
        item["id"] for item in effective_memories(db, tree.main, head_override=tree.second["id"])
    }
    current = {item["id"] for item in effective_memories(db, tree.main)}
    assert later["id"] not in at_fork
    assert later["id"] in current


def test_anchor_sourced_memory_is_visible_on_own_branch_only(tree, db):
    child_anchor = db.execute(
        "SELECT * FROM commits WHERE branch_id = ? AND role = 'anchor'",
        (tree.child1["id"],),
    ).fetchone()
    assert child_anchor is not None
    memory = memories.create(
        db,
        space_id=tree.space["id"],
        origin_branch_id=tree.child1["id"],
        source_commit_id=child_anchor["id"],
        content="Child branch starts with a goal",
    )
    assert memory["id"] in {item["id"] for item in effective_memories(db, tree.child1)}
    assert memory["id"] not in {item["id"] for item in effective_memories(db, tree.main)}
    assert memory["id"] not in {item["id"] for item in effective_memories(db, tree.child2)}


def test_anchor_is_not_a_visible_message(tree, db):
    messages = visible_messages(db, tree.main)
    assert all(row["role"] != "anchor" for row in messages)
    anchor = next(
        row
        for row in db.execute(
            "SELECT * FROM commits WHERE branch_id = ? AND role = 'anchor'",
            (tree.main["id"],),
        ).fetchall()
    )
    assert anchor["id"] in visible_commit_ids(db, tree.main)


def test_child_branch_cannot_be_a_merge_target_ancestor(tree, db):
    assert not is_ancestor(db, tree.child1["id"], tree.child2)
    assert branches.require_owned(db, tree.main["id"], tree.owner["id"]) is not None
