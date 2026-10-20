from __future__ import annotations

import math
import re

# Known secret patterns
SECRET_PATTERNS = [
    (re.compile(r"AIza[0-9A-Za-z_-]{35}"), "Google API Key"),
    (re.compile(r"sk-[a-zA-Z0-9_\-]{20,}"), "OpenAI API Key"),
    (re.compile(r"gh[pousr]_[0-9a-zA-Z]{36}"), "GitHub Token"),
    (re.compile(r"xox[baprs]-[0-9a-zA-Z]{10,}"), "Slack Token"),
    (re.compile(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----"), "Private Key"),
    (
        re.compile(
            r"(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*['\"]?[a-zA-Z0-9_\-]{16,}['\"]?",
            re.IGNORECASE,
        ),
        "Credential Assignment",
    ),
]

# Prompt injection / imperative instruction patterns
INJECTION_PATTERNS = [
    re.compile(
        r"ignore (?:all )?(?:previous|above|prior) (?:instructions|prompts|rules)",
        re.IGNORECASE,
    ),
    re.compile(
        r"disregard (?:all )?(?:previous|above|prior) (?:instructions|directives|rules)",
        re.IGNORECASE,
    ),
    re.compile(
        r"forget (?:all )?(?:previous|above|prior) (?:instructions|directives|rules)",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:reveal|output|display|show|print) (?:the )?(?:system|developer) prompt",
        re.IGNORECASE,
    ),
    re.compile(r"system override\b", re.IGNORECASE),
    re.compile(r"developer mode\b", re.IGNORECASE),
    re.compile(r"you (?:must|will) always", re.IGNORECASE),
    re.compile(r"always (?:respond|answer|say|output|pretend)", re.IGNORECASE),
    re.compile(r"never (?:mention|refuse|reveal|tell)", re.IGNORECASE),
    re.compile(r"^(?:system|assistant|user):\s*", re.IGNORECASE),
    re.compile(r"<\|im_start\|>|<\|im_end\|>|\[INST\]|\[/INST\]", re.IGNORECASE),
]

# Sensitive topic keywords
SENSITIVE_KEYWORDS = [
    "diagnosis",
    "cancer",
    "medication",
    "prescription",
    "disease",
    "bipolar",
    "depression",
    "bank account",
    "credit card",
    "ssn",
    "social security",
    "passport",
    "salary",
    "religion",
    "sexual orientation",
    "minor",
]


def shannon_entropy(data: str) -> float:
    if not data:
        return 0.0
    entropy = 0.0
    length = len(data)
    for x in set(data):
        p_x = float(data.count(x)) / length
        if p_x > 0:
            entropy += -p_x * math.log2(p_x)
    return entropy


def detect_secret(text: str) -> str | None:
    for pattern, name in SECRET_PATTERNS:
        if pattern.search(text):
            return name

    # Check for high-entropy tokens
    tokens = re.findall(r"[a-zA-Z0-9_\-]{28,}", text)
    for token in tokens:
        if shannon_entropy(token) >= 4.2:
            return "High-Entropy Secret Token"

    return None


def detect_prompt_injection(text: str) -> bool:
    return any(pattern.search(text) for pattern in INJECTION_PATTERNS)


def detect_sensitivity(text: str) -> str:
    lower = text.lower()
    for kw in SENSITIVE_KEYWORDS:
        if kw in lower:
            return "sensitive"
    return "none"


def infer_subject_key(text: str, kind: str) -> str | None:
    lower = text.lower()
    if "theme" in lower or "dark mode" in lower or "light mode" in lower:
        return "user.ui.theme"
    if "prefer" in lower or kind == "preference":
        return "user.preference"
    if "name is" in lower or "called" in lower or kind == "profile":
        return "user.profile.name"
    if "location" in lower or "live in" in lower or "city" in lower:
        return "user.location"
    if "work" in lower or "job" in lower or "role" in lower:
        return "user.career"
    return f"user.{kind}"
