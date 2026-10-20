import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'
export type ToastKind = 'info' | 'success' | 'error'
export type InspectorTab = 'memory' | 'why' | 'graph' | 'settings'

export type Toast = {
  id: string
  kind: ToastKind
  title: string
  description?: string
}

const THEME_KEY = 'branchmind-theme'
let toastSequence = 0

export function readTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = window.localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    return 'system'
  }
  return 'system'
}

export function resolvedTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'system') {
    delete root.dataset.theme
  } else {
    root.dataset.theme = theme
  }
  try {
    window.localStorage.setItem(THEME_KEY, theme)
  } catch {
    return
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) {
    meta.content = resolvedTheme(theme) === 'dark' ? '#262624' : '#FAF9F5'
  }
}

type UiState = {
  theme: Theme
  sidebarOpen: boolean
  inspectorOpen: boolean
  inspectorTab: InspectorTab
  settingsOpen: boolean
  newSpaceOpen: boolean
  focusedCommitId: string | null
  toasts: Toast[]
  setTheme: (theme: Theme) => void
  setSidebarOpen: (open: boolean) => void
  setInspectorOpen: (open: boolean) => void
  setInspectorTab: (tab: InspectorTab) => void
  setSettingsOpen: (open: boolean) => void
  setNewSpaceOpen: (open: boolean) => void
  focusCommit: (commitId: string) => void
  clearFocusedCommit: () => void
  pushToast: (kind: ToastKind, title: string, description?: string) => string
  dismissToast: (id: string) => void
}

export const useUiStore = create<UiState>()((set, get) => ({
  theme: readTheme(),
  sidebarOpen: false,
  inspectorOpen: true,
  inspectorTab: 'memory',
  settingsOpen: false,
  newSpaceOpen: false,
  focusedCommitId: null,
  toasts: [],
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setNewSpaceOpen: (newSpaceOpen) => set({ newSpaceOpen }),
  focusCommit: (focusedCommitId) => set({ focusedCommitId }),
  clearFocusedCommit: () => set({ focusedCommitId: null }),
  pushToast: (kind, title, description) => {
    const id = `toast-${++toastSequence}`
    set((state) => ({ toasts: [...state.toasts, { id, kind, title, description }] }))
    window.setTimeout(() => get().dismissToast(id), 5000)
    return id
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
