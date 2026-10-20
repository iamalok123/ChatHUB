from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
DisplayName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
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
    created_at: str
    is_root: bool
    message_count: int
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
