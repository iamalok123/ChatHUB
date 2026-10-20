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
  compareBranchId: string | null
  syncRevision: number
  openFork: (target: ForkTarget) => void
  closeFork: () => void
  openMerge: (branchId: string) => void
  closeMerge: () => void
  openSync: (branchId: string) => void
  closeSync: () => void
  openRename: (branchId: string) => void
  closeRename: () => void
  openCompare: (branchId: string) => void
  closeCompare: () => void
  refreshSync: () => void
}

export const useOperationsStore = create<OperationsState>()((set) => ({
  forkTarget: null,
  mergeSourceId: null,
  syncBranchId: null,
  renameBranchId: null,
  compareBranchId: null,
  syncRevision: 0,
  openFork: (forkTarget) => set({ forkTarget }),
  closeFork: () => set({ forkTarget: null }),
  openMerge: (mergeSourceId) => set({ mergeSourceId }),
  closeMerge: () => set({ mergeSourceId: null }),
  openSync: (syncBranchId) => set({ syncBranchId }),
  closeSync: () => set({ syncBranchId: null }),
  openRename: (renameBranchId) => set({ renameBranchId }),
  closeRename: () => set({ renameBranchId: null }),
  openCompare: (compareBranchId) => set({ compareBranchId }),
  closeCompare: () => set({ compareBranchId: null }),
  refreshSync: () => set((state) => ({ syncRevision: state.syncRevision + 1 })),
}))
