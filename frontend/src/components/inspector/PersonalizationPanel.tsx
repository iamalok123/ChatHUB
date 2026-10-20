import { Save, Sparkles, UserRound } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Branch, Space } from '../../api/types'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'
import { Button } from '../ui/Button'
import { Field, TextInput, Textarea } from '../ui/Field'

const selectClass =
  'w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[11px] text-ink shadow-soft transition-colors hover:border-muted/45 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15'

const profileKeys = ['about', 'tone', 'language', 'expertise'] as const
type ProfileKey = (typeof profileKeys)[number]
type ProfileDraft = Record<ProfileKey, string>

function readProfile(profile: Record<string, unknown>): ProfileDraft {
  return {
    about: typeof profile.about === 'string' ? profile.about : '',
    tone: typeof profile.tone === 'string' ? profile.tone : '',
    language: typeof profile.language === 'string' ? profile.language : '',
    expertise: typeof profile.expertise === 'string' ? profile.expertise : '',
  }
}

function SectionTitle({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
        {icon}
      </span>
      <div>
        <p className="text-[11px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[9px] leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  )
}

export function PersonalizationPanel({
  branch,
  space,
}: {
  branch: Branch
  space: Space
}) {
  const upsertSpace = useWorkspaceStore((state) => state.upsertSpace)
  const upsertBranch = useWorkspaceStore((state) => state.upsertBranch)
  const pushToast = useUiStore((state) => state.pushToast)
  const [profile, setProfile] = useState<ProfileDraft>(() => readProfile(space.profile))
  const [profilePending, setProfilePending] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [persona, setPersona] = useState(branch.persona)
  const [systemPrompt, setSystemPrompt] = useState(branch.system_prompt)
  const [thinkingLevel, setThinkingLevel] = useState(branch.thinking_level)
  const [topK, setTopK] = useState(branch.top_k)
  const [memoryMode, setMemoryMode] = useState(branch.memory_mode)
  const [branchPending, setBranchPending] = useState(false)
  const [branchError, setBranchError] = useState<string | null>(null)

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setProfilePending(true)
    setProfileError(null)
    try {
      const nextProfile: Record<string, unknown> = { ...space.profile }
      for (const key of profileKeys) {
        const value = profile[key].trim()
        if (value) {
          nextProfile[key] = value
        } else {
          delete nextProfile[key]
        }
      }
      const updated = await api.patch<Space>(`/spaces/${space.id}`, {
        profile: nextProfile,
      })
      upsertSpace(updated)
      pushToast('success', 'Profile updated', 'The next reply will use this context.')
    } catch (caught) {
      setProfileError(errorMessage(caught))
    } finally {
      setProfilePending(false)
    }
  }

  const saveBranch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBranchPending(true)
    setBranchError(null)
    try {
      const updated = await api.patch<Branch>(`/branches/${branch.id}`, {
        persona,
        system_prompt: systemPrompt,
        thinking_level: thinkingLevel,
        top_k: topK,
        memory_mode: memoryMode,
      })
      upsertBranch(updated)
      pushToast('success', 'Branch voice updated', 'New replies use these settings.')
    } catch (caught) {
      setBranchError(errorMessage(caught))
    } finally {
      setBranchPending(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-surface p-3 shadow-soft">
        <SectionTitle
          icon={<UserRound size={13} aria-hidden />}
          title={`${space.name} profile`}
          body="Personal context shared by every branch in this space."
        />
        <form onSubmit={saveProfile} className="space-y-2.5">
          <Field label="About you" htmlFor="profile-about" optional>
            <Textarea
              id="profile-about"
              value={profile.about}
              onChange={(event) =>
                setProfile((current) => ({ ...current, about: event.target.value }))
              }
              rows={3}
              maxLength={1600}
              placeholder="Your role, goals, and context."
            />
          </Field>
          <Field label="Preferred tone" htmlFor="profile-tone" optional>
            <TextInput
              id="profile-tone"
              value={profile.tone}
              onChange={(event) =>
                setProfile((current) => ({ ...current, tone: event.target.value }))
              }
              maxLength={120}
              placeholder="Direct, warm, concise..."
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Language" htmlFor="profile-language" optional>
              <TextInput
                id="profile-language"
                value={profile.language}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    language: event.target.value,
                  }))
                }
                maxLength={120}
                placeholder="English"
              />
            </Field>
            <Field label="Expertise" htmlFor="profile-expertise" optional>
              <TextInput
                id="profile-expertise"
                value={profile.expertise}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    expertise: event.target.value,
                  }))
                }
                maxLength={120}
                placeholder="Product, design"
              />
            </Field>
          </div>
          {profileError && (
            <p role="alert" className="text-[10px] text-danger">
              {profileError}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[8px] leading-relaxed text-muted">
              Custom profile fields are preserved.
            </p>
            <Button
              type="submit"
              size="sm"
              loading={profilePending}
              leadingIcon={!profilePending ? <Save size={11} aria-hidden /> : undefined}
            >
              Save profile
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-border bg-surface p-3 shadow-soft">
        <SectionTitle
          icon={<Sparkles size={13} aria-hidden />}
          title="Branch voice"
          body="Shape how this branch replies without changing its ancestors."
        />
        <form onSubmit={saveBranch} className="space-y-2.5">
          <Field label="Branch persona" htmlFor="branch-persona" optional>
            <Textarea
              id="branch-persona"
              value={persona}
              onChange={(event) => setPersona(event.target.value)}
              rows={3}
              maxLength={8000}
              placeholder="A focused product partner who asks clarifying questions."
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Thinking level" htmlFor="branch-thinking">
              <select
                id="branch-thinking"
                value={thinkingLevel}
                onChange={(event) => setThinkingLevel(event.target.value)}
                className={selectClass}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
            <Field label="Memory mode" htmlFor="branch-memory-mode">
              <select
                id="branch-memory-mode"
                value={memoryMode}
                onChange={(event) => setMemoryMode(event.target.value)}
                className={selectClass}
              >
                <option value="review">Review</option>
                <option value="auto">Auto</option>
                <option value="off">Off</option>
              </select>
            </Field>
          </div>
          <Field
            label={`Memory strength: top ${topK}`}
            htmlFor="branch-top-k"
            hint="How many memories retrieval may include."
          >
            <input
              id="branch-top-k"
              type="range"
              min={1}
              max={20}
              step={1}
              value={topK}
              onChange={(event) => setTopK(Number(event.target.value))}
              className="w-full accent-[var(--color-accent)]"
            />
          </Field>
          <details className="group">
            <summary className="cursor-pointer list-none text-[10px] font-medium text-muted hover:text-ink">
              Advanced system prompt
            </summary>
            <div className="mt-2">
              <Field label="System prompt" htmlFor="branch-system-prompt" optional>
                <Textarea
                  id="branch-system-prompt"
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  rows={4}
                  maxLength={8000}
                  className="font-mono text-[10px]"
                  placeholder="Additional instructions for this branch."
                />
              </Field>
            </div>
          </details>
          {branchError && (
            <p role="alert" className="text-[10px] text-danger">
              {branchError}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={branchPending}>
              Save branch voice
            </Button>
          </div>
        </form>
      </section>

      <p className="px-1 text-[9px] leading-relaxed text-muted">
        Personalization is sent as data in the system instruction. Changes apply to the
        next reply, never to earlier messages.
      </p>
    </div>
  )
}
