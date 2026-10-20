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
