import {
  Database,
  Download,
  KeyRound,
  Monitor,
  Moon,
  Palette,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  UserRound,
} from 'lucide-react'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { api, errorMessage } from '../../api/client'
import { cn } from '../../lib/cn'
import { downloadJson, plural, sentenceCase, slugify } from '../../lib/format'
import { useAuthStore } from '../../store/auth'
import type { Theme } from '../../store/ui'
import { useUiStore } from '../../store/ui'
import {
  selectCurrentSpace,
  useWorkspaceStore,
} from '../../store/workspace'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Field, TextInput } from '../ui/Field'

type Tab = 'account' | 'ai' | 'appearance' | 'data'

const tabs: Array<{ id: Tab; label: string; icon: typeof UserRound }> = [
  { id: 'account', label: 'Account', icon: UserRound },
  { id: 'ai', label: 'AI status', icon: Sparkles },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'data', label: 'Data', icon: Database },
]

function SectionHeading({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">{body}</p>
    </div>
  )
}

function StatusRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-3.5 py-2.5 last:border-b-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd
        className={cn(
          'max-w-[62%] text-right text-[11px] font-medium text-ink',
          mono && 'font-mono text-[10px]',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function AccountSettings() {
  const user = useAuthStore((state) => state.user)
  const updateProfile = useAuthStore((state) => state.updateProfile)
  const changePassword = useAuthStore((state) => state.changePassword)
  const logout = useAuthStore((state) => state.logout)
  const pushToast = useUiStore((state) => state.pushToast)
  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [profilePending, setProfilePending] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordPending, setPasswordPending] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  if (!user) return null

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setProfilePending(true)
    setProfileError(null)
    try {
      await updateProfile(displayName.trim())
      pushToast('success', 'Profile updated')
    } catch (caught) {
      setProfileError(errorMessage(caught))
    } finally {
      setProfilePending(false)
    }
  }

  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPasswordError(null)
    if (newPassword !== confirmPassword) {
      setPasswordError('The new passwords do not match.')
      return
    }
    setPasswordPending(true)
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      pushToast('success', 'Password changed', 'Other sessions have been signed out.')
    } catch (caught) {
      setPasswordError(errorMessage(caught))
    } finally {
      setPasswordPending(false)
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading
          title="Profile"
          body="Your display name appears in the sidebar and on exported spaces."
        />
        <form onSubmit={saveProfile} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name" htmlFor="settings-display-name">
              <TextInput
                id="settings-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={80}
                required
              />
            </Field>
            <Field label="Email" htmlFor="settings-email">
              <TextInput id="settings-email" value={user.email} disabled readOnly />
            </Field>
          </div>
          {profileError && (
            <p role="alert" className="text-[11px] text-danger">
              {profileError}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={profilePending}>
              Save profile
            </Button>
          </div>
        </form>
      </section>

      <section className="border-t border-border pt-7">
        <SectionHeading
          title="Password"
          body="Changing your password signs out every other active session."
        />
        <form onSubmit={savePassword} className="space-y-4">
          <Field label="Current password" htmlFor="current-password">
            <TextInput
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password" htmlFor="new-password">
              <TextInput
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={8}
                maxLength={128}
                required
              />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm-password">
              <TextInput
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                maxLength={128}
                required
              />
            </Field>
          </div>
          {passwordError && (
            <p role="alert" className="text-[11px] text-danger">
              {passwordError}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={passwordPending}>
              Change password
            </Button>
          </div>
        </form>
      </section>

      <section className="flex items-center justify-between gap-4 border-t border-border pt-7">
        <div>
          <p className="text-xs font-medium text-ink">Sign out of this device</p>
          <p className="mt-0.5 text-[11px] text-muted">
            The session cookie is revoked immediately.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void logout()}>
          Sign out
        </Button>
      </section>
    </div>
  )
}

function AiSettings() {
  const health = useAuthStore((state) => state.health)
  const healthError = useAuthStore((state) => state.healthError)
  const refreshHealth = useAuthStore((state) => state.refreshHealth)
  const [pending, setPending] = useState(false)

  const refresh = async () => {
    setPending(true)
    try {
      await refreshHealth()
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <SectionHeading
          title="AI status"
          body="BranchMind uses Gemini only on the server. In mock mode, no AI request leaves this machine."
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void refresh()}
          loading={pending}
          leadingIcon={!pending ? <RefreshCw size={13} aria-hidden /> : undefined}
        >
          Refresh
        </Button>
      </div>

      <div className="mb-5 flex items-center gap-3 rounded-xl border border-border bg-subtle/60 p-3.5">
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-lg',
            health?.llm_mode === 'gemini'
              ? 'bg-success-soft text-success'
              : 'bg-warning-soft text-warning',
          )}
        >
          {health?.llm_mode === 'gemini' ? (
            <Sparkles size={17} aria-hidden />
          ) : (
            <Monitor size={17} aria-hidden />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink">
            {health?.llm_mode === 'gemini' ? 'Live Gemini' : 'Local mock provider'}
          </p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
            {health?.llm_mode === 'gemini'
              ? 'Replies and embeddings may use the Gemini API.'
              : 'Replies, embeddings, and extraction are deterministic and local.'}
          </p>
        </div>
      </div>

      {healthError && (
        <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-[11px] text-danger">
          {healthError}
        </p>
      )}

      <dl className="overflow-hidden rounded-xl border border-border">
        <StatusRow label="Backend health" value={health ? sentenceCase(health.status) : 'Unknown'} />
        <StatusRow
          label="Gemini reachable"
          value={
            health?.gemini.reachable === true
              ? 'Yes'
              : health?.gemini.reachable === false
                ? 'No'
                : 'Not checked'
          }
        />
        <StatusRow
          label="API key"
          value={health?.gemini.configured ? 'Configured · server only' : 'Not configured'}
        />
        <StatusRow
          label="Chat model"
          value={health?.gemini.chat_model ?? 'gemini-3.8-flash'}
          mono
        />
        <StatusRow
          label="Embedding model"
          value={health?.gemini.embed_model ?? 'gemini-embedding-001'}
          mono
        />
      </dl>

      <div className="mt-5 rounded-xl border border-border bg-subtle/50 p-4">
        <div className="mb-2 flex items-center gap-1.5">
          <ShieldCheck size={14} className="text-accent" aria-hidden />
          <p className="text-[11px] font-medium text-ink">Privacy boundary</p>
        </div>
        <ul className="space-y-1.5 text-[10px] leading-relaxed text-muted">
          <li>The Gemini key lives in the backend environment and is never sent to the browser.</li>
          <li>Live prompts include the visible conversation, selected memories, and profile context.</li>
          <li>Mock mode makes no external AI requests and is labelled throughout the app.</li>
        </ul>
      </div>
    </div>
  )
}

const themeOptions: Array<{
  id: Theme
  label: string
  description: string
  icon: typeof Sun
}> = [
  { id: 'system', label: 'System', description: 'Follow your OS preference.', icon: Monitor },
  { id: 'light', label: 'Light', description: 'Warm paper and terracotta.', icon: Sun },
  { id: 'dark', label: 'Dark', description: 'Charcoal with a softer glow.', icon: Moon },
]

function AppearanceSettings() {
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)

  return (
    <div>
      <SectionHeading
        title="Appearance"
        body="BranchMind respects your system theme until you choose a preference."
      />
      <div className="grid gap-2.5 sm:grid-cols-3">
        {themeOptions.map((option) => {
          const Icon = option.icon
          const selected = theme === option.id
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setTheme(option.id)}
              className={cn(
                'rounded-xl border p-3 text-left transition-all duration-150',
                selected
                  ? 'border-accent bg-accent-soft shadow-soft'
                  : 'border-border bg-surface hover:bg-hover',
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'grid size-7 place-items-center rounded-lg',
                    selected ? 'bg-surface text-accent' : 'bg-subtle text-muted',
                  )}
                >
                  <Icon size={15} aria-hidden />
                </span>
                {selected && <span className="size-1.5 rounded-full bg-accent" aria-hidden />}
              </div>
              <p className="mt-3 text-xs font-medium text-ink">{option.label}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
                {option.description}
              </p>
              <div className="mt-3 flex gap-1" aria-hidden>
                <span className="h-1.5 flex-1 rounded-full bg-bg" />
                <span className="h-1.5 flex-1 rounded-full bg-sidebar" />
                <span className="h-1.5 flex-1 rounded-full bg-accent" />
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-subtle/50 p-4">
        <p className="text-[11px] font-medium text-ink">Typography</p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted">
          Inter is used for controls, Source Serif 4 for assistant prose, and JetBrains Mono
          for code. Fonts are self-hosted for offline use.
        </p>
        <p className="mt-3 font-serif text-base text-ink">
          A calmer surface for thinking out loud.
        </p>
      </div>
    </div>
  )
}

function DataSettings() {
  const space = useWorkspaceStore(selectCurrentSpace)
  const importSpace = useWorkspaceStore((state) => state.importSpace)
  const createDemo = useWorkspaceStore((state) => state.createDemo)
  const pushToast = useUiStore((state) => state.pushToast)
  const [exportPending, setExportPending] = useState(false)
  const [importPending, setImportPending] = useState(false)
  const [demoPending, setDemoPending] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadDemo = async () => {
    setDemoPending(true)
    setDataError(null)
    try {
      await createDemo()
      pushToast(
        'success',
        'Demo space loaded',
        'Three branches, five memories, one merge, and a pending proposal.',
      )
    } catch (caught) {
      setDataError(errorMessage(caught))
    } finally {
      setDemoPending(false)
    }
  }

  const exportSpace = async () => {
    if (!space) return
    setExportPending(true)
    setDataError(null)
    try {
      const data = await api.get<unknown>(`/spaces/${space.id}/export`)
      downloadJson(
        data,
        `branchmind-${slugify(space.name)}-${new Date().toISOString().slice(0, 10)}.json`,
      )
      pushToast('success', 'Space exported', 'The JSON file is ready in your downloads.')
    } catch (caught) {
      setDataError(errorMessage(caught))
    } finally {
      setExportPending(false)
    }
  }

  const importFile = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      setDataError('That export is larger than the 20 MB import limit.')
      return
    }
    setImportPending(true)
    setDataError(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('The selected file is not a BranchMind export.')
      }
      const result = await importSpace(parsed)
      pushToast(
        'success',
        'Space imported',
        `${plural(result.branch_count, 'branch', 'branches')}, ${plural(result.commit_count, 'message')}, ${plural(result.memory_count, 'memory', 'memories')}.`,
      )
    } catch (caught) {
      setDataError(
        caught instanceof SyntaxError
          ? 'The selected file is not valid JSON.'
          : errorMessage(caught),
      )
    } finally {
      setImportPending(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      <SectionHeading
        title="Local data"
        body="Export a portable copy of a space, or import an export as a new space owned by you."
      />

      <div className="space-y-3">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-subtle/40 p-3.5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink">Load the guided demo</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
              A reading-list space with two forks, one merge, a checkpoint, and a
              pending memory proposal. Seeded locally, no model call.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={demoPending}
            onClick={() => void loadDemo()}
            leadingIcon={!demoPending ? <Play size={13} aria-hidden /> : undefined}
          >
            Load demo
          </Button>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border p-3.5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink">Export current space</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
              {space
                ? `${space.name} · branches, messages, memories, and checkpoints.`
                : 'Create or choose a space first.'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!space}
            loading={exportPending}
            onClick={() => void exportSpace()}
            leadingIcon={!exportPending ? <Download size={13} aria-hidden /> : undefined}
          >
            Export JSON
          </Button>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border p-3.5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink">Import a space</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
              IDs are remapped and owner details are never imported.
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importFile(file)
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={importPending}
            onClick={() => fileRef.current?.click()}
            leadingIcon={!importPending ? <Upload size={13} aria-hidden /> : undefined}
          >
            Choose file
          </Button>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border p-3.5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink">Rebuild embeddings</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
              Regenerate vectors after changing the embedding model.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled
            title="Embedding rebuild is not available yet"
          >
            Rebuild
          </Button>
        </div>
      </div>

      {dataError && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-[11px] text-danger">
          {dataError}
        </p>
      )}

      <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-border bg-subtle/50 p-3.5">
        <KeyRound size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <p className="text-[10px] leading-relaxed text-muted">
          Exports contain conversation text and memory content. Store them carefully. The
          SQLite database and session tokens are never included.
        </p>
      </div>
    </div>
  )
}

export function SettingsDialog() {
  const open = useUiStore((state) => state.settingsOpen)
  const setOpen = useUiStore((state) => state.setSettingsOpen)
  const [tab, setTab] = useState<Tab>('account')

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Settings"
      description="Account, AI provider, appearance, and local data."
      size="lg"
    >
      <div className="grid gap-5 sm:grid-cols-[136px_minmax(0,1fr)]">
        <div
          role="tablist"
          aria-label="Settings sections"
          className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible"
        >
          {tabs.map((item) => {
            const Icon = item.icon
            const selected = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`settings-panel-${item.id}`}
                id={`settings-tab-${item.id}`}
                onClick={() => setTab(item.id)}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-medium transition-colors',
                  selected
                    ? 'bg-accent-soft text-accent-ink'
                    : 'text-muted hover:bg-hover hover:text-ink',
                )}
              >
                <Icon size={14} aria-hidden />
                {item.label}
              </button>
            )
          })}
        </div>

        <div
          role="tabpanel"
          id={`settings-panel-${tab}`}
          aria-labelledby={`settings-tab-${tab}`}
          className="min-w-0"
        >
          {tab === 'account' && <AccountSettings />}
          {tab === 'ai' && <AiSettings />}
          {tab === 'appearance' && <AppearanceSettings />}
          {tab === 'data' && <DataSettings />}
        </div>
      </div>
    </Dialog>
  )
}
