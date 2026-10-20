export type User = {
  id: string
  email: string
  display_name: string
  created_at: string
}

export type AuthConfig = {
  signup_enabled: boolean
  llm_mode: 'gemini' | 'mock'
}

export type AuthResponse = {
  user: User
}

export type Health = {
  status: string
  version: string
  llm_mode: 'gemini' | 'mock'
  provider: {
    name?: string
    reachable?: boolean | null
    detail?: string
    [key: string]: unknown
  }
  gemini: {
    configured: boolean
    reachable: boolean | null
    chat_model: string
    embed_model: string
  }
  auth: {
    signup_enabled: boolean
    session_ttl_days: number
  }
  privacy: {
    key_location: string
    host: string
  }
}

export type Space = {
  id: string
  name: string
  description: string
  profile: Record<string, unknown>
  created_at: string
}

export type Branch = {
  id: string
  space_id: string
  name: string
  parent_branch_id: string | null
  fork_commit_id: string | null
  head_commit_id: string | null
  system_prompt: string
  persona: string
  model: string | null
  thinking_level: string
  top_k: number
  memory_mode: string
  color: string | null
  archived: boolean
  created_at: string
  is_root: boolean
  message_count: number
  memory_count: number
}

export type TraceUsage = Record<string, number>

export type TraceMemory = {
  id: string
  content: string
  kind: string
  importance: number
  pinned: boolean
  edited: boolean
  inherited: boolean
  origin_branch_name: string
  source_commit_id: string | null
  similarity: number | null
  importance_score: number
  recency: number
  score: number | null
  reason: string
  tokens: number
}

export type TraceStep = {
  phase: string
  status: string
  duration_ms: number
  payload: Record<string, unknown>
}

export type TraceMemoryOperation = {
  op: string
  memory_id?: string
  proposal_id?: string
  content?: string
  kind?: string
  conflict_with?: string | null
  code?: string
  [key: string]: unknown
}

export type TraceContext = {
  system_tokens: number
  memory_tokens: number
  history_tokens: number
  current_tokens: number
  total_tokens: number
  history_messages: number
  dropped_turns: number
  memory_count: number
}

export type MessageTraceSummary = {
  version: number | null
  provider: string | null
  mock: boolean
  duration_ms: number
  memory_count: number
  thinking_summary: string | null
  thinking_source: string | null
  usage: TraceUsage
  status: string | null
}

export type AssistantTrace = {
  version: number
  provider: string
  mock: boolean
  demo?: boolean
  model: string
  thinking_level: string
  thinking_summary: string | null
  thinking_source: string | null
  context: TraceContext
  memory_mode: string
  retrieval: {
    query: string
    query_tokens: number
    used_tokens: number
    top_k: number
    duration_ms: number
  }
  retrieved_memories: TraceMemory[]
  considered_memories: TraceMemory[]
  excluded_memories: TraceMemory[]
  memory_operations: TraceMemoryOperation[]
  warnings: string[]
  usage: TraceUsage
  finish_reason: string | null
  steps: TraceStep[]
  error: { code: string; message: string; retryable?: boolean } | null
  error_code: string | null
  status: string
  generate_ms: number
  completed_at: string
  extraction?: {
    status: string
    mode: string
    proposals: number
    auto_saved: number
  }
}

export type TraceResponse = {
  commit_id: string
  branch_id: string
  trace: AssistantTrace | null
  trace_version: number | null
}

export type Message = {
  id: string
  role: string
  content: string
  parent_id: string | null
  branch_id: string
  origin_branch_name: string
  is_inherited: boolean
  status: string
  created_at: string
  trace_summary?: MessageTraceSummary | null
}

export type MemoryProposal = {
  id: string
  branch_id: string
  commit_id: string
  content: string
  kind: string
  importance: number
  status: string
  reason: string
  conflicts_with_memory_id: string | null
  conflict_content: string | null
  conflict_kind: string | null
  accepted_memory_id: string | null
  resolution: string | null
  created_at: string
}

export type ChatStepEvent = {
  phase: string
  status: string
  duration_ms: number
  payload: Record<string, unknown>
}

export type ChatTokenEvent = { text: string }
export type ChatThinkingEvent = { text: string; synthetic: boolean }

export type ChatDoneEvent = {
  user_commit_id: string | null
  assistant_commit_id: string
  head_commit_id: string
  usage: TraceUsage
  duration_ms: number
  trace_version: number
  status: string
  provider: string
}

export type ChatErrorEvent = {
  code: string
  message: string
  retryable: boolean
  partial_commit_id: string | null
  status: string
}

export type ChatProposalsEvent = {
  mode: string
  proposals: MemoryProposal[]
  auto_saved: Memory[]
}

export type ChatBranchEvent = {
  branch_id: string
  parent_branch_id: string
  fork_commit_id: string
}

export type Memory = {
  id: string
  content: string
  kind: string
  importance: number
  pinned: boolean
  edited: boolean
  inherited: boolean
  excluded: boolean
  origin_branch_id: string
  origin_branch_name: string
  source_commit_id: string
  supersedes_id: string | null
  derived_from_id: string | null
  has_embedding: boolean
  stale_embedding: boolean
  created_at: string
}

export type MemoryList = {
  memories: Memory[]
  excluded: Memory[]
}

export type ForkPreview = {
  source_branch_id: string
  commit_id: string
  commit_role: string
  memories: Memory[]
  pinned_count: number
}

export type ForkInput = {
  name?: string
  commit_id?: string
  persona?: string
  system_prompt?: string
  model?: string | null
  thinking_level?: string
  top_k?: number
  memory_mode?: string
  exclude_memory_ids?: string[]
  pin_memory_ids?: string[]
  unpin_memory_ids?: string[]
}

export type MemoryDuplicate = {
  memory_id: string
  duplicate_of_memory_id: string
  similarity: number
}

export type MergePreview = {
  source_branch_id: string
  target_branch_id: string
  target_name: string
  target_head_commit_id: string | null
  memories: Memory[]
  duplicates: MemoryDuplicate[]
  warnings: string[]
}

export type MergeInput = {
  target_branch_id: string
  memory_ids?: string[]
  summary?: string
  expected_head_id?: string | null
}

export type MergeResult = {
  source_branch_id: string
  target_branch_id: string
  merge_commit_id: string
  copied_count: number
  duplicates: MemoryDuplicate[]
  warnings: string[]
  target: Branch
}

export type MergeSummary = {
  summary: string
  provider: string
  mock: boolean
  warning: string | null
}

export type SyncPreview = {
  branch_id: string
  parent_branch_id: string
  parent_name: string
  parent_head_commit_id: string | null
  memories: Memory[]
  duplicates: MemoryDuplicate[]
  warnings: string[]
}

export type SyncInput = {
  memory_ids: string[]
  expected_head_id?: string | null
}

export type SyncResult = {
  branch_id: string
  parent_branch_id: string
  sync_commit_id: string
  copied_count: number
  duplicates: MemoryDuplicate[]
  warnings: string[]
  branch: Branch
}

export type Checkpoint = {
  id: string
  branch_id: string
  commit_id: string
  name: string
  commit_role: string
  preview: string
  created_at: string
}

export type GraphCheckpoint = {
  id: string
  branch_id: string
  commit_id: string
  name: string
  created_at: string
}

export type GraphEdge = {
  id: string
  source_branch_id: string
  target_branch_id: string
  kind: 'fork' | 'merge' | 'sync'
  commit_id: string
  created_at: string
}

export type SpaceGraph = {
  branches: Branch[]
  edges: GraphEdge[]
  checkpoints: GraphCheckpoint[]
}

export type MemoryChange = {
  before: Memory
  after: Memory
}

export type SpaceDiff = {
  branch_id: string
  against_branch_id: string
  against_name: string
  baseline_commit_id: string
  added: Memory[]
  removed: Memory[]
  changed: MemoryChange[]
  messages_added: Message[]
  messages_upstream: Message[]
  added_count: number
  removed_count: number
  changed_count: number
  messages_added_count: number
  messages_upstream_count: number
}

export type ImportResult = {
  space: Space
  branch_count: number
  commit_count: number
  memory_count: number
}

export type ApiErrorBody = {
  error: {
    code: string
    message: string
  }
}
