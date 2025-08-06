'use client'
import { useCallback, memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MessageSquarePlus,
  EllipsisVertical,
  Pin,
  PinOff,
  Copy,
  PencilLine,
  WandSparkles,
  Trash,
  Download,
} from 'lucide-react'
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import Button from '@/components/Button'
import SearchBar from '@/components/SearchBar'
import { useMessageStore } from '@/store/chat'
import { useConversationStore } from '@/store/conversation'
import { useSettingStore } from '@/store/setting'
import { GEMINI_API_BASE_URL } from '@/constant/urls'
import { encodeToken } from '@/utils/signature'
import summaryTitle, { type RequestProps } from '@/utils/summaryTitle'
import { downloadFile } from '@/utils/common'
import { cn } from '@/utils'
import { customAlphabet } from 'nanoid'
import { entries, isNull } from 'lodash-es'

type Props = {
  id: string
  title: string
  pinned?: boolean
  isActive?: boolean
}

interface ConversationItem extends Conversation {
  id: string
}

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 12)

function search(keyword: string, data: Record<string, Conversation>): Record<string, Conversation> {
  const results: Record<string, Conversation> = {}
  // 'i' means case-insensitive
  const regex = new RegExp(keyword.trim(), 'gi')
  for (const [id, item] of entries(data)) {
    if (regex.test(item.title) || regex.test(item.systemInstruction)) {
      results[id] = item
    }
    item.messages.forEach((message) => {
      message.parts.forEach((part) => {
        if (part.text && regex.test(part.text)) {
          results[id] = item
        }
      })
    })
  }
  return results
}

function ConversationItem(props: Props) {
  const { id, title, pinned = false, isActive = false } = props
  const { t } = useTranslation()
  const { pin, unpin, copy, remove } = useConversationStore()
  const { setTitle } = useMessageStore()
  const [customTitle, setCustomTitle] = useState<string>(title)
  const [editTitleMode, setEditTitleMode] = useState<boolean>(false)
  const conversationTitle = useMemo(() => (title ? title : t('chatAnything')), [title, t])

  const handleSummaryTitle = useCallback(async (id: string) => {
    const { lang, apiKey, apiProxy, password } = useSettingStore.getState()
    const { currentId, query, addOrUpdate } = useConversationStore.getState()
    const { messages, systemInstruction, setTitle } = useMessageStore.getState()

    const conversation = query(id)
    const config: RequestProps = {
      apiKey,
      lang,
      messages: id === currentId ? messages : conversation.messages,
      systemRole: id === currentId ? systemInstruction : conversation.systemInstruction,
    }

    if (config.messages.length === 0) return false

    if (apiKey !== '') {
      config.baseUrl = apiProxy || GEMINI_API_BASE_URL
    } else {
      config.apiKey = encodeToken(password)
      config.baseUrl = '/api/google'
    }
    const readableStream = await summaryTitle(config)
    let content = ''
    const reader = readableStream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      content += new TextDecoder().decode(value)
    }
    addOrUpdate(id, { ...conversation, title: content })
    if (id === currentId) setTitle(content)
  }, [])

  const handleSelect = useCallback(
    (id: string) => {
      const { currentId, query, addOrUpdate, setCurrentId } = useConversationStore.getState()
      const { title, backup, restore } = useMessageStore.getState()
      const oldConversation = backup()
      addOrUpdate(currentId, oldConversation)

      const newConversation = query(id)
      setCurrentId(id)
      restore(newConversation)

      if (!title && currentId !== 'default') handleSummaryTitle(currentId)
    },
    [handleSummaryTitle],
  )

  const editTitle = useCallback(
    (text: string) => {
      setTitle(text)
      setEditTitleMode(false)
    },
    [setTitle],
  )

  const handleCopy = useCallback(
    (id: string) => {
      const { query, addOrUpdate } = useConversationStore.getState()
      const { backup } = useMessageStore.getState()
      let conversation
      const newId = nanoid()
      if (id === 'default') {
        conversation = backup()
        addOrUpdate(newId, conversation)
      } else {
        conversation = query(id)
        copy(id, newId)
      }
      if (!conversation.title) {
        handleSummaryTitle(newId)
      }
    },
    [handleSummaryTitle, copy],
  )

  const handleDelete = useCallback(
    (id: string) => {
      const { currentId, setCurrentId, query } = useConversationStore.getState()
      const { restore } = useMessageStore.getState()
      if (id === currentId) {
        setCurrentId('default')
        const newConversation = query('default')
        restore(newConversation)
      }
      remove(id)
    },
    [remove],
  )

  const exportConversation = useCallback(
    (id: string) => {
      const { currentId, query } = useConversationStore.getState()
      const { backup } = useMessageStore.getState()
      const conversation = id === currentId ? backup() : query(id)
      let mdContentList: string[] = []

      const wrapJsonCode = (content: string) => {
        return `\`\`\`json\n${content}\n\`\`\``
      }

      if (conversation.systemInstruction) {
        mdContentList.push('> SystemInstruction')
        mdContentList.push(conversation.systemInstruction)
      }
      conversation.messages.forEach((item) => {
        if (item.role === 'user') {
          mdContentList.push('> User')
        } else if (item.role === 'model') {
          mdContentList.push('> AI')
        } else if (item.role === 'function') {
          mdContentList.push('> Plugin')
        }
        item.parts.forEach((part) => {
          if (part.fileData) {
            mdContentList.push(`[${part.fileData.mimeType}](${part.fileData.fileUri})`)
          } else if (part.inlineData) {
            mdContentList.push(
              `${part.inlineData.mimeType.startsWith('data:image/') ? '!' : ''}[${part.inlineData.mimeType}](data:${part.inlineData.mimeType};base64,${part.inlineData.data})`,
            )
          } else if (part.functionCall) {
            mdContentList.push(part.functionCall.name)
            mdContentList.push(wrapJsonCode(JSON.stringify(part.functionCall.args, null, 2)))
          } else if (part.functionResponse) {
            mdContentList.push(part.functionResponse.name)
            mdContentList.push(wrapJsonCode(JSON.stringify(part.functionResponse.response, null, 2)))
          } else if (part.text) {
            let content = part.text
            if (item.groundingMetadata) {
              const { groundingChunks = [] } = item.groundingMetadata
              content += `\n\n---\n\n${groundingChunks.map((item) => `- [${item.web?.title}](${item.web?.uri})`).join('\n')}`
            }
            mdContentList.push(content)
          }
        })
      })
      const mdContent = mdContentList.join('\n\n')
      downloadFile(mdContent, conversation.title ?? t('chatAnything'), 'text/markdown')
    },
    [t],
  )

  return (
    <div
      className={cn(
        'inline-flex h-10 w-full cursor-pointer justify-between rounded-md px-2 hover:bg-[hsl(var(--sidebar-accent))]',
        isActive ? 'bg-[hsl(var(--sidebar-accent))] font-medium' : '',
        editTitleMode ? 'bg-transparent hover:bg-transparent' : '',
      )}
      onClick={() => handleSelect(id)}
    >
      {editTitleMode ? (
        <div className="relative w-full">
          <Input className="my-1 h-8" value={conversationTitle} onChange={(ev) => setCustomTitle(ev.target.value)} />
          <Button
            className="absolute right-1 top-2 h-6 w-6"
            size="icon"
            variant="ghost"
            title={t('save')}
            onClick={() => editTitle(customTitle)}
          >
            <PencilLine />
          </Button>
        </div>
      ) : (
        <>
          <span className="truncate text-sm leading-10" title={conversationTitle}>
            {conversationTitle}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger>
              <EllipsisVertical className="h-6 w-6 rounded-sm p-1 hover:bg-background" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              onClick={(ev) => {
                ev.stopPropagation()
                ev.preventDefault()
              }}
            >
              {id !== 'default' ? (
                <DropdownMenuItem onClick={() => (pinned ? unpin(id) : pin(id))}>
                  {pinned ? (
                    <>
                      <PinOff />
                      <span>{t('unpin')}</span>
                    </>
                  ) : (
                    <>
                      <Pin />
                      <span>{t('pin')}</span>
                    </>
                  )}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => handleCopy(id)}>
                <Copy />
                <span>{t('newCopy')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportConversation(id)}>
                <Download />
                <span>{t('exportConversation')}</span>
              </DropdownMenuItem>
              {id !== 'default' ? (
                <DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleSummaryTitle(id)}>
                    <WandSparkles />
                    <span>{t('AIRename')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEditTitleMode(true)}>
                    <PencilLine />
                    <span>{t('rename')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-red-500" onClick={() => handleDelete(id)}>
                    <Trash />
                    <span>{t('delete')}</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  )
}

function AppSidebar() {
  const { t } = useTranslation()
  const conversationList = useConversationStore((state) => state.conversationList)
  const pinned = useConversationStore((state) => state.pinned)
  const currentId = useConversationStore((state) => state.currentId)
  const [conversations, setConversations] = useState<Record<string, Conversation> | null>(null)
  const [list, pinnedList] = useMemo(() => {
    const list: ConversationItem[] = []
    const pinnedList: ConversationItem[] = []
    const sources = isNull(conversations) ? conversationList : conversations
    for (const [id, conversation] of entries(sources)) {
      if (id !== 'default') {
        if (pinned.includes(id)) {
          pinnedList.push({ id, ...conversation })
        } else {
          list.push({ id, ...conversation })
        }
      }
    }
    return [list, pinnedList]
  }, [conversationList, conversations, pinned])

  const newConversation = useCallback(() => {
    const { currentId, addOrUpdate, setCurrentId } = useConversationStore.getState()
    const { backup, restore } = useMessageStore.getState()
    const oldConversation = backup()
    addOrUpdate(currentId, oldConversation)

    const id = nanoid()
    const newConversation: Conversation = {
      title: '',
      messages: [],
      summary: { ids: [], content: '' },
      systemInstruction: '',
      chatLayout: 'doc',
    }
    setCurrentId(id)
    addOrUpdate(id, newConversation)
    restore(newConversation)
  }, [])

  const handleSearch = useCallback(
    (keyword: string) => {
      const result = search(keyword, conversationList)
      setConversations(result)
    },
    [conversationList],
  )

  const handleClearKeyword = useCallback(() => {
    setConversations(null)
  }, [])

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex justify-between p-2 pb-0">
          <span className="text-lg font-semibold text-red-400">Gemini Next Chat</span>
          <Button
            className="h-8 w-8 [&_svg]:size-5"
            variant="ghost"
            size="icon"
            title={t('newConversation')}
            onClick={() => newConversation()}
          >
            <MessageSquarePlus />
          </Button>
        </div>
        <SearchBar onSearch={handleSearch} onClear={handleClearKeyword} />
      </SidebarHeader>
      <SidebarContent className="gap-0">
        <SidebarGroup className="py-0">
          <ConversationItem
            id="default"
            title={t('defaultConversation')}
            isActive={currentId === 'default'}
          ></ConversationItem>
        </SidebarGroup>
        {pinnedList.length > 0 ? (
          <SidebarGroup className="py-0">
            <SidebarGroupLabel>{t('pinned')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  {pinnedList.reverse().map((item) => {
                    return (
                      <ConversationItem
                        key={item.id}
                        id={item.id}
                        title={item.title}
                        isActive={currentId === item.id}
                        pinned
                      ></ConversationItem>
                    )
                  })}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
        {list.length > 0 ? (
          <SidebarGroup className="py-0">
            <SidebarGroupLabel>{t('conversationList')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  {list.reverse().map((item) => {
                    return (
                      <ConversationItem
                        key={item.id}
                        id={item.id}
                        title={item.title}
                        isActive={currentId === item.id}
                      ></ConversationItem>
                    )
                  })}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
    </Sidebar>
  )
}

export default memo(AppSidebar)
