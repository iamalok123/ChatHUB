import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { errorMessage } from '../../api/client'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Field, TextInput, Textarea } from '../ui/Field'

export function NewSpaceDialog() {
  const open = useUiStore((state) => state.newSpaceOpen)
  const setOpen = useUiStore((state) => state.setNewSpaceOpen)
  const pushToast = useUiStore((state) => state.pushToast)
  const createSpace = useWorkspaceStore((state) => state.createSpace)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setDescription('')
    setError(null)
    setPending(false)
  }

  const close = () => {
    reset()
    setOpen(false)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('Give your space a name.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const space = await createSpace(name.trim(), description.trim())
      pushToast('success', 'Space created', `${space.name} is ready with a main branch.`)
      close()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Create a space"
      description="A space is a repository for branches, shared memory, and a profile."
      size="sm"
    >
      <form id="new-space-form" onSubmit={submit} className="space-y-4">
        <Field label="Space name" htmlFor="space-name">
          <TextInput
            id="space-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Product thinking"
            maxLength={120}
            required
            autoFocus
            data-autofocus
          />
        </Field>
        <Field
          label="Description"
          htmlFor="space-description"
          optional
          hint="A short note about what this space remembers and why it exists."
        >
          <Textarea
            id="space-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Decisions, preferences, and context for my product work."
            rows={3}
            maxLength={2000}
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
        <Button
          type="submit"
          form="new-space-form"
          loading={pending}
          leadingIcon={!pending ? <Plus size={15} aria-hidden /> : undefined}
        >
          Create space
        </Button>
      </div>
    </Dialog>
  )
}
