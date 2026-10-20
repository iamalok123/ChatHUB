import { create } from 'zustand'

export type TraceTarget = {
  branchId: string
  commitId: string
}

type TraceState = {
  target: TraceTarget | null
  selectTrace: (target: TraceTarget) => void
  clearTrace: () => void
}

export const useTraceStore = create<TraceState>()((set) => ({
  target: null,
  selectTrace: (target) => set({ target }),
  clearTrace: () => set({ target: null }),
}))
