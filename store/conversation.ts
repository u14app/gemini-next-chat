import { create } from 'zustand'
import { persist, type StorageValue } from 'zustand/middleware'
import storage from '@/utils/Storage'
import { omitBy, isFunction } from 'lodash-es'

type ConversationStore = {
  conversationList: Record<string, Conversation>
  pinned: string[]
  currentId: string
  query: (id: string) => Conversation
  addOrUpdate: (id: string, conversation: Conversation) => void
  remove: (id: string) => void
  pin: (id: string) => void
  unpin: (id: string) => void
  copy: (id: string, newId: string) => void
  setCurrentId: (id: string) => void
}

export const useConversationStore = create(
  persist<ConversationStore>(
    (set, get) => ({
      conversationList: {},
      pinned: [],
      currentId: 'default',
      query: (id) => get().conversationList[id],
      addOrUpdate: (id, conversation) => {
        const list = get().conversationList
        list[id] = { ...conversation }
        set(() => ({ conversationList: { ...list } }))
      },
      remove: (id) => {
        const list = get().conversationList
        delete list[id]
        set(() => ({ conversationList: { ...list } }))
      },
      pin: (id) => {
        set((state) => ({ pinned: [...state.pinned, id] }))
      },
      unpin: (id) => {
        const newPinned = get().pinned.filter((item) => item !== id)
        set(() => ({ pinned: newPinned }))
      },
      copy: (id, newId) => {
        set((state) => {
          const list = state.conversationList
          const original = state.query(id)
          list[newId] = { ...original }
          return { conversationList: { ...list } }
        })
      },
      setCurrentId: (id) => {
        set(() => ({ currentId: id }))
      },
    }),
    {
      name: 'conversationStore',
      version: 1,
      storage: {
        getItem: async (key: string) => {
          return await storage.getItem<StorageValue<ConversationStore>>(key)
        },
        setItem: async (key: string, store: StorageValue<ConversationStore>) => {
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
