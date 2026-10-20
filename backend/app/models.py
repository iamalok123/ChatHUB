from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SignupRequest(StrictModel):
    email: EmailStr
    display_name: DisplayName
    password: Password


class LoginRequest(StrictModel):
    email: EmailStr
    password: Password


class UpdateMeRequest(StrictModel):
    display_name: DisplayName


class ChangePasswordRequest(StrictModel):
    current_password: Password
    new_password: Password


class UserOut(BaseModel):
    id: str
    email: str
    display_name: str
    created_at: str


class AuthResponse(BaseModel):
    user: UserOut


class AuthConfigOut(BaseModel):
    signup_enabled: bool
    llm_mode: Literal["gemini", "mock"]


class SpaceCreate(StrictModel):
    name: Name
    description: Annotated[str, StringConstraints(max_length=2000)] = ""
    profile: dict[str, Any] = Field(default_factory=dict)


class SpaceUpdate(StrictModel):
    name: Name | None = None
    description: Annotated[str, StringConstraints(max_length=2000)] | None = None
    profile: dict[str, Any] | None = None


class SpaceOut(BaseModel):
    id: str
    name: str
    description: str
    profile: dict[str, Any]
    created_at: str


class BranchOut(BaseModel):
    id: str
    space_id: str
    name: str
    parent_branch_id: str | None
    fork_commit_id: str | None
    head_commit_id: str | None
    system_prompt: str
    persona: str
    model: str | None
    thinking_level: str
    top_k: int
    memory_mode: str
    color: str | None
    archived: bool
    ephemeral: bool = False
    created_at: str
    is_root: bool
    message_count: int
    memory_count: int


class BranchUpdate(StrictModel):
    name: Name | None = None
    system_prompt: Annotated[str, StringConstraints(max_length=8000)] | None = None
    persona: Annotated[str, StringConstraints(max_length=8000)] | None = None
    model: Annotated[str, StringConstraints(max_length=120)] | None = None
    thinking_level: Literal["low", "medium", "high"] | None = None
    top_k: Annotated[int, Field(ge=1, le=20)] | None = None
    memory_mode: Literal["review", "auto", "off"] | None = None
    color: Annotated[str, StringConstraints(max_length=32)] | None = None
    archived: bool | None = None
    ephemeral: bool | None = None


class ChatRequest(StrictModel):
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)]
    expected_head_id: str | None = None


class MessageTraceSummary(BaseModel):
    version: int | None = None
    provider: str | None = None
    mock: bool = False
    duration_ms: int = 0
    memory_count: int = 0
    thinking_summary: str | None = None
    thinking_source: str | None = None
    usage: dict[str, Any] = Field(default_factory=dict)
    status: str | None = None


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    parent_id: str | None
    branch_id: str
    origin_branch_name: str
    is_inherited: bool
    status: str
    created_at: str
    trace_summary: MessageTraceSummary | None = None


class TraceOut(BaseModel):
    commit_id: str
    branch_id: str
    trace: dict[str, Any] | None
    trace_version: int | None = None


MemoryKind = Literal["fact", "preference", "decision", "profile", "summary", "task"]
MemoryContent = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
]


class MemoryCreate(StrictModel):
    content: MemoryContent
    kind: MemoryKind = "fact"
    importance: Annotated[float, Field(ge=0.0, le=1.0)] = 0.5


class MemoryUpdate(StrictModel):
    content: MemoryContent | None = None
    kind: MemoryKind | None = None
    importance: Annotated[float, Field(ge=0.0, le=1.0)] | None = None


class MemoryOverrideRequest(StrictModel):
    action: Literal["exclude", "include", "pin", "unpin", "edit"]
    content: MemoryContent | None = None


class MemoryOut(BaseModel):
    id: str
    content: str
    kind: str
    importance: float
    pinned: bool
    edited: bool
    inherited: bool
    excluded: bool
    origin_branch_id: str
    origin_branch_name: str
    source_commit_id: str
    supersedes_id: str | None
    derived_from_id: str | None
    has_embedding: bool
    stale_embedding: bool
    created_at: str


class MemoryListOut(BaseModel):
    memories: list[MemoryOut]
    excluded: list[MemoryOut]


class ProposalOut(BaseModel):
    id: str
    branch_id: str
    commit_id: str
    content: str
    kind: str
    importance: float
    status: str
    reason: str
    conflicts_with_memory_id: str | None
    conflict_content: str | None
    conflict_kind: str | None
    accepted_memory_id: str | None
    resolution: str | None
    created_at: str


class ProposalAcceptRequest(StrictModel):
    content: MemoryContent | None = None
    kind: MemoryKind | None = None
    importance: Annotated[float, Field(ge=0.0, le=1.0)] | None = None
    resolution: Literal["replace", "keep_both"] = "keep_both"


class ProposalAcceptOut(BaseModel):
    proposal: ProposalOut
    memory: MemoryOut


class ForkRequest(StrictModel):
    name: Name | None = None
    commit_id: str | None = None
    persona: Annotated[str, StringConstraints(max_length=8000)] | None = None
    system_prompt: Annotated[str, StringConstraints(max_length=8000)] | None = None
    model: Annotated[str, StringConstraints(max_length=120)] | None = None
    thinking_level: Literal["low", "medium", "high"] | None = None
    top_k: Annotated[int, Field(ge=1, le=20)] | None = None
    memory_mode: Literal["review", "auto", "off"] | None = None
    exclude_memory_ids: list[str] = Field(default_factory=list)
    pin_memory_ids: list[str] = Field(default_factory=list)
    unpin_memory_ids: list[str] = Field(default_factory=list)
    ephemeral: bool = False


class ForkPreviewOut(BaseModel):
    source_branch_id: str
    commit_id: str
    commit_role: str
    memories: list[MemoryOut]
    pinned_count: int


class DuplicateMatchOut(BaseModel):
    memory_id: str
    duplicate_of_memory_id: str
    similarity: float


class MergePreviewOut(BaseModel):
    source_branch_id: str
    target_branch_id: str
    target_name: str
    target_head_commit_id: str | None
    memories: list[MemoryOut]
    duplicates: list[DuplicateMatchOut]
    warnings: list[str]


class MergeRequest(StrictModel):
    target_branch_id: str
    memory_ids: list[str] = Field(default_factory=list)
    summary: Annotated[str, StringConstraints(max_length=8000)] = ""
    expected_head_id: str | None = None


class MergeResultOut(BaseModel):
    source_branch_id: str
    target_branch_id: str
    merge_commit_id: str
    copied_count: int
    duplicates: list[DuplicateMatchOut]
    warnings: list[str]
    target: BranchOut


class MergeSummaryRequest(StrictModel):
    target_branch_id: str
    memory_ids: list[str] = Field(min_length=1)


class MergeSummaryOut(BaseModel):
    summary: str
    provider: str
    mock: bool
    warning: str | None = None


class SyncPreviewOut(BaseModel):
    branch_id: str
    parent_branch_id: str
    parent_name: str
    parent_head_commit_id: str | None
    memories: list[MemoryOut]
    duplicates: list[DuplicateMatchOut]
    warnings: list[str]


class SyncRequest(StrictModel):
    memory_ids: list[str] = Field(min_length=1)
    expected_head_id: str | None = None


class SyncResultOut(BaseModel):
    branch_id: str
    parent_branch_id: str
    sync_commit_id: str
    copied_count: int
    duplicates: list[DuplicateMatchOut]
    warnings: list[str]
    branch: BranchOut


class MemoryChangeOut(BaseModel):
    before: MemoryOut
    after: MemoryOut


class DiffOut(BaseModel):
    branch_id: str
    against_branch_id: str
    against_name: str
    baseline_commit_id: str
    added: list[MemoryOut]
    removed: list[MemoryOut]
    changed: list[MemoryChangeOut]
    messages_added: list[MessageOut]
    messages_upstream: list[MessageOut]
    added_count: int
    removed_count: int
    changed_count: int
    messages_added_count: int
    messages_upstream_count: int


class CheckpointCreate(StrictModel):
    name: Name
    commit_id: str | None = None


class CheckpointOut(BaseModel):
    id: str
    branch_id: str
    commit_id: str
    name: str
    commit_role: str
    preview: str
    created_at: str


class GraphCheckpointOut(BaseModel):
    id: str
    branch_id: str
    commit_id: str
    name: str
    created_at: str


class GraphEdgeOut(BaseModel):
    id: str
    source_branch_id: str
    target_branch_id: str
    kind: Literal["fork", "merge", "sync"]
    commit_id: str
    created_at: str


class SpaceGraphOut(BaseModel):
    branches: list[BranchOut]
    edges: list[GraphEdgeOut]
    checkpoints: list[GraphCheckpointOut]


class ExportSpaceInfo(BaseModel):
    name: str
    description: str
    profile: dict[str, Any]
    created_at: str


class ExportBranch(BaseModel):
    id: str
    name: str
    parent_branch_id: str | None
    fork_commit_id: str | None
    head_commit_id: str | None
    system_prompt: str
    persona: str
    model: str | None
    thinking_level: str
    top_k: int
    memory_mode: str
    color: str | None
    archived: bool
    created_at: str


class ExportCommit(BaseModel):
    id: str
    branch_id: str
    parent_id: str | None
    role: str
    content: str
    thinking: str | None
    trace_json: str | None
    status: str
    provider_parts_json: str | None
    thought_signature: str | None
    usage_json: str | None
    source_branch_id: str | None
    created_at: str


class ExportMemory(BaseModel):
    id: str
    origin_branch_id: str
    source_commit_id: str
    content: str
    kind: str
    importance: float
    embedding: str | None
    embedding_model: str | None
    embedding_dim: int | None
    supersedes_id: str | None
    derived_from_id: str | None
    deleted_at: str | None
    created_at: str


class ExportOverride(BaseModel):
    branch_id: str
    memory_id: str
    excluded: int | None
    pinned: int | None
    content_override: str | None
    updated_at: str


class ExportProposal(BaseModel):
    id: str
    branch_id: str
    commit_id: str
    content: str
    kind: str | None
    importance: float | None
    conflicts_with_memory_id: str | None
    reason: str | None
    status: str
    resolution: str | None
    accepted_memory_id: str | None
    resolved_at: str | None
    created_at: str


class ExportCheckpoint(BaseModel):
    id: str
    branch_id: str
    commit_id: str
    name: str
    created_at: str


class SpaceExport(BaseModel):
    version: Literal[1]
    exported_at: str
    space: ExportSpaceInfo
    branches: list[ExportBranch]
    commits: list[ExportCommit]
    memories: list[ExportMemory]
    overrides: list[ExportOverride]
    proposals: list[ExportProposal]
    checkpoints: list[ExportCheckpoint]


class ImportResultOut(BaseModel):
    space: SpaceOut
    branch_count: int
    commit_count: int
    memory_count: int


class UserRecord(BaseModel):
    id: str
    email: str
    display_name: str
    created_at: str
    password_hash: str


def user_out(row: Any) -> UserOut:
    return UserOut(
        id=row["id"],
        email=row["email"],
        display_name=row["display_name"],
        created_at=row["created_at"],
    )
