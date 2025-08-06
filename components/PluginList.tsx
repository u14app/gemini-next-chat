'use client'
import dynamic from 'next/dynamic'
import { useState, useMemo, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Blocks,
  ArrowRight,
  Store,
  Globe,
  BookOpenCheck,
  CloudSun,
  Clock4,
  Camera,
  Box,
  Microscope,
  Brush,
} from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useToast } from '@/components/ui/use-toast'
import { usePluginStore } from '@/store/plugin'
import { parsePlugin } from '@/utils/plugin'
import { officialPlugins, OFFICAL_PLUGINS } from '@/plugins'
import { keys, values, find } from 'lodash-es'

const PluginMarket = dynamic(() => import('@/components/PluginMarket'))

function PluginList() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { plugins, tools, installed, installPlugin, uninstallPlugin, addTool, removeTool } = usePluginStore()
  const [pluginMarketOpen, setPluginMarketOpen] = useState<boolean>(false)
  const thirdPartyPlugins = useMemo(() => {
    const installedPlugins: PluginManifest[] = []
    for (const id of keys(installed)) {
      if (values(OFFICAL_PLUGINS).indexOf(id) === -1) {
        const manifest = find(plugins, { name_for_model: id })
        if (manifest) installedPlugins.push(manifest)
      }
    }
    return installedPlugins
  }, [installed, plugins])
  const enabledTools = useMemo(() => {
    const ids: string[] = []
    tools.forEach((tool) => {
      const id = tool.name.split('__')[0]
      if (!ids.includes(id)) ids.push(id)
    })
    return ids
  }, [tools])

  const handleUsePlugin = useCallback(
    (id: string, enabled: boolean) => {
      const manifest = officialPlugins[id] || installed[id]
      if (manifest) {
        const pluginTools = parsePlugin(id, manifest)
        if (enabled) {
          pluginTools.every((tool) => addTool(tool))
          if (officialPlugins[id]) installPlugin(id, manifest)
        } else {
          pluginTools.every((tool) => removeTool(tool.name))
          if (officialPlugins[id]) uninstallPlugin(id)
        }
      } else {
        toast({
          title: 'Plugin loading failed',
          description: 'This plugin could not be loaded.',
        })
      }
    },
    [installed, addTool, removeTool, installPlugin, uninstallPlugin, toast],
  )

  return (
    <Popover>
      <PopoverTrigger className="inline-flex h-10 w-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-secondary text-sm font-medium text-secondary-foreground ring-offset-background transition-colors hover:bg-secondary/80 focus-visible:border-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 max-sm:h-8 max-sm:w-8 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0 max-sm:[&_svg]:size-4">
        <Blocks />
      </PopoverTrigger>
      <PopoverContent className="max-h-[330px] w-48 overflow-y-auto">
        <div>
          <h3 className="p-2 text-sm text-slate-400">{t('officialPlugins')}</h3>
          {/* <div className="flex rounded-sm px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-900">
            <Label
              className="inline-flex flex-1 cursor-pointer overflow-hidden leading-6 text-slate-500"
              htmlFor={OFFICAL_PLUGINS.IMAGEN}
              title="Imagen3"
            >
              <Brush className="my-1 mr-1 h-4 w-4" />
              <p className="truncate">Imagen3</p>
            </Label>
            <Checkbox
              id={OFFICAL_PLUGINS.IMAGEN}
              className="my-1"
              defaultChecked={enabledTools.includes(OFFICAL_PLUGINS.IMAGEN)}
              onCheckedChange={(checkedState) => handleUsePlugin(OFFICAL_PLUGINS.IMAGEN, checkedState === true)}
            />
          </div> */}
          <div className="flex rounded-sm px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-900">
            <Label
              className="inline-flex flex-1 cursor-pointer overflow-hidden leading-6 text-slate-500"
              htmlFor={OFFICAL_PLUGINS.SEARCH}
              title={t('webSearch')}
            >
              <Globe className="my-1 mr-1 h-4 w-4" />
              <p className="truncate">{t('webSearch')}</p>
            </Label>
            <Checkbox
              id={OFFICAL_PLUGINS.SEARCH}
              className="my-1"
              defaultChecked={enabledTools.includes(OFFICAL_PLUGINS.SEARCH)}
              onCheckedChange={(checkedState) => handleUsePlugin(OFFICAL_PLUGINS.SEARCH, checkedState === true)}
            />
          </div>
          <div className="flex rounded-sm px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-900">
            <Label
              className="inline-flex flex-1 cursor-pointer overflow-hidden leading-6 text-slate-500"
              htmlFor={OFFICAL_PLUGINS.READER}
              title={t('webReader')}
            >
              <BookOpenCheck className="my-1 mr-1 h-4 w-4" />
              <p className="truncate">{t('webReader')}</p>
            </Label>
            <Checkbox
              id={OFFICAL_PLUGINS.READER}
              className="my-1"
              defaultChecked={enabledTools.includes(OFFICAL_PLUGINS.READER)}
              onCheckedChange={(checkedState) => handleUsePlugin(OFFICAL_PLUGINS.READER, !!checkedState)}
            />
          </div>
          <div className="flex rounded-sm px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-900">
            <Label
              className="inline-flex flex-1 cursor-pointer overflow-hidden leading-6 text-slate-500"
              htmlFor={OFFICAL_PLUGINS.ARXIV}
              title="Arxiv"
            >
              <Microscope className="my-1 mr-1 h-4 w-4" />
              <p className="truncate">{t('arxivSearch')}</p>
            </Label>
            <Checkbox
              id={OFFICAL_PLUGINS.ARXIV}
              className="my-1"
              defaultChecked={enabledTools.includes(OFFICAL_PLUGINS.ARXIV)}
              onCheckedChange={(checkedState) => handleUsePlugin(OFFICAL_PLUGINS.ARXIV, !!checkedState)}
            />
          </div>
          <div className="flex rounded-sm px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-900">
            <Label
              className="inline-flex flex-1 cursor-pointer overflow-hidden leading-6 text-slate-500"
              htmlFor={OFFICAL_PLUGINS.WEATHER}
              title={t('realTimeWeather')}
            >
              <CloudSun className="my-1 mr-1 h-4 w-4" />
              <p className="truncate">{t('realTimeWeather')}</p>
            </Label>
            <Checkbox
              id={OFFICAL_PLUGINS.WEATHER}
              className="my-1"
              defaultChecked={enabledTools.includes(OFFICAL_PLUGINS.WEATHER)}
              onCheckedChange={(checkedState) => handleUsePlugin(OFFICAL_PLUGINS.WEATHER, !!checkedState)}
            />
          </div>
          <div className="flex rounded-sm px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-900">
            <Label
              className="inline-flex flex-1 cursor-pointer overflow-hidden leading-6 text-slate-500"
              htmlFor={OFFICAL_PLUGINS.TIME}
              title={t('currentTime')}
            >
              <Clock4 className="my-1 mr-1 h-4 w-4" />
              <p className="truncate">{t('currentTime')}</p>
            </Label>
            <Checkbox
              id={OFFICAL_PLUGINS.TIME}
              className="my-1"
              defaultChecked={enabledTools.includes(OFFICAL_PLUGINS.TIME)}
              onCheckedChange={(checkedState) => handleUsePlugin(OFFICAL_PLUGINS.TIME, !!checkedState)}
            />
          </div>
          <div className="flex rounded-sm px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-900">
            <Label
              className="inline-flex flex-1 cursor-pointer overflow-hidden leading-6 text-slate-500"
              htmlFor={OFFICAL_PLUGINS.UNSPLASH}
              title="Unsplash"
            >
              <Camera className="my-1 mr-1 h-4 w-4" />
              <p className="truncate">Unsplash</p>
            </Label>
            <Checkbox
              id={OFFICAL_PLUGINS.UNSPLASH}
              className="my-1"
              defaultChecked={enabledTools.includes(OFFICAL_PLUGINS.UNSPLASH)}
              onCheckedChange={(checkedState) => handleUsePlugin(OFFICAL_PLUGINS.UNSPLASH, !!checkedState)}
            />
          </div>
        </div>
        <div>
          <h3 className="p-2 text-sm text-slate-400">{t('externalPlugins')}</h3>
          {thirdPartyPlugins.map((plugin) => {
            return (
              <div
                key={plugin.name_for_model}
                className="flex rounded-sm px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-900"
              >
                <Label
                  className="inline-flex flex-1 cursor-pointer overflow-hidden leading-6 text-slate-500"
                  htmlFor={plugin.name_for_model}
                  title={plugin.description_for_human}
                >
                  <Avatar className="my-1 mr-1 h-4 w-4">
                    <AvatarImage src={plugin.logo_url} alt={plugin.name_for_human} />
                    <AvatarFallback>
                      <Box />
                    </AvatarFallback>
                  </Avatar>
                  <p className="truncate">{plugin.name_for_human}</p>
                </Label>
                <Checkbox
                  id={plugin.name_for_model}
                  className="my-1"
                  defaultChecked={enabledTools.includes(plugin.name_for_model)}
                  onCheckedChange={(checkedState) => handleUsePlugin(plugin.name_for_model, !!checkedState)}
                />
              </div>
            )
          })}
          <div
            className="flex rounded-sm px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-900"
            onClick={() => setPluginMarketOpen(true)}
          >
            <Label className="inline-flex flex-1 cursor-pointer leading-6 text-slate-500" htmlFor="stock">
              <Store className="my-1 mr-1 h-4 w-4" />
              {t('pluginMarket')}
            </Label>
            <ArrowRight className="my-1 h-4 w-4 cursor-pointer" />
          </div>
        </div>
        <PluginMarket open={pluginMarketOpen} onClose={() => setPluginMarketOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

export default memo(PluginList)
