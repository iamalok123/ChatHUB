import { create } from 'zustand'

import { ApiError, api, errorMessage } from '../api/client'
import type { AuthConfig, AuthResponse, Health, User } from '../api/types'
import { useUiStore } from './ui'
import { useWorkspaceStore } from './workspace'

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'offline'

type AuthState = {
  status: AuthStatus
  user: User | null
  config: AuthConfig | null
  health: Health | null
  healthError: string | null
  bootError: string | null
  bootstrap: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, displayName: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (displayName: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  refreshHealth: () => Promise<void>
}

let bootstrapPromise: Promise<void> | null = null

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: 'loading',
  user: null,
  config: null,
  health: null,
  healthError: null,
  bootError: null,

  bootstrap: () => {
    if (bootstrapPromise) return bootstrapPromise

    bootstrapPromise = (async () => {
      set({ status: 'loading', bootError: null })
      const [configResult, healthResult, meResult] = await Promise.allSettled([
        api.get<AuthConfig>('/auth/config'),
        api.get<Health>('/health'),
        api.get<User>('/auth/me'),
      ])

      const config = configResult.status === 'fulfilled' ? configResult.value : null
      const health = healthResult.status === 'fulfilled' ? healthResult.value : null
      const healthError =
        healthResult.status === 'rejected' ? errorMessage(healthResult.reason) : null

      if (meResult.status === 'fulfilled') {
        set({
          status: 'authenticated',
          user: meResult.value,
          config,
          health,
          healthError,
          bootError: config ? null : 'Account settings could not be loaded.',
        })
        return
      }

      if (meResult.reason instanceof ApiError && meResult.reason.status === 401) {
        set({
          status: 'anonymous',
          user: null,
          config,
          health,
          healthError,
          bootError: null,
        })
        return
      }

      set({
        status: 'offline',
        user: null,
        config,
        health,
        healthError,
        bootError: errorMessage(meResult.reason),
      })
    })().finally(() => {
      bootstrapPromise = null
    })

    return bootstrapPromise
  },

  login: async (email, password) => {
    const result = await api.post<AuthResponse>('/auth/login', { email, password })
    set({ user: result.user, status: 'authenticated', bootError: null })
  },

  signup: async (email, displayName, password) => {
    const result = await api.post<AuthResponse>('/auth/signup', {
      email,
      display_name: displayName,
      password,
    })
    set({ user: result.user, status: 'authenticated', bootError: null })
  },

  logout: async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      useWorkspaceStore.getState().reset()
      const ui = useUiStore.getState()
      ui.setSettingsOpen(false)
      ui.setNewSpaceOpen(false)
      ui.setSidebarOpen(false)
      set({ user: null, status: 'anonymous', bootError: null })
    }
  },

  updateProfile: async (displayName) => {
    const user = await api.patch<User>('/auth/me', { display_name: displayName })
    set({ user })
  },

  changePassword: async (currentPassword, newPassword) => {
    await api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    })
  },

  refreshHealth: async () => {
    try {
      const health = await api.get<Health>('/health')
      set({ health, healthError: null })
    } catch (error) {
      set({ healthError: errorMessage(error) })
      if (get().status === 'offline') {
        await get().bootstrap()
      }
    }
  },
}))
