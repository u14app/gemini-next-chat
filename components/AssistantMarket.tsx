'use client'
import { useState, useCallback, useLayoutEffect, useEffect, memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { EllipsisVertical, Heart } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardHeader, CardContent, CardFooter, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import ResponsiveDialog from '@/components/ResponsiveDialog'
import SearchBar from '@/components/SearchBar'
import AssistantForm from '@/components/AssistantForm'
import Button from '@/components/Button'
import { useMessageStore } from '@/store/chat'
import { useAssistantStore } from '@/store/assistant'
import { useSettingStore } from '@/store/setting'
import { ASSISTANT_INDEX_URL } from '@/constant/urls'
import AssistantMarketUrl from '@/utils/AssistantMarketUrl'

type AssistantProps = {
  open: boolean
  onClose: () => void
  onLoaded: () => void
}

type AssistantMarketIndex = {
  agents: AssistantDetail[]
  tags: string[]
  schemaVersion: number
}

function search(keyword: string, data: AssistantDetail[]): AssistantDetail[] {
  const results: AssistantDetail[] = []
  // 'i' means case-insensitive
  const regex = new RegExp(keyword.trim(), 'gi')
  data.forEach((item) => {
    if (item.meta.tags.includes(keyword) || regex.test(item.meta.title) || regex.test(item.meta.description)) {
      results.push(item)
    }
  })
  return results
}

function filterDataByTag(data: AssistantDetail[], tag: string): AssistantDetail[] {
  return tag !== 'all' ? data.filter((item) => item.meta.tags.includes(tag)) : data
}

function AssistantMarket(props: AssistantProps) {
  const { open, onClose, onLoaded } = props
  const { t } = useTranslation()
  const { update: updateAssistants, removeAssistant, addFavorite, removeFavorite, updateTags } = useAssistantStore()
  const assistants = useAssistantStore((state) => state.assistants)
  const favorites = useAssistantStore((state) => state.favorites)
  const lang = useSettingStore((state) => state.lang)
  const assistantIndexUrl = useSettingStore((state) => state.assistantIndexUrl || ASSISTANT_INDEX_URL)
  const [assistantList, setAssistantList] = useState<AssistantDetail[]>([])
  const [tagList, setTagList] = useState<string[]>([])
  const [currentTag, setCurrentTag] = useState<string>('all')
  const [freezeSelection, setFreezeSelection] = useState<boolean>(false)
  const [currentTab, setCurrentTab] = useState<string>('list')
  const [data, setData] = useState<AssistantDetail>()
  const favoriteList = useMemo(() => {
    return assistantList.filter((item) => favorites.includes(item.identifier))
  }, [assistantList, favorites])

  const handleClear = useCallback(() => {
    setAssistantList(filterDataByTag(assistants, currentTag))
  }, [assistants, currentTag])

  const handleClose = useCallback(() => {
    onClose()
    setCurrentTag('')
    handleClear()
    setAssistantList(assistants)
  }, [assistants, onClose, handleClear])

  const handleSelect = useCallback(
    async (assistant: AssistantDetail) => {
      if (freezeSelection) return false
      handleClose()
      const { instruction, clear: clearMessage } = useMessageStore.getState()
      clearMessage()
      if (assistant.config?.systemRole) {
        instruction(assistant.config.systemRole, assistant.meta.title)
      } else {
        const assistantMarketUrl = new AssistantMarketUrl(assistantIndexUrl)
        const response = await fetch(assistantMarketUrl.getAssistantUrl(assistant.identifier, lang))
        const assistantDeatil: AssistantDetail = await response.json()
        instruction(assistantDeatil.config.systemRole, assistantDeatil.meta.title)
      }
    },
    [lang, assistantIndexUrl, freezeSelection, handleClose],
  )

  const handleSearch = useCallback(
    (keyword: string) => {
      const result = search(keyword, filterDataByTag(assistants, currentTag))
      setAssistantList(result)
    },
    [currentTag, assistants],
  )

  const handleSelectTag = useCallback(
    (value: string) => {
      setCurrentTag(value)
      setAssistantList(filterDataByTag(assistants, value))
    },
    [assistants],
  )

  const handleTagListOpenChange = useCallback((open: boolean) => {
    if (open) {
      setFreezeSelection(open)
    } else {
      // Fixed the click-through issue on mobile devices
      setTimeout(() => {
        setFreezeSelection(open)
      }, 350)
    }
  }, [])

  const fetchAssistantMarketIndex = useCallback(async () => {
    const assistantMarketUrl = new AssistantMarketUrl(assistantIndexUrl)
    const response = await fetch(assistantMarketUrl.getIndexUrl(lang))
    const assistantMarketIndex: AssistantMarketIndex = await response.json()
    updateAssistants(assistantMarketIndex.agents)
    setAssistantList(assistantMarketIndex.agents)
    setTagList(assistantMarketIndex.tags)
    updateTags(assistantMarketIndex.tags)
    onLoaded()
  }, [lang, assistantIndexUrl, updateAssistants, updateTags, onLoaded])

  useEffect(() => setAssistantList(assistants), [assistants])

  useLayoutEffect(() => {
    if (assistantIndexUrl !== '' && lang !== '') {
      const { assistants, tags, cachedTime, cachedLang, setCachedTime, setCachedLang } = useAssistantStore.getState()
      const timestamp = Date.now()
      if (cachedTime + 2880000 < timestamp || cachedLang !== lang) {
        fetchAssistantMarketIndex().then(() => {
          setCachedTime(timestamp)
          setCachedLang(lang)
        })
      } else {
        updateAssistants(assistants)
        setAssistantList(assistants)
        setTagList(tags)
        updateTags(tags)
        onLoaded()
      }
    }
  }, [assistantIndexUrl, lang, fetchAssistantMarketIndex, updateAssistants, updateTags, onLoaded])

  const renderAssistantList = (assistantList: AssistantDetail[]) => {
    return assistantList.map((assistant) => {
      return (
        <Card
          key={assistant.identifier}
          className="cursor-pointer transition-colors hover:drop-shadow-md dark:hover:border-white/80"
          onClick={() => handleSelect(assistant)}
        >
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex justify-between text-base">
              <div className="flex w-full">
                <Avatar className="mr-1 h-6 w-6">
                  {assistant.meta.avatar.startsWith('http') ? (
                    <AvatarImage className="m-1 h-4 w-4 rounded-full" src={assistant.meta.avatar} />
                  ) : null}
                  <AvatarFallback className="bg-transparent">{assistant.meta.avatar}</AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate font-medium" title={assistant.meta.title}>
                  {assistant.meta.title}
                </span>
                <div className="inline-flex gap-1">
                  <Button
                    className="h-6 w-6"
                    size="icon"
                    variant="ghost"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      ev.preventDefault()
                      if (favorites.includes(assistant.identifier)) {
                        removeFavorite(assistant.identifier)
                      } else {
                        addFavorite(assistant.identifier)
                      }
                    }}
                  >
                    <Heart className={favorites.includes(assistant.identifier) ? 'text-red-400' : ''} />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <EllipsisVertical
                        className="h-5 w-5"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          ev.preventDefault()
                        }}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        onSelect={(ev) => {
                          ev.stopPropagation()
                          ev.preventDefault()
                          setData(assistant)
                          setCurrentTab('custom')
                        }}
                      >
                        {t('edit')}
                      </DropdownMenuItem>
                      {assistant.author === '' ? (
                        <DropdownMenuItem
                          className="text-red-500"
                          onSelect={(ev) => {
                            ev.stopPropagation()
                            ev.preventDefault()
                            removeFavorite(assistant.identifier)
                            removeAssistant(assistant.identifier)
                          }}
                        >
                          {t('delete')}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-line-clamp-2 mb-2 h-10 px-4 text-sm">{assistant.meta.description}</CardContent>
          <CardFooter className="flex justify-between p-3 px-4 pt-0 text-sm">
            <span>{assistant.createdAt}</span>
            {assistant.author ? (
              <a
                className="inline-block underline-offset-4 hover:underline"
                href={assistant.homepage}
                target="_blank"
                onClick={(ev) => ev.stopPropagation()}
              >
                @{assistant.author}
              </a>
            ) : null}
          </CardFooter>
        </Card>
      )
    })
  }

  return (
    <ResponsiveDialog
      className="max-h-[95vh] max-w-screen-lg max-lg:max-w-screen-md"
      open={open}
      onClose={handleClose}
      title={
        <>
          {t('assistantMarket')}
          <small>{t('totalAssistant', { total: assistantList.length })}</small>
        </>
      }
      description={t('assistantMarketDescription')}
    >
      <Tabs value={currentTab} onValueChange={(value) => setCurrentTab(value)}>
        <TabsList className="mx-auto grid w-full grid-cols-3">
          <TabsTrigger value="list">{t('assistantList')}</TabsTrigger>
          <TabsTrigger value="favorite">{t('favoriteList')}</TabsTrigger>
          <TabsTrigger value="custom">{t('customAssistant')}</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <div className="flex gap-2 pb-2 pt-1">
            <Select value="all" onValueChange={handleSelectTag} onOpenChange={handleTagListOpenChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t('selectCategory')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('all')}</SelectItem>
                {tagList.map((tag) => {
                  return (
                    <SelectItem key={tag} value={tag}>
                      {tag}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <SearchBar onSearch={handleSearch} onClear={() => handleClear()} />
          </div>
          <ScrollArea className="h-[400px] w-full scroll-smooth">
            <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">{renderAssistantList(assistantList)}</div>
            <ScrollBar orientation="vertical" />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="favorite">
          <ScrollArea className="h-[452px] w-full scroll-smooth">
            <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">{renderAssistantList(favoriteList)}</div>
            <ScrollBar orientation="vertical" />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="custom">
          <ScrollArea className="h-[452px] w-full scroll-smooth">
            <AssistantForm
              data={data}
              onChange={(status) => {
                setData(undefined)
                if (status !== 'clear') {
                  setCurrentTab('list')
                }
              }}
            />
            <ScrollBar orientation="vertical" />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </ResponsiveDialog>
  )
}

export default memo(AssistantMarket)
