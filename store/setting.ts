import { create } from 'zustand'
import { DefaultModel } from '@/constant/model'

type DefaultSetting = Omit<Setting, 'isProtected' | 'talkMode' | 'sidebarState'>

interface SettingStore extends Setting {
  update: (values: Partial<Setting>) => void
  reset: () => DefaultSetting
}

interface EnvStore {
  modelList: string
  uploadLimit: number
  buildMode: string
  isProtected: boolean
  update: (values: Record<string, string | number | boolean>) => void
}

const defaultSetting: DefaultSetting = {
  password: '',
  apiKey: '',
  apiProxy: '',
  model: DefaultModel,
  sttLang: '',
  ttsLang: '',
  ttsVoice: '',
  lang: '',
  maxHistoryLength: 0,
  assistantIndexUrl: '',
  topP: 0.95,
  topK: 40,
  temperature: 1,
  maxOutputTokens: 8192,
  safety: 'none',
  autoStartRecord: false,
  autoStopRecord: false,
}

export const useSettingStore = create<SettingStore>((set) => ({
  ...defaultSetting,
  talkMode: 'chat',
  sidebarState: 'collapsed',
  update: (values) => set((state) => ({ ...state, ...values })),
  reset: () => {
    set(defaultSetting)
    return defaultSetting
  },
}))

export const useEnvStore = create<EnvStore>((set) => ({
  modelList: '',
  uploadLimit: 0,
  buildMode: '',
  isProtected: true,
  update: (values) => set(values),
}))
