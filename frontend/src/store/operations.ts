import { create } from 'zustand'

export type ForkTarget = {
  branchId: string
  commitId: string
  nameHint?: string
}

type OperationsState = {
  forkTarget: ForkTarget | null
  mergeSourceId: string | null
  syncBranchId: string | null
  renameBranchId: string | null
  syncRevision: number
  openFork: (target: ForkTarget) => void
  closeFork: () => void
  openMerge: (branchId: string) => void
  closeMerge: () => void
  openSync: (branchId: string) => void
  closeSync: () => void
  openRename: (branchId: string) => void
  closeRename: () => void
  refreshSync: () => void
}

export const useOperationsStore = create<OperationsState>()((set) => ({
  forkTarget: null,
  mergeSourceId: null,
  syncBranchId: null,
  renameBranchId: null,
  syncRevision: 0,
  openFork: (forkTarget) => set({ forkTarget }),
  closeFork: () => set({ forkTarget: null }),
  openMerge: (mergeSourceId) => set({ mergeSourceId }),
  closeMerge: () => set({ mergeSourceId: null }),
  openSync: (syncBranchId) => set({ syncBranchId }),
  closeSync: () => set({ syncBranchId: null }),
  openRename: (renameBranchId) => set({ renameBranchId }),
  closeRename: () => set({ renameBranchId: null }),
  refreshSync: () => set((state) => ({ syncRevision: state.syncRevision + 1 })),
}))
