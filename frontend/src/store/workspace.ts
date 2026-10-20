import { create } from 'zustand'

import { api, errorMessage } from '../api/client'
import type { Branch, ImportResult, Space } from '../api/types'
import { useUiStore } from './ui'

const SPACE_KEY = 'branchmind:space'
const BRANCH_KEY = 'branchmind:branch'

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, value)
    }
  } catch {
    return
  }
}

function chooseBranch(branches: Branch[], preferredId: string | null): Branch | null {
  return (
    branches.find((branch) => branch.id === preferredId) ??
    branches.find((branch) => branch.is_root) ??
    branches[0] ??
    null
  )
}

type WorkspaceState = {
  spaces: Space[]
  branches: Branch[]
  currentSpaceId: string | null
  currentBranchId: string | null
  loadingSpaces: boolean
  loadingBranches: boolean
  error: string | null
  loadSpaces: () => Promise<void>
  loadBranches: () => Promise<void>
  selectSpace: (spaceId: string) => Promise<void>
  selectBranch: (branchId: string) => void
  refreshBranch: (branchId: string) => Promise<void>
  upsertBranch: (branch: Branch) => void
  addAndSelectBranch: (branch: Branch) => void
  createSpace: (name: string, description: string) => Promise<Space>
  importSpace: (document: unknown) => Promise<ImportResult>
  reset: () => void
}

let spacesPromise: Promise<void> | null = null
let branchRequest = 0
let workspaceGeneration = 0

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  spaces: [],
  branches: [],
  currentSpaceId: null,
  currentBranchId: null,
  loadingSpaces: false,
  loadingBranches: false,
  error: null,

  loadSpaces: () => {
    if (spacesPromise) return spacesPromise

    const generation = workspaceGeneration
    spacesPromise = (async () => {
      set({ loadingSpaces: true, error: null })
      try {
        const spaces = await api.get<Space[]>('/spaces')
        if (generation !== workspaceGeneration) return
        const preferredSpace = readStored(SPACE_KEY)
        const space =
          spaces.find((item) => item.id === preferredSpace) ?? spaces[0] ?? null

        set({
          spaces,
          currentSpaceId: space?.id ?? null,
          currentBranchId: null,
          branches: space ? get().branches : [],
        })
        writeStored(SPACE_KEY, space?.id ?? null)

        if (space) {
          await get().loadBranches()
        } else {
          set({ branches: [] })
          writeStored(BRANCH_KEY, null)
        }
      } catch (error) {
        if (generation !== workspaceGeneration) return
        set({ error: errorMessage(error), spaces: [] })
      } finally {
        if (generation === workspaceGeneration) {
          set({ loadingSpaces: false })
        }
      }
    })().finally(() => {
      if (generation === workspaceGeneration) {
        spacesPromise = null
      }
    })

    return spacesPromise
  },

  loadBranches: async () => {
    const spaceId = get().currentSpaceId
    if (!spaceId) {
      set({ branches: [], currentBranchId: null })
      return
    }

    const request = ++branchRequest
    const generation = workspaceGeneration
    set({ loadingBranches: true, branches: [], currentBranchId: null })
    try {
      const branches = await api.get<Branch[]>(`/spaces/${spaceId}/branches`)
      if (generation !== workspaceGeneration) return
      if (request !== branchRequest) return
      const branch = chooseBranch(branches, readStored(BRANCH_KEY))
      set({
        branches,
        currentBranchId: branch?.id ?? null,
        error: null,
      })
      writeStored(BRANCH_KEY, branch?.id ?? null)
    } catch (error) {
      if (generation !== workspaceGeneration) return
      if (request !== branchRequest) return
      set({ error: errorMessage(error) })
      useUiStore.getState().pushToast('error', 'Could not load branches', errorMessage(error))
    } finally {
      if (generation === workspaceGeneration && request === branchRequest) {
        set({ loadingBranches: false })
      }
    }
  },

  selectSpace: async (spaceId) => {
    if (get().currentSpaceId === spaceId) return
    writeStored(SPACE_KEY, spaceId)
    writeStored(BRANCH_KEY, null)
    set({
      currentSpaceId: spaceId,
      currentBranchId: null,
      branches: [],
    })
    await get().loadBranches()
  },

  selectBranch: (branchId) => {
    if (!get().branches.some((branch) => branch.id === branchId)) return
    writeStored(BRANCH_KEY, branchId)
    set({ currentBranchId: branchId })
  },

  refreshBranch: async (branchId) => {
    const generation = workspaceGeneration
    try {
      const branch = await api.get<Branch>(`/branches/${branchId}`)
      if (generation !== workspaceGeneration) return
      set((state) => ({
        branches: state.branches.map((item) => (item.id === branch.id ? branch : item)),
      }))
    } catch {
      return
    }
  },

  upsertBranch: (branch) => {
    set((state) => {
      const exists = state.branches.some((item) => item.id === branch.id)
      return {
        branches: exists
          ? state.branches.map((item) => (item.id === branch.id ? branch : item))
          : [...state.branches, branch],
      }
    })
  },

  addAndSelectBranch: (branch) => {
    set((state) => ({
      branches: state.branches.some((item) => item.id === branch.id)
        ? state.branches.map((item) => (item.id === branch.id ? branch : item))
        : [...state.branches, branch],
      currentBranchId: branch.id,
    }))
    writeStored(BRANCH_KEY, branch.id)
    writeStored(SPACE_KEY, branch.space_id)
  },

  createSpace: async (name, description) => {
    const space = await api.post<Space>('/spaces', { name, description })
    writeStored(SPACE_KEY, space.id)
    writeStored(BRANCH_KEY, null)
    set((state) => ({
      spaces: [space, ...state.spaces],
      currentSpaceId: space.id,
      currentBranchId: null,
      branches: [],
    }))
    await get().loadBranches()
    return space
  },

  importSpace: async (document) => {
    const result = await api.post<ImportResult>('/spaces/import', document)
    const spaces = await api.get<Space[]>('/spaces')
    writeStored(SPACE_KEY, result.space.id)
    writeStored(BRANCH_KEY, null)
    set({
      spaces,
      currentSpaceId: result.space.id,
      currentBranchId: null,
      branches: [],
    })
    await get().loadBranches()
    return result
  },

  reset: () => {
    workspaceGeneration += 1
    branchRequest += 1
    spacesPromise = null
    writeStored(SPACE_KEY, null)
    writeStored(BRANCH_KEY, null)
    set({
      spaces: [],
      branches: [],
      currentSpaceId: null,
      currentBranchId: null,
      loadingSpaces: false,
      loadingBranches: false,
      error: null,
    })
  },
}))

export function selectCurrentSpace(state: WorkspaceState): Space | null {
  return state.spaces.find((space) => space.id === state.currentSpaceId) ?? null
}

export function selectCurrentBranch(state: WorkspaceState): Branch | null {
  return state.branches.find((branch) => branch.id === state.currentBranchId) ?? null
}
