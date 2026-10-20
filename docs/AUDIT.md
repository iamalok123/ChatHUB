# ChatHUB Hardening Audit Register

This document tracks all security, memory, data governance, and architectural audit findings identified in [`docs/HARDENING.md`](HARDENING.md).

Every finding is recorded with:
- `id`: Unique audit identifier (`SEC-*`, `MEM-*`, `ISO-*`, `CON-*`, `BRN-*`, `JOB-*`, `SCH-*`)
- `severity`: `Critical` | `High` | `Medium` | `Low`
- `what was wrong`: Detailed description of the vulnerability or behavioral gap
- `fix`: Architectural and code remedy
- `test name`: Automated test verifying the failure and subsequent fix
- `status`: `failing_test_added` | `fixed` | `deferred with reason`

---

## Audit Findings Register

| ID | Severity | What Was Wrong | Fix | Test Name | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-001** | High | **Host header validation missing:** Backend accepted arbitrary `Host` headers, allowing DNS rebinding attacks against `localhost:8000` / production endpoints. | Add `HostHeaderMiddleware` enforcing an allowlist of valid hosts (`127.0.0.1`, `localhost`, and configured production domains). | `test_host_header_rejected_when_not_allowed` | `failing_test_added` |
| **SEC-002** | High | **Permissive Origin and CSRF checks:** Mutating requests could bypass origin checks if Origin was absent or mismatched when calling the API from malicious browser contexts. | Enforce strict Origin header checking and `X-ChatHUB-Request: 1` verification on all mutating requests. | `test_mutating_request_origin_validation` | `failing_test_added` |
| **SEC-003** | Critical | **Memory poisoning & prompt injection:** Assistant outputs, tool results, or user messages containing directives (e.g., "always do X", "ignore previous instructions") could become active memories. | Filter candidates: only user turns can create active memories; quarantine assistant/tool content as candidate; reject imperative instructions unless explicitly typed as standing instructions. | `test_memory_poisoning_instruction_rejected` | `fixed` |
| **SEC-004** | High | **Sensitive secrets saved silently:** API keys (`AIza...`, `sk-...`, `ghp_...`), private keys, passwords, and high-entropy strings could be stored as memories. | Implement regex + Shannon entropy secret scanner in `MemoryClassifier` that rejects storage with a 400 error. | `test_secrets_detection_blocks_api_keys` | `fixed` |
| **ISO-001** | Critical | **Cross-branch canary leakage:** Canary tokens or confidential memories in sibling/unrelated branches could potentially leak through global search or un-scoped queries. | Strictly scope all search, graph, and memory queries through `visible_commit_ids`. Verify sibling canary strings never surface in context or traces. | `test_canary_secret_never_leaks_to_sibling` | `failing_test_added` |
| **MEM-001** | High | **Incomplete deletion ("Forget" gap):** Soft-deleting a memory (`deleted_at`) left residual embeddings in Qdrant, text in `commits.trace_json`, and pending proposals. | Implement atomic `forget` operation that deletes memory row, version history, Qdrant vector point, FTS index tokens, and scrubs trace JSON. | `test_forget_memory_scrubs_all_traces_and_vectors` | `fixed` |
| **CON-001** | High | **Concurrent chat generation race condition:** Two simultaneous generation requests on the same branch could interleave commits and corrupt the branch head. | Implement per-branch async locks returning `409 Conflict` if a generation is already active on the branch. | `test_concurrent_chat_lock_returns_409` | `fixed` |
| **BRN-001** | Medium | **Upstream deletion leaves child unaware:** When an ancestor branch soft-deletes an inherited memory, child branches had no tombstone indicator. | Introduce `status='tombstoned'` state; child displays "Removed upstream" with a "Keep local copy" button. | `test_upstream_delete_creates_child_tombstone` | `fixed` |
| **JOB-001** | Medium | **Memory rot & no background consolidation:** Expired or inactive memories never decayed or flagged staleness; contradictions accumulated silently. | Implement background consolidation engine (`jobs` table) with staleness sweep, contradiction sweep, and review inbox. | `test_staleness_sweep_flags_expired_memories` | `failing_test_added` |
| **SCH-001** | High | **Lack of versioned migration runner:** Schema lived in static SQL files without numbered migrations, version tracking, or Schema v2 columns/tables. | Implement `schema_migrations` runner and Migration `0002_hardening_v2.sql` adding Schema v2 columns, `memory_events`, `outbox_events`, and `jobs`. | `test_schema_migration_runner` | `fixed` |
