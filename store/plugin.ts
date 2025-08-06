import { create } from 'zustand'
import { persist, type StorageValue } from 'zustand/middleware'
import storage from '@/utils/Storage'
import { type FunctionDeclaration } from '@xiangfa/generative-ai'
import { find, findIndex, filter, omitBy, isFunction } from 'lodash-es'

type PluginStore = {
  plugins: PluginManifest[]
  installed: Record<string, OpenAPIDocument>
  tools: FunctionDeclaration[]
  addPlugin: (plugin: PluginManifest) => void
  removePlugin: (id: string) => void
  updatePlugin: (id: string, plugin: PluginManifest) => void
  installPlugin: (id: string, schema: OpenAPIDocument) => void
  uninstallPlugin: (id: string) => void
  addTool: (tool: FunctionDeclaration) => void
  removeTool: (name: string) => void
}

export const usePluginStore = create(
  persist<PluginStore>(
    (set, get) => ({
      plugins: [],
      installed: {},
      tools: [],
      addPlugin: (plugin) => {
        set(() => ({ plugins: [...get().plugins, plugin] }))
      },
      removePlugin: (id) => {
        get().uninstallPlugin(id)
        const plugins = [...get().plugins]
        const newPlugins = filter(plugins, (plugin) => plugin.name_for_model !== id)
        set(() => ({ plugins: newPlugins }))
      },
      updatePlugin: (id, plugin) => {
        const plugins = [...get().plugins]
        const index = findIndex(plugins, { name_for_model: id })
        if (index !== -1) {
          plugins[index] = { ...plugins[index], ...plugin }
          set(() => ({ plugins }))
        }
      },
      installPlugin: (id, schema) => {
        const installed = { ...get().installed }
        installed[id] = schema
        set(() => ({ installed }))
      },
      uninstallPlugin: (id) => {
        const installed = { ...get().installed }
        delete installed[id]
        set(() => ({ installed }))
      },
      addTool: async (tool) => {
        const tools = [...get().tools]
        if (!find(tools, { name: tool.name })) {
          tools.push(tool)
          set(() => ({ tools }))
        }
      },
      removeTool: async (name: string) => {
        const tools = [...get().tools]
        const newTools = filter(tools, (tool) => tool.name !== name)
        set(() => ({ tools: newTools }))
      },
    }),
    {
      name: 'pluginStore',
      version: 1,
      storage: {
        getItem: async (key: string) => {
          return await storage.getItem<StorageValue<PluginStore>>(key)
        },
        setItem: async (key: string, store: StorageValue<PluginStore>) => {
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
