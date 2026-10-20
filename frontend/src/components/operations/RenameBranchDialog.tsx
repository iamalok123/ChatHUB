import { useState } from 'react'
import type { FormEvent } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Branch } from '../../api/types'
import { useOperationsStore } from '../../store/operations'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Field, TextInput } from '../ui/Field'

export function RenameBranchDialog({ branchId }: { branchId: string }) {
  const close = useOperationsStore((state) => state.closeRename)
  const branch = useWorkspaceStore((state) =>
    state.branches.find((item) => item.id === branchId),
  )
  const upsertBranch = useWorkspaceStore((state) => state.upsertBranch)
  const pushToast = useUiStore((state) => state.pushToast)
  const [name, setName] = useState(branch?.name ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('Give the branch a name.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const updated = await api.patch<Branch>(`/branches/${branchId}`, {
        name: name.trim(),
      })
      upsertBranch(updated)
      pushToast('success', 'Branch renamed', updated.name)
      close()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onClose={close}
      title="Rename branch"
      description="The name appears in the sidebar, breadcrumb, and memory provenance."
      size="sm"
    >
      <form id="rename-branch-form" onSubmit={submit} className="space-y-4">
        <Field label="Branch name" htmlFor="rename-branch">
          <TextInput
            id="rename-branch"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
            autoFocus
            data-autofocus
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
      </form>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" form="rename-branch-form" loading={pending}>
          Save name
        </Button>
      </div>
    </Dialog>
  )
}
