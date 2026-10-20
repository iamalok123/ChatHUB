import {
  ArrowRight,
  Brain,
  Eye,
  EyeOff,
  GitBranch,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { errorMessage } from '../api/client'
import { Brand, BrandMark } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { Field, TextInput } from '../components/ui/Field'
import { ThemeToggle } from '../components/ui/ThemeToggle'
import { useAuthStore } from '../store/auth'

type Mode = 'login' | 'signup'

const features = [
  {
    icon: GitBranch,
    title: 'Branch any conversation',
    body: 'Fork from any message and explore a direction without losing the original thread.',
  },
  {
    icon: Brain,
    title: 'Memory you can inspect',
    body: 'See which memories shaped each answer, then pin, edit, exclude, or merge them.',
  },
  {
    icon: ShieldCheck,
    title: 'Local by default',
    body: 'Your database and sessions stay on this machine. No accounts, cloud, or telemetry.',
  },
]

export function AuthScreen() {
  const config = useAuthStore((state) => state.config)
  const health = useAuthStore((state) => state.health)
  const login = useAuthStore((state) => state.login)
  const signup = useAuthStore((state) => state.signup)
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSignup = config?.signup_enabled !== false
  const activeMode: Mode = canSignup ? mode : 'login'
  const providerMode = config?.llm_mode ?? health?.llm_mode

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      if (activeMode === 'signup') {
        await signup(email.trim(), displayName.trim(), password)
      } else {
        await login(email.trim(), password)
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  const changeMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setPassword('')
  }

  return (
    <main className="relative min-h-svh overflow-y-auto bg-bg">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2 sm:top-6 sm:right-6">
        <span className="hidden items-center gap-1.5 rounded-full border border-border bg-surface/80 px-2.5 py-1 text-[11px] text-muted shadow-soft backdrop-blur sm:inline-flex">
          <span
            className={`size-1.5 rounded-full ${
              providerMode === 'gemini'
                ? 'bg-success'
                : providerMode === 'mock'
                  ? 'bg-warning'
                  : 'bg-muted'
            }`}
          />
          {providerMode === 'gemini'
            ? 'Gemini AI'
            : providerMode === 'mock'
              ? 'Mock AI'
              : 'AI status unknown'}
        </span>
        <ThemeToggle className="border border-border bg-surface/80 shadow-soft backdrop-blur" />
      </div>

      <div className="grid min-h-svh lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden overflow-hidden border-r border-border bg-sidebar px-12 py-10 lg:flex lg:flex-col xl:px-16 xl:py-14">
          <div className="auth-grid absolute inset-0 opacity-55" aria-hidden />
          <div
            className="absolute -top-40 -left-24 size-105 rounded-full bg-accent/10 blur-3xl"
            aria-hidden
          />
          <div
            className="absolute -right-30 -bottom-40 size-90 rounded-full bg-warning/10 blur-3xl"
            aria-hidden
          />

          <div className="relative z-10">
            <Brand />
          </div>

          <div className="relative z-10 my-auto max-w-xl py-16">
            <p className="mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-accent uppercase">
              <span className="h-px w-7 bg-accent/60" />
              Git for chatbot memory
            </p>
            <h1 className="font-serif text-[clamp(2.8rem,4.5vw,4.5rem)] leading-[1.03] tracking-[-0.035em] text-ink">
              Conversations branch. Memory should too.
            </h1>
            <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-muted">
              ChatHUB makes every thread a branch, every preference a versioned
              memory, and every answer explainable.
            </p>

            <div className="mt-10 space-y-5">
              {features.map((feature) => (
                <div key={feature.title} className="flex gap-3.5">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface text-accent shadow-soft">
                    <feature.icon size={16} aria-hidden />
                  </span>
                  <div>
                    <h2 className="text-sm font-medium text-ink">{feature.title}</h2>
                    <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted">
                      {feature.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="relative z-10 flex items-center gap-2 text-[11px] text-muted">
            <LockKeyhole size={13} aria-hidden />
            Local-first. Your conversations stay safe and private.
          </p>
        </section>

        <section className="relative flex min-h-svh flex-col px-5 py-8 sm:px-10 lg:px-12 xl:px-20">
          <div className="mb-12 flex items-center gap-2 lg:hidden">
            <BrandMark />
            <span className="text-[17px] font-semibold tracking-tight">ChatHUB</span>
          </div>

          <div className="m-auto w-full max-w-105 animate-fade-in">
            <div className="mb-7">
              <p className="mb-1.5 text-xs font-medium text-accent">
                {activeMode === 'login' ? 'Welcome back' : 'Create your local account'}
              </p>
              <h2 className="text-2xl font-semibold tracking-tight text-ink">
                {activeMode === 'login' ? 'Sign in to your mind' : 'Start a mind of your own'}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {activeMode === 'login'
                  ? 'Pick up your spaces, branches, and memories exactly where you left them.'
                  : 'One account owns every space. No email verification, no cloud dependency.'}
              </p>
            </div>

            <div
              role="tablist"
              aria-label="Authentication mode"
              className="mb-6 grid grid-cols-2 rounded-xl border border-border bg-sidebar p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeMode === 'login'}
                disabled={pending}
                onClick={() => changeMode('login')}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150 ${
                  activeMode === 'login'
                    ? 'bg-surface text-ink shadow-soft'
                    : 'text-muted hover:text-ink'
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeMode === 'signup'}
                onClick={() => canSignup && changeMode('signup')}
                disabled={!canSignup || pending}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${
                  activeMode === 'signup'
                    ? 'bg-surface text-ink shadow-soft'
                    : 'text-muted hover:text-ink'
                }`}
              >
                Create account
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {activeMode === 'signup' && (
                <Field label="Display name" htmlFor="display-name">
                  <TextInput
                    id="display-name"
                    name="name"
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Ada Lovelace"
                    required
                    maxLength={80}
                    autoFocus
                  />
                </Field>
              )}

              <Field label="Email" htmlFor="email">
                <TextInput
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus={activeMode === 'login'}
                />
              </Field>

              <Field
                label="Password"
                htmlFor="password"
                hint={activeMode === 'signup' ? 'At least 8 characters.' : undefined}
              >
                <div className="relative">
                  <TextInput
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={activeMode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    maxLength={128}
                    className="pr-11"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink"
                  >
                    {showPassword ? (
                      <EyeOff size={16} aria-hidden />
                    ) : (
                      <Eye size={16} aria-hidden />
                    )}
                  </button>
                </div>
              </Field>

              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-xs leading-relaxed text-danger"
                >
                  {error}
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="mt-1 w-full"
                loading={pending}
                trailingIcon={!pending ? <ArrowRight size={16} aria-hidden /> : undefined}
              >
                {activeMode === 'login' ? 'Sign in' : 'Create account'}
              </Button>
            </form>

            {!canSignup && (
              <p className="mt-4 rounded-lg bg-subtle px-3 py-2 text-center text-[11px] text-muted">
                New signups are disabled by the server owner.
              </p>
            )}

            <div className="mt-7 flex items-start gap-2.5 rounded-xl border border-border bg-subtle/70 p-3.5">
              <Sparkles size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <p className="text-[11px] leading-relaxed text-muted">
                In live mode, prompts and selected memories are sent to Gemini for
                generation and embeddings. The API key stays in the backend.{' '}
                {providerMode === 'mock' &&
                  'Mock mode is active, so no AI data leaves this machine.'}
              </p>
            </div>

            <p className="mt-6 text-center text-[10px] leading-relaxed text-muted">
              ChatHUB runs locally and securely. Sessions are stored in an HttpOnly cookie.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
