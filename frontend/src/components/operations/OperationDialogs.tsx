import { useOperationsStore } from '../../store/operations'
import { ForkDialog } from './ForkDialog'
import { MergeDialog } from './MergeDialog'
import { RenameBranchDialog } from './RenameBranchDialog'
import { SyncDialog } from './SyncDialog'

export function OperationDialogs() {
  const forkTarget = useOperationsStore((state) => state.forkTarget)
  const mergeSourceId = useOperationsStore((state) => state.mergeSourceId)
  const syncBranchId = useOperationsStore((state) => state.syncBranchId)
  const renameBranchId = useOperationsStore((state) => state.renameBranchId)

  return (
    <>
      {forkTarget && (
        <ForkDialog
          key={`${forkTarget.branchId}:${forkTarget.commitId}`}
          target={forkTarget}
        />
      )}
      {mergeSourceId && (
        <MergeDialog key={mergeSourceId} sourceBranchId={mergeSourceId} />
      )}
      {syncBranchId && <SyncDialog key={syncBranchId} branchId={syncBranchId} />}
      {renameBranchId && (
        <RenameBranchDialog key={renameBranchId} branchId={renameBranchId} />
      )}
    </>
  )
}
