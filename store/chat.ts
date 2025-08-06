import { create } from 'zustand'
import { persist, type StorageValue } from 'zustand/middleware'
import type { InlineDataPart } from '@xiangfa/generative-ai'
import storage from '@/utils/Storage'
import { findIndex, omitBy, pick, isFunction } from 'lodash-es'

type MessageStore = {
  title: string
  messages: Message[]
  references: InlineDataPart[]
  summary: Summary
  systemInstruction: string
  systemInstructionEditMode: boolean
  chatLayout: 'chat' | 'doc'
  add: (message: Message) => void
  update: (id: string, message: Message) => void
  remove: (id: string) => void
  clear: () => void
  revoke: (id: string) => void
  instruction: (prompt: string, title?: string) => void
  setSystemInstructionEditMode: (open: boolean) => void
  updateReference: (reference: InlineDataPart) => void
  clearReference: () => void
  summarize: (ids: string[], content: string) => void
  changeChatLayout: (type: 'chat' | 'doc') => void
  setTitle: (title: string) => void
  backup: () => Conversation
  restore: (conversation: Conversation) => void
}

export const useMessageStore = create(
  persist<MessageStore>(
    (set, get) => ({
      title: '',
      messages: [],
      references: [],
      summary: {
        ids: [],
        content: '',
      },
      systemInstruction: '',
      systemInstructionEditMode: false,
      chatLayout: 'doc',
      add: (message) => {
        set((state) => ({
          messages: [...state.messages, message],
        }))
      },
      update: (id, message) => {
        const messages = [...get().messages]
        const index = findIndex(messages, { id })
        if (index > -1) {
          messages[index] = message
          set(() => ({ messages }))
        }
      },
      remove: (id) => {
        const newMessages = get().messages.filter((item) => item.id !== id)
        set(() => ({ messages: newMessages }))
      },
      clear: () => {
        set(() => ({
          messages: [],
          summary: { ids: [], content: '' },
        }))
      },
      revoke: (id) => {
        const messages = [...get().messages]
        const index = findIndex(messages, { id })
        if (index > -1) {
          messages.splice(index, 1)
          set(() => ({ messages: messages.slice(0, index) }))
        }
      },
      instruction: (prompt, title) => {
        if (title) set(() => ({ title }))
        set(() => ({ title, systemInstruction: prompt }))
      },
      setSystemInstructionEditMode: (open) => {
        set(() => ({ systemInstructionEditMode: open }))
      },
      updateReference: (reference) => {
        const list = get().references
        set({ references: [...list, reference] })
      },
      clearReference: () => set({ references: [] }),
      summarize: (ids, content) => {
        set(() => ({ summary: { ids, content } }))
      },
      changeChatLayout: (type) => {
        set(() => ({ chatLayout: type }))
      },
      setTitle: (title) => {
        set(() => ({ title }))
      },
      backup: () => {
        const store = get()
        return { ...pick(store, ['title', 'messages', 'summary', 'systemInstruction', 'chatLayout']) }
      },
      restore: (conversation) => {
        set(() => ({ ...conversation }))
      },
    }),
    {
      name: 'chatStore',
      version: 1,
      storage: {
        getItem: async (key: string) => {
          return await storage.getItem<StorageValue<MessageStore>>(key)
        },
        setItem: async (key: string, store: StorageValue<MessageStore>) => {
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
