import { create } from 'zustand'
import { persist, type StorageValue } from 'zustand/middleware'
import storage from '@/utils/Storage'
import { omitBy, isFunction } from 'lodash-es'

export interface MultimodalLiveStore {
  apiKey: string
  apiProxy: string
  voiceName: string
  responseModalities: string
  isVideoStreaming: boolean
  update: (values: Partial<MultimodalLiveStore>) => void
}

export const useMultimodalLiveStore = create(
  persist<MultimodalLiveStore>(
    (set) => ({
      apiKey: '',
      apiProxy: '',
      voiceName: 'Aoede',
      responseModalities: 'Audio',
      isVideoStreaming: false,
      update: (values) => set((state) => ({ ...state, ...values })),
    }),
    {
      name: 'multimodalLiveStore',
      version: 1,
      storage: {
        getItem: async (key: string) => {
          return await storage.getItem<StorageValue<MultimodalLiveStore>>(key)
        },
        setItem: async (key: string, store: StorageValue<MultimodalLiveStore>) => {
          return await storage.setItem(key, {
            state: omitBy(store.state, (item) => isFunction(item)),
            version: store.version,
          })
        },
        removeItem: async (key: string) => await storage.removeItem(key),
      },
    },
  ),
)
