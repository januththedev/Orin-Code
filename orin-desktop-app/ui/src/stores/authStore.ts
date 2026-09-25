import { create } from 'zustand'
import { bridge, type AuthStatus } from '../bridge/client'

interface AuthStore {
  status: AuthStatus | null
  busy: boolean
  /** User code shown while a browser sign-in is pending approval (null otherwise). */
  deviceUserCode: string | null
  hydrate: () => Promise<void>
  login: (identifier: string, password: string) => Promise<string | null>
  register: (name: string, email: string, phone: string, password: string) => Promise<string | null>
  loginWithBrowser: () => Promise<string | null>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  status: null,
  busy: false,
  deviceUserCode: null,

  hydrate: async () => {
    try {
      set({ status: await bridge.authStatus() })
    } catch {
      set({ status: { signedIn: false, session: null } })
    }
  },

  login: async (identifier, password) => {
    set({ busy: true })
    try {
      const session = await bridge.authLogin(identifier, password)
      set({ status: { signedIn: true, session }, busy: false })
      return null
    } catch (error) {
      set({ busy: false })
      return error instanceof Error ? error.message : String(error)
    }
  },

  register: async (name, email, phone, password) => {
    set({ busy: true })
    try {
      const session = await bridge.authRegister(name, email, phone, password)
      set({ status: { signedIn: true, session }, busy: false })
      return null
    } catch (error) {
      set({ busy: false })
      return error instanceof Error ? error.message : String(error)
    }
  },

  loginWithBrowser: async () => {
    if (useAuthStore.getState().busy) return null
    set({ busy: true, deviceUserCode: null })
    try {
      const start = await bridge.authDeviceStart()
      set({ deviceUserCode: start.userCode })
      const session = await bridge.authDeviceWait(start.deviceCode)
      set({ status: { signedIn: true, session }, busy: false, deviceUserCode: null })
      return null
    } catch (error) {
      set({ busy: false, deviceUserCode: null })
      return error instanceof Error ? error.message : String(error)
    }
  },

  logout: async () => {
    try {
      await bridge.authLogout()
    } finally {
      set({ status: { signedIn: false, session: null } })
    }
  },
}))
