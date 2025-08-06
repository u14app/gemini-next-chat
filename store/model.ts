import { create } from 'zustand'
import { persist, type StorageValue } from 'zustand/middleware'
import storage from '@/utils/Storage'
import { omitBy, isFunction } from 'lodash-es'

type ModelStore = {
  models: Model[]
  update: (models: Model[]) => void
}

export const useModelStore = create(
  persist<ModelStore>(
    (set) => ({
      models: [],
      update: (models) => set(() => ({ models: [...models] })),
    }),
    {
      name: 'modelStore',
      version: 1,
      storage: {
        getItem: async (key: string) => {
          return await storage.getItem<StorageValue<ModelStore>>(key)
        },
        setItem: async (key: string, store: StorageValue<ModelStore>) => {
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
