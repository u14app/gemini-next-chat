'use client'
import dynamic from 'next/dynamic'
import { useRef, useState, useMemo, KeyboardEvent, useEffect, useCallback, useLayoutEffect } from 'react'
import type { FunctionCall, InlineDataPart } from '@xiangfa/generative-ai'
import { AudioRecorder, EdgeSpeech, getRecordMineType } from '@xiangfa/polly'
import {
  MessageCircleHeart,
  AudioLines,
  Mic,
  Settings,
  Square,
  SendHorizontal,
  Github,
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ThemeToggle from '@/components/ThemeToggle'
import { useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'
import Button from '@/components/Button'
import { useMessageStore } from '@/store/chat'
import { useAttachmentStore } from '@/store/attachment'
import { useSettingStore, useEnvStore } from '@/store/setting'
import { usePluginStore } from '@/store/plugin'
import { pluginHandle } from '@/plugins'
import i18n from '@/utils/i18n'
import chat, { type RequestProps } from '@/utils/chat'
import { summarizePrompt, getVoiceModelPrompt, getSummaryPrompt, getTalkAudioPrompt } from '@/utils/prompt'
import AudioStream from '@/utils/AudioStream'
import PromiseQueue from '@/utils/PromiseQueue'
import { textStream, simpleTextStream } from '@/utils/textStream'
import { encodeToken } from '@/utils/signature'
import type { FileManagerOptions } from '@/utils/FileManager'
import { fileUpload, imageUpload } from '@/utils/upload'
import { findOperationById } from '@/utils/plugin'
import { generateImages, type ImageGenerationRequest } from '@/utils/generateImages'
import { detectLanguage, formatTime, readFileAsDataURL, base64ToBlob, isOfficeFile } from '@/utils/common'
import { cn } from '@/utils'
import { GEMINI_API_BASE_URL } from '@/constant/urls'
import { OldVisionModel, OldTextModel } from '@/constant/model'
import mimeType from '@/constant/attachment'
import { customAlphabet } from 'nanoid'
import { isFunction, findIndex, isUndefined, entries, flatten, isEmpty } from 'lodash-es'
import type { OpenAPIV3_1 } from 'openapi-types'

interface AnswerParams {
  messages: Message[]
  model: string
  onResponse: (
    readableStream: ReadableStream,
    thoughtReadableStream: ReadableStream,
    inlineDataReadableStream: ReadableStream,
    groundingSearchReadable: ReadableStream,
  ) => void
  onFunctionCall?: (functionCalls: FunctionCall[]) => void
  onError?: (error: string, code?: number) => void
}

const TEXTAREA_DEFAULT_HEIGHT = 30
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 12)

const MessageItem = dynamic(() => import('@/components/MessageItem'))
const ErrorMessageItem = dynamic(() => import('@/components/ErrorMessageItem'))
const AssistantRecommend = dynamic(() => import('@/components/AssistantRecommend'))
const SystemInstruction = dynamic(() => import('@/components/SystemInstruction'))
const Setting = dynamic(() => import('@/components/Setting'))
const FileUploader = dynamic(() => import('@/components/FileUploader'))
const AttachmentArea = dynamic(() => import('@/components/AttachmentArea'))
const PluginList = dynamic(() => import('@/components/PluginList'))
const ModelSelect = dynamic(() => import('@/components/ModelSelect'))
const TalkWithVoice = dynamic(() => import('@/components/TalkWithVoice'))
const MultimodalLive = dynamic(() => import('@/components/MultimodalLive'))

export default function Home() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { state: sidebarState, toggleSidebar } = useSidebar()
  const scrollAreaBottomRef = useRef<HTMLDivElement>(null)
  const audioStreamRef = useRef<AudioStream>()
  const edgeSpeechRef = useRef<EdgeSpeech>()
  const audioRecordRef = useRef<AudioRecorder>()
  const speechQueue = useRef<PromiseQueue>()
  const stopGeneratingRef = useRef<boolean>(false)
  const messagesRef = useRef(useMessageStore.getState().messages)
  const messages = useMessageStore((state) => state.messages)
  const title = useMessageStore((state) => state.title)
  const systemInstruction = useMessageStore((state) => state.systemInstruction)
  const systemInstructionEditMode = useMessageStore((state) => state.systemInstructionEditMode)
  const chatLayout = useMessageStore((state) => state.chatLayout)
  const files = useAttachmentStore((state) => state.files)
  const references = useMessageStore((state) => state.references)
  const model = useSettingStore((state) => state.model)
  const [textareaHeight, setTextareaHeight] = useState<number>(TEXTAREA_DEFAULT_HEIGHT)
  const [content, setContent] = useState<string>('')
  const [message, setMessage] = useState<string>('')
  const [thinkingMessage, setThinkingMessage] = useState<string>('')
  const [subtitle, setSubtitle] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [recordTime, setRecordTime] = useState<number>(0)
  const [settingOpen, setSetingOpen] = useState<boolean>(false)
  const [speechSilence, setSpeechSilence] = useState<boolean>(false)
  const [isRecording, setIsRecording] = useState<boolean>(false)
  const [isThinking, setIsThinking] = useState<boolean>(false)
  const [executingPlugins, setExecutingPlugins] = useState<string[]>([])
  const [enablePlugin, setEnablePlugin] = useState<boolean>(true)
  const [talkMode, setTalkMode] = useState<'chat' | 'voice'>('chat')
  const conversationTitle = useMemo(() => (title ? title : t('chatAnything')), [title, t])
  const [status, setStatus] = useState<'thinkng' | 'silence' | 'talking'>('silence')
  const canUseMultimodalLive = useMemo(() => {
    return model.startsWith('gemini-2.0-flash-exp') && !model.includes('image')
  }, [model])
  const isOldVisionModel = useMemo(() => {
    return OldVisionModel.includes(model)
  }, [model])
  const isThinkingModel = useMemo(() => {
    return model.includes('thinking')
  }, [model])
  const isLiteModel = useMemo(() => {
    return model.includes('lite')
  }, [model])
  const isImageGenerationModel = useMemo(() => {
    return model.includes('image-generation')
  }, [model])
  const supportAttachment = useMemo(() => {
    return !OldTextModel.includes(model)
  }, [model])
  const supportSpeechRecognition = useMemo(() => {
    return !OldTextModel.includes(model) && !OldVisionModel.includes(model)
  }, [model])
  const isUploading = useMemo(() => {
    for (const file of files) {
      if (file.status === 'PROCESSING') return true
    }
    return false
  }, [files])

  const speech = useCallback(
    (content: string) => {
      if (content.length === 0) return
      speechQueue.current?.enqueue(
        () =>
          new Promise(async (resolve, reject) => {
            if (speechSilence) reject(false)
            const { ttsVoice } = useSettingStore.getState()
            const voice = await edgeSpeechRef.current?.create({
              input: content,
              options: { voice: ttsVoice },
            })
            if (voice) {
              const audio = await voice.arrayBuffer()
              audioStreamRef.current?.play({
                audioData: audio,
                text: content,
                onStart: (text) => {
                  setStatus('talking')
                  setSubtitle(text)
                },
                onFinished: () => {
                  setStatus('silence')
                  const { autoStartRecord } = useSettingStore.getState()
                  if (autoStartRecord) audioRecordRef.current?.start()
                },
              })
              resolve(true)
            }
          }),
      )
    },
    [speechSilence],
  )

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => scrollAreaBottomRef.current?.scrollIntoView({ behavior: 'smooth' }))
  }, [])

  const handleError = useCallback(async (message: string, code?: number) => {
    const messages = [...messagesRef.current]
    const lastMessage = messages.pop()
    if (lastMessage?.role === 'model') {
      const { revoke } = useMessageStore.getState()
      revoke(lastMessage.id)
    }
    setStatus('silence')
    setErrorMessage(`${code ?? '400'}: ${message}`)
  }, [])

  const fetchAnswer = useCallback(
    async ({ messages, model, onResponse, onFunctionCall, onError }: AnswerParams) => {
      const { apiKey, apiProxy, password, topP, topK, temperature, maxOutputTokens, safety } =
        useSettingStore.getState()
      const { tools } = usePluginStore.getState()
      const generationConfig: RequestProps['generationConfig'] = { topP, topK, temperature, maxOutputTokens }
      setErrorMessage('')
      setIsThinking(true)
      const config: RequestProps = {
        messages,
        apiKey,
        model,
        generationConfig,
        safety,
      }
      if (systemInstruction) config.systemInstruction = systemInstruction
      if (talkMode === 'voice') {
        config.systemInstruction = `${getVoiceModelPrompt()}\n\n${systemInstruction}`
      }
      if (tools.length > 0 && !isThinkingModel && !isLiteModel) config.tools = [{ functionDeclarations: tools }]
      if (apiKey !== '') {
        config.baseUrl = apiProxy || GEMINI_API_BASE_URL
      } else {
        config.apiKey = encodeToken(password)
        config.baseUrl = '/api/google'
      }
      try {
        const stream = await chat(config)
        let thinking = false
        if (isThinkingModel) thinking = true

        const encoder = new TextEncoder()
        const { readable, writable } = new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(chunk))
          },
        })
        const { readable: thoughtReadable, writable: thoughtWritable } = new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(chunk))
          },
        })
        const { readable: inlineDataReadable, writable: inlineDataWritable } = new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(chunk))
          },
        })
        const { readable: groundingSearchReadable, writable: groundingSearchWritable } = new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(chunk))
          },
        })
        const writer = writable.getWriter()
        const thoughtWriter = thoughtWritable.getWriter()
        const inlineDataWriter = inlineDataWritable.getWriter()
        const groundingSearchWriter = groundingSearchWritable.getWriter()
        onResponse(readable, thoughtReadable, inlineDataReadable, groundingSearchReadable)

        const handleImage = async (part: InlineDataPart) => {
          // Compress image
          const { default: imageCompression } = await import('browser-image-compression')
          const compressionOptions = {
            maxSizeMB: 4,
            useWebWorker: true,
            initialQuality: 0.85,
            maxWidthOrHeight: 1024,
            fileType: 'image/jpeg',
            libURL: 'scripts/browser-image-compression.js',
          }
          const tmpImageFile = await imageCompression.getFilefromDataUrl(
            `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
            'image.png',
          )
          const compressedImage = await imageCompression(tmpImageFile, compressionOptions)
          const imageDataURL = await imageCompression.getDataUrlFromFile(compressedImage)
          const inlineData = JSON.stringify({
            mimeType: 'image/jpeg',
            data: imageDataURL.split(';base64,')[1],
          })
          const { references } = useMessageStore.getState()
          writer.write(`\n![image.jpg][image-${references.length}]\n`)
          inlineDataWriter.write(inlineData)
        }

        const functionCalls: FunctionCall[][] = []

        for await (const chunk of stream) {
          if (stopGeneratingRef.current) {
            writer.close()
            thoughtWriter.close()
            inlineDataWriter.close()
            groundingSearchWriter.close()
            stopGeneratingRef.current = true
          }

          if (chunk.candidates) {
            const candidates: any[] = chunk.candidates
            for (const item of candidates) {
              if (item.finishReason === 'IMAGE_SAFETY') {
                return handleError('Unable to generate this type of image', 500)
              }

              if (item.content.parts) {
                if (thinking) {
                  const textParts = item.content.parts.filter((item: any) => !isUndefined(item.text))
                  if (textParts.length === 2) {
                    if (textParts[0].text) {
                      thoughtWriter.write(textParts[0].text)
                    }
                    if (textParts[1].text) {
                      thinking = false
                      writer.write(textParts[1].text)
                    }
                  } else {
                    for (const textPart of textParts) {
                      if (textPart.thought) {
                        thoughtWriter.write(textPart.text)
                      } else {
                        thinking = false
                        writer.write(textPart.text)
                      }
                    }
                  }
                } else {
                  for (const part of item.content.parts) {
                    if (part.text) {
                      writer.write(part.text)
                    }
                    if (part.inlineData?.mimeType.startsWith('image/')) {
                      await handleImage(part)
                    }
                  }
                }
              } else if (item.finishMessage) {
                if (isFunction(onError)) onError(item.finishMessage)
              }
              if (item.groundingMetadata) {
                groundingSearchWriter.write(JSON.stringify(item.groundingMetadata))
              }
            }
          }

          const calls = chunk.functionCalls()
          if (calls) functionCalls.push(calls)
        }

        writer.close()
        thoughtWriter.close()
        inlineDataWriter.close()
        groundingSearchWriter.close()

        if (isFunction(onFunctionCall)) {
          onFunctionCall(flatten(functionCalls))
        }
      } catch (error) {
        if (error instanceof Error && isFunction(onError)) {
          onError(error.message)
          setIsThinking(false)
        }
      }
    },
    [systemInstruction, isThinkingModel, isLiteModel, talkMode, handleError],
  )

  const summarize = useCallback(
    async (messages: Message[]) => {
      const { summary, summarize: summarizeChat } = useMessageStore.getState()
      const { ids, prompt } = summarizePrompt(messages, summary.ids, summary.content)
      let content = ''
      await fetchAnswer({
        messages: [{ id: 'summary', role: 'user', parts: [{ text: prompt }] }],
        model,
        onResponse: async (text) => {
          content += text
          summarizeChat(ids, content.trim())
        },
      })
    },
    [fetchAnswer, model],
  )

  const handleResponse = useCallback(
    (
      readableStream: ReadableStream,
      thoughtReadableStream: ReadableStream,
      inlineDataReadableStream: ReadableStream,
      groundingSearchReadableStream: ReadableStream,
    ) => {
      const { lang, maxHistoryLength } = useSettingStore.getState()
      const { summary, add: addMessage, clearReference } = useMessageStore.getState()
      speechQueue.current = new PromiseQueue()
      setSpeechSilence(false)
      let text = ''
      let thoughtText = ''
      let imageList: InlineDataPart[] = []
      let groundingSearch: Message['groundingMetadata']
      textStream({
        readable: readableStream,
        locale: lang,
        onMessage: (content) => {
          text += content
          setMessage(text)
        },
        onStatement: (statement) => {
          if (talkMode === 'voice') {
            speech(statement)
          }
        },
        onFinish: async () => {
          if (talkMode === 'voice') {
            setStatus('silence')
          }
          const message: Message = {
            id: nanoid(),
            role: 'model',
            parts: [],
          }
          message.parts = []
          if (text !== '') {
            message.parts = thoughtText !== '' ? [{ text: thoughtText }, { text }] : [{ text }]
          } else if (thoughtText !== '') {
            message.parts = [{ text: thoughtText }]
          }
          if (imageList.length > 0) {
            message.parts = [...message.parts, ...imageList]
          }
          if (groundingSearch) message.groundingMetadata = groundingSearch
          if (message.parts.length > 0) addMessage(message)
          setMessage('')
          setThinkingMessage('')
          clearReference()
          setIsThinking(false)
          stopGeneratingRef.current = false
          setExecutingPlugins([])
          if (maxHistoryLength > 0) {
            const textMessages: Message[] = []
            for (const item of messagesRef.current) {
              for (const part of item.parts) {
                if (part.text) textMessages.push(item)
              }
            }
            const messageList = textMessages.filter((item) => !summary.ids.includes(item.id))
            if (messageList.length > maxHistoryLength) {
              await summarize(textMessages)
            }
          }
        },
      })
      simpleTextStream({
        readable: thoughtReadableStream,
        onMessage: (content) => {
          thoughtText += content
          setThinkingMessage(thoughtText)
        },
      })
      simpleTextStream({
        readable: inlineDataReadableStream,
        onMessage: (content) => {
          const { updateReference } = useMessageStore.getState()
          const inlineData: InlineDataPart['inlineData'] = JSON.parse(content)
          if (inlineData.mimeType.startsWith('image/')) {
            imageList.push({ inlineData })
          }
          updateReference({ inlineData })
        },
      })
      simpleTextStream({
        readable: groundingSearchReadableStream,
        onMessage: (content) => {
          groundingSearch = JSON.parse(content)
        },
      })
    },
    [speech, summarize, setThinkingMessage, talkMode],
  )

  const handleFunctionCall = useCallback(
    async (functionCalls: FunctionCall[]) => {
      const { apiKey, apiProxy, password, model } = useSettingStore.getState()
      const { add: addMessage } = useMessageStore.getState()
      const { installed } = usePluginStore.getState()
      const pluginExecuteResults: Record<string, unknown> = {}
      for await (const call of functionCalls) {
        const pluginId = call.name.split('__')[0]
        const pluginManifest = installed[pluginId]
        setExecutingPlugins((state) => [...state, call.name])
        let baseUrl = ''
        if (pluginManifest.servers) {
          baseUrl = pluginManifest.servers[0].url
        } else {
          return handleError('OpenAPI service url is missing!', 400)
        }
        const operation = findOperationById(pluginManifest, call.name.substring(2 + pluginId.length))
        if (!operation) return handleError('FunctionCall execution failed!')
        const functionCallMessage = {
          id: nanoid(),
          role: 'model',
          parts: [
            {
              functionCall: call,
            },
          ],
        }
        addMessage(functionCallMessage)
        const payload: GatewayPayload = {
          baseUrl: `${baseUrl}${operation.path}`,
          method: operation.method as GatewayPayload['method'],
        }
        let body: GatewayPayload['body'] = {}
        let formData: GatewayPayload['formData'] = {}
        let headers: GatewayPayload['headers'] = {}
        let path: GatewayPayload['path'] = {}
        let query: GatewayPayload['query'] = {}
        let cookie: GatewayPayload['cookie'] = {}
        for (const [name, value] of entries(call.args)) {
          const parameters = operation.parameters as OpenAPIV3_1.ParameterObject[]
          const requestBody = operation.requestBody
          if (parameters) {
            parameters.forEach((parameter) => {
              if (parameter.name === name) {
                if (parameter.in === 'query') {
                  query[name] = value
                } else if (parameter.in === 'path') {
                  path[name] = value
                } else if (parameter.in === 'formData') {
                  formData[name] = value
                } else if (parameter.in === 'headers') {
                  headers[name] = value
                } else if (parameter.in === 'cookie') {
                  cookie[name] = value
                }
              }
            })
          } else if (requestBody) {
            body[name] = value
          }
        }
        if (!isEmpty(body)) payload.body = body
        if (!isEmpty(formData)) payload.formData = formData
        if (!isEmpty(headers)) payload.headers = headers
        if (!isEmpty(path)) payload.path = path
        if (!isEmpty(query)) payload.query = query
        // if (!isEmpty(cookie)) payload.cookie = cookie
        try {
          if (baseUrl.startsWith('@plugins/')) {
            if (pluginId === 'OfficialImagen') {
              if (payload.query) {
                const options =
                  apiKey !== ''
                    ? { apiKey, baseUrl: apiProxy || GEMINI_API_BASE_URL }
                    : { token: encodeToken(password), baseUrl: '/api/google' }
                const result = await generateImages({
                  ...options,
                  model: 'imagen-3.0-generate-002',
                  params: payload.query as unknown as ImageGenerationRequest,
                })
                pluginExecuteResults[call.name] = result
              }
            } else {
              const result = await pluginHandle(pluginId, payload)
              pluginExecuteResults[call.name] = result
            }
          } else {
            let url = payload.baseUrl
            const options: RequestInit = {
              method: payload.method,
            }
            if (payload.query) {
              const searchParams = new URLSearchParams(payload.query)
              url += `?${searchParams.toString()}`
            }
            if (payload.path) {
              for (const key in payload.path) {
                url.replaceAll(`{${key}}`, payload.path[key])
              }
            }
            if (payload.headers) options.headers = payload.headers
            if (payload.body) options.body = payload.body
            if (payload.formData) options.body = payload.formData
            const apiResponse = await fetch(url, options)
            const result = await apiResponse.json()
            if (apiResponse.status !== 200) {
              throw new Error(result?.message || apiResponse.statusText)
            }
            pluginExecuteResults[call.name] = result
          }
          const executingPluginsStatus = executingPlugins.filter((name) => name !== call.name)
          setExecutingPlugins([...executingPluginsStatus])
        } catch (err) {
          if (err instanceof Error) {
            handleError(err.message, 500)
          }
        }
      }
      const functionResponses = []
      for (const [name, result] of entries(pluginExecuteResults)) {
        functionResponses.push({
          functionResponse: {
            name,
            response: {
              name,
              content: result,
            },
          },
        })
      }
      if (functionResponses.length > 0) {
        const functionResponseMessage = {
          id: nanoid(),
          role: 'function',
          parts: functionResponses,
        }
        addMessage(functionResponseMessage)
        /**
         * Send the API response back to the model so it can generate
         * a text response that can be displayed to the user.
         */
        await fetchAnswer({
          messages: [...messagesRef.current],
          model,
          onResponse: handleResponse,
          onError: (message, code) => {
            handleError(message, code)
          },
        })
      }
    },
    [fetchAnswer, handleResponse, handleError, executingPlugins],
  )

  const checkAccessStatus = useCallback(() => {
    const { password, apiKey } = useSettingStore.getState()
    const { isProtected, buildMode } = useEnvStore.getState()
    const isProtectedMode = isProtected && password === '' && apiKey === ''
    const isStaticMode = buildMode === 'export' && apiKey === ''
    if (isProtectedMode || isStaticMode) {
      setSetingOpen(true)
      return false
    } else {
      return true
    }
  }, [])

  const handleSubmit = useCallback(
    async (text: string): Promise<void> => {
      if (!checkAccessStatus()) return
      if (text === '') return
      const { model } = useSettingStore.getState()
      const { files, clear: clearAttachment } = useAttachmentStore.getState()
      const { summary, add: addMessage } = useMessageStore.getState()
      const messagePart: Message['parts'] = []
      let talkAudioMode: boolean = false
      if (files.length > 0) {
        for (const file of files) {
          if (isOldVisionModel) {
            if (file.dataUrl) {
              messagePart.push({
                inlineData: {
                  mimeType: file.mimeType,
                  data: file.dataUrl.split(';base64,')[1],
                },
              })
            }
          } else {
            if (file.metadata) {
              messagePart.push({
                fileData: {
                  mimeType: file.metadata.mimeType,
                  fileUri: file.metadata.uri,
                },
              })
            } else if (file.dataUrl) {
              messagePart.push({
                inlineData: {
                  mimeType: file.mimeType,
                  data: file.dataUrl.split(';base64,')[1],
                },
              })
            }
          }
        }
      }
      if (text.startsWith('data:audio/webm;base64,') || text.startsWith('data:audio/mp4;base64,')) {
        const audioData = text.substring(5).split(';base64,')
        messagePart.push({
          inlineData: {
            mimeType: audioData[0],
            data: audioData[1],
          },
        })
        talkAudioMode = true
      } else {
        messagePart.push({ text })
      }
      const newUserMessage: Message = {
        id: nanoid(),
        role: 'user',
        parts: messagePart,
      }
      if (files && !isOldVisionModel) {
        newUserMessage.attachments = files
      }
      addMessage(newUserMessage)
      let messages: Message[] = [...messagesRef.current]
      if (talkAudioMode) {
        messages = getTalkAudioPrompt(messages)
      }
      if (talkMode === 'voice') {
        setStatus('thinkng')
        setSubtitle('')
      }
      if (summary.content !== '') {
        const newMessages = messages.filter((item) => !summary.ids.includes(item.id))
        messages = [...getSummaryPrompt(summary.content), ...newMessages]
      }
      setContent('')
      clearAttachment()
      setTextareaHeight(TEXTAREA_DEFAULT_HEIGHT)
      scrollToBottom()
      await fetchAnswer({
        messages,
        model,
        onResponse: handleResponse,
        onFunctionCall: handleFunctionCall,
        onError: handleError,
      })
    },
    [
      isOldVisionModel,
      fetchAnswer,
      talkMode,
      handleResponse,
      handleFunctionCall,
      handleError,
      checkAccessStatus,
      scrollToBottom,
    ],
  )

  const handleResubmit = useCallback(
    async (id: string) => {
      if (!checkAccessStatus()) return false
      const { model } = useSettingStore.getState()
      const { messages, revoke: rovokeMessage } = useMessageStore.getState()
      if (id !== 'error') {
        const messageIndex = findIndex(messages, { id })
        if (messageIndex !== -1) {
          if (messages[messageIndex].role === 'model') {
            rovokeMessage(id)
          } else {
            const nextMessage = messages[messageIndex + 1]
            if (nextMessage) rovokeMessage(messages[messageIndex + 1].id)
          }
        }
      }
      scrollToBottom()
      await fetchAnswer({
        messages: [...messagesRef.current],
        model,
        onResponse: handleResponse,
        onFunctionCall: handleFunctionCall,
        onError: handleError,
      })
    },
    [fetchAnswer, handleResponse, handleFunctionCall, handleError, checkAccessStatus, scrollToBottom],
  )

  const handleCleanMessage = useCallback(() => {
    const { clear: clearMessage, backup, restore } = useMessageStore.getState()
    const conversation = backup()
    clearMessage()
    setErrorMessage('')
    toast({
      title: t('chatContentCleared'),
      action: (
        <ToastAction altText="Undo" onClick={() => restore(conversation)}>
          {t('undo')}
        </ToastAction>
      ),
      duration: 3600,
    })
  }, [toast, t])

  const handleRecorder = useCallback(() => {
    if (!checkAccessStatus()) return false
    if (!audioStreamRef.current) {
      audioStreamRef.current = new AudioStream()
    }
    const { autoStopRecord } = useSettingStore.getState()
    if (!audioRecordRef.current || audioRecordRef.current.autoStop !== autoStopRecord) {
      audioRecordRef.current = new AudioRecorder({
        autoStop: autoStopRecord,
        onStart: () => {
          setIsRecording(true)
        },
        onTimeUpdate: (time) => {
          setRecordTime(time)
        },
        onFinish: async (audioData) => {
          const recordType = getRecordMineType()
          const file = new File([audioData], `${Date.now()}.${recordType.extension}`, { type: recordType.mineType })
          const recordDataURL = await readFileAsDataURL(file)
          handleSubmit(recordDataURL)
          setIsRecording(false)
        },
      })
      audioRecordRef.current.start()
    } else {
      if (audioRecordRef.current.isRecording) {
        audioRecordRef.current.stop()
      } else {
        audioRecordRef.current.start()
      }
    }
  }, [checkAccessStatus, handleSubmit])

  const handleStopTalking = useCallback(() => {
    setSpeechSilence(true)
    speechQueue.current?.empty()
    audioStreamRef.current?.stop()
    setStatus('silence')
  }, [])

  const handleKeyDown = useCallback(
    (ev: KeyboardEvent<HTMLTextAreaElement>) => {
      if (ev.key === 'Enter' && ev.shiftKey && !isRecording) {
        if (!checkAccessStatus()) return false
        // Prevent the default carriage return and line feed behavior
        ev.preventDefault()
        handleSubmit(content)
      }
    },
    [content, handleSubmit, checkAccessStatus, isRecording],
  )

  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!supportAttachment) return false
      if (!checkAccessStatus()) return false

      if (files) {
        const fileList: File[] = []
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          if (mimeType.includes(file.type)) {
            if (isOfficeFile(file.type)) {
              const { parseOffice } = await import('@/utils/officeParser')
              const newFile = await parseOffice(file, { type: 'file' })
              if (newFile instanceof File) fileList.push(newFile)
            } else {
              fileList.push(file)
            }
          } else if (file.type.startsWith('text/')) {
            fileList.push(file)
          }
        }

        const { add: addAttachment, update: updateAttachment } = useAttachmentStore.getState()
        if (isOldVisionModel) {
          await imageUpload({ files: fileList, addAttachment, updateAttachment })
        } else {
          const { apiKey, apiProxy, password } = useSettingStore.getState()
          const { uploadLimit } = useEnvStore.getState()
          const options: FileManagerOptions =
            apiKey !== '' ? { apiKey, baseUrl: apiProxy || GEMINI_API_BASE_URL } : { token: encodeToken(password) }

          await fileUpload({
            files: fileList,
            uploadLimit,
            fileManagerOptions: options,
            addAttachment,
            updateAttachment,
          })
        }
      }
    },
    [supportAttachment, isOldVisionModel, checkAccessStatus],
  )

  const handlePaste = useCallback(
    async (ev: React.ClipboardEvent<HTMLDivElement>) => {
      await handleFileUpload(ev.clipboardData?.files)
    },
    [handleFileUpload],
  )

  const handleDrop = useCallback(
    async (ev: React.DragEvent<HTMLDivElement>) => {
      ev.preventDefault()
      await handleFileUpload(ev.dataTransfer?.files)
    },
    [handleFileUpload],
  )

  const handleStopGenerate = useCallback(() => {
    const { clearReference } = useMessageStore.getState()
    stopGeneratingRef.current = true
    setIsThinking(false)
    setMessage('')
    setThinkingMessage('')
    clearReference()
  }, [])

  const genPluginStatusPart = useCallback((plugins: string[]) => {
    const parts = []
    for (const name of plugins) {
      parts.push({
        functionResponse: {
          name,
          response: {
            name,
            content: null,
          },
        },
      })
    }
    return parts
  }, [])

  const handleChangeChatLayout = useCallback((type: 'chat' | 'doc') => {
    const { changeChatLayout } = useMessageStore.getState()
    changeChatLayout(type)
  }, [])

  const handleToggleSidebar = useCallback(() => {
    const { update } = useSettingStore.getState()
    toggleSidebar()
    update({ sidebarState: sidebarState === 'expanded' ? 'collapsed' : 'expanded' })
  }, [sidebarState, toggleSidebar])

  useEffect(() => {
    useMessageStore.subscribe((state) => {
      messagesRef.current = state.messages
    })
    if (messages.length === 0) {
      setErrorMessage('')
      setExecutingPlugins([])
    }
  }, [messages])

  useEffect(() => {
    const { ttsLang, ttsVoice, update } = useSettingStore.getState()
    if (ttsLang !== '') {
      const edgeSpeech = new EdgeSpeech({ locale: ttsLang })
      edgeSpeechRef.current = edgeSpeech
      if (ttsVoice === '') {
        const voiceOptions = edgeSpeech.voiceOptions
        update({ ttsVoice: voiceOptions ? (voiceOptions[0].value as string) : 'en-US-EmmaMultilingualNeural' })
      }
    }
  }, [])

  useEffect(() => {
    if (isOldVisionModel || isThinkingModel || isLiteModel || isImageGenerationModel) {
      setEnablePlugin(false)
    } else {
      setEnablePlugin(true)
    }
  }, [isOldVisionModel, isThinkingModel, isLiteModel, isImageGenerationModel])

  useLayoutEffect(() => {
    const setting = useSettingStore.getState()
    if (sidebarState === 'collapsed' && setting.sidebarState === 'expanded') {
      toggleSidebar()
    }
  }, [sidebarState, toggleSidebar])

  useLayoutEffect(() => {
    const { lang, update } = useSettingStore.getState()
    if (lang === '') {
      const browserLang = detectLanguage()
      i18n.changeLanguage(browserLang)
      const payload: Partial<Setting> = { lang: browserLang, sttLang: browserLang, ttsLang: browserLang }
      const options = new EdgeSpeech({ locale: browserLang }).voiceOptions
      if (options) {
        payload.ttsVoice = options[0].value
      }
      update(payload)
    }
  }, [])

  return (
    <main className="mx-auto flex h-screen max-h-[-webkit-fill-available] w-full max-w-screen-lg flex-col justify-between overflow-hidden max-lg:max-w-screen-md">
      <div className="flex w-full justify-between px-4 pb-2 pr-2 pt-10 max-md:pt-4 max-sm:pr-2 max-sm:pt-4">
        <div className="flex items-center text-red-400">
          <div>
            <MessageCircleHeart className="h-10 w-10 max-sm:h-8 max-sm:w-8" />
          </div>
          <div className="ml-1 flex-1 max-sm:ml-0.5">
            <h2 className="text-line-clamp break-all font-bold leading-6 max-sm:text-sm">{conversationTitle}</h2>
            <ModelSelect
              className="flex h-4 justify-start border-none px-0 py-0 text-left leading-4 text-slate-500 hover:text-slate-700 dark:hover:text-slate-400"
              defaultModel={model}
            />
          </div>
        </div>
        <div className="flex w-32 items-center gap-1 max-sm:gap-0">
          <a href="https://github.com/u14app/gemini-next-chat" target="_blank">
            <Button className="h-8 w-8" title={t('github')} variant="ghost" size="icon">
              <Github className="h-5 w-5" />
            </Button>
          </a>
          <ThemeToggle />
          <Button
            className="h-8 w-8"
            title={t('conversationList')}
            variant="ghost"
            size="icon"
            onClick={() => handleToggleSidebar()}
          >
            {sidebarState === 'collapsed' ? <PanelLeftOpen /> : <PanelLeftClose className="h-5 w-5" />}
          </Button>
          <Button
            className="h-8 w-8"
            title={t('setting')}
            variant="ghost"
            size="icon"
            onClick={() => setSetingOpen(true)}
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </div>
      {messages.length === 0 && content === '' && systemInstruction === '' && !systemInstructionEditMode ? (
        <AssistantRecommend />
      ) : (
        <div className="w-full max-w-screen-lg flex-1 overflow-y-auto scroll-smooth max-lg:max-w-screen-md">
          <div className="flex grow flex-col justify-start">
            {systemInstruction !== '' || systemInstructionEditMode ? (
              <div className="w-full flex-1 px-4 py-2">
                <SystemInstruction />
              </div>
            ) : null}
            {messages.map((msg, idx) => (
              <div
                className={cn(
                  'group text-slate-500 transition-colors last:text-slate-800 hover:text-slate-800 dark:last:text-slate-400 dark:hover:text-slate-400 max-sm:hover:bg-transparent',
                  msg.role === 'model' && msg.parts && msg.parts[0]?.functionCall ? 'hidden' : '',
                )}
                key={msg.id}
              >
                <div
                  className={cn(
                    'relative flex gap-3 p-4 pb-1 hover:bg-gray-50/80 dark:hover:bg-gray-900/80',
                    msg.role === 'user' && chatLayout === 'chat' ? 'flex-row-reverse text-right' : '',
                  )}
                >
                  <MessageItem {...msg} onRegenerate={handleResubmit} />
                </div>
              </div>
            ))}
            {executingPlugins.length > 0 ? (
              <div className="group text-slate-500 transition-colors last:text-slate-800 hover:text-slate-800 dark:last:text-slate-400 dark:hover:text-slate-400 max-sm:hover:bg-transparent">
                <div className="flex gap-3 p-4 hover:bg-gray-50/80 dark:hover:bg-gray-900/80">
                  <MessageItem id="message" role="function" parts={genPluginStatusPart(executingPlugins)} />
                </div>
              </div>
            ) : null}
            {isThinking ? (
              <div className="group text-slate-500 transition-colors last:text-slate-800 hover:text-slate-800 dark:last:text-slate-400 dark:hover:text-slate-400 max-sm:hover:bg-transparent">
                <div className="flex gap-3 p-4 pb-1 hover:bg-gray-50/80 dark:hover:bg-gray-900/80">
                  <MessageItem
                    id="message"
                    role="model"
                    parts={
                      thinkingMessage !== ''
                        ? [{ text: thinkingMessage }, { text: message }]
                        : references.length > 0
                          ? [{ text: message }, ...references]
                          : [{ text: message }]
                    }
                  />
                </div>
              </div>
            ) : null}
            {errorMessage !== '' ? (
              <div className="group text-slate-500 transition-colors last:text-slate-800 hover:text-slate-800 dark:last:text-slate-400 dark:hover:text-slate-400 max-sm:hover:bg-transparent">
                <div className="flex gap-3 p-4 hover:bg-gray-50/80 dark:hover:bg-gray-900/80">
                  <ErrorMessageItem content={errorMessage} onRegenerate={() => handleResubmit('error')} />
                </div>
              </div>
            ) : null}
            {content !== '' ? (
              <div className="group text-slate-500 transition-colors last:text-slate-800 hover:text-slate-800 dark:last:text-slate-400 dark:hover:text-slate-400 max-sm:hover:bg-transparent">
                <div
                  className={cn(
                    'relative flex gap-3 p-4 pb-1 hover:bg-gray-50/80 dark:hover:bg-gray-900/80',
                    chatLayout === 'chat' ? 'flex-row-reverse text-right' : '',
                  )}
                >
                  <MessageItem id="preview" role="user" parts={[{ text: content }]} />
                </div>
              </div>
            ) : null}
            {messages.length > 0 ? (
              <div className="my-2 flex h-4 justify-center text-xs text-slate-400 duration-300 dark:text-slate-600">
                <span
                  className="cursor-pointer hover:text-slate-500"
                  onClick={() => handleChangeChatLayout(chatLayout === 'doc' ? 'chat' : 'doc')}
                >
                  {t('changeChatLayout')}
                </span>
                <span className="mx-2 mt-0.5 h-3 border-r-[1px]"></span>
                <span className="cursor-pointer hover:text-slate-500" onClick={() => handleCleanMessage()}>
                  {t('clearChatContent')}
                </span>
              </div>
            ) : null}
            <div ref={scrollAreaBottomRef}></div>
          </div>
        </div>
      )}
      <div className="max-w-screen-lg bg-background px-4 pb-8 pt-2 max-lg:max-w-screen-md max-md:pb-4 max-sm:p-2 max-sm:pb-3">
        <div className="flex w-full items-end gap-2 max-sm:pb-[calc(var(--safe-area-inset-bottom)-16px)]">
          {enablePlugin ? <PluginList /> : null}
          <div
            className="relative box-border flex w-full flex-1 flex-col rounded-md border border-input bg-[hsl(var(--background))] py-1 max-sm:py-0"
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={(ev) => ev.preventDefault()}
          >
            <div className="p-2 pb-0 pt-1 empty:p-0 max-sm:pt-2">
              <AttachmentArea className="max-h-32 w-full overflow-y-auto border-b border-dashed pb-2" />
            </div>
            <textarea
              autoFocus
              className={cn(
                'max-h-[120px] w-full resize-none border-none bg-transparent px-2 pt-1 text-sm leading-6 transition-[height] focus-visible:outline-none',
                !supportSpeechRecognition ? 'pr-8' : 'pr-16',
              )}
              style={{ height: `${textareaHeight}px` }}
              value={content}
              placeholder={t('askAQuestion')}
              onChange={(ev) => {
                setContent(ev.target.value)
                setTextareaHeight(ev.target.value === '' ? TEXTAREA_DEFAULT_HEIGHT : ev.target.scrollHeight)
                if (messages.length > 1) scrollToBottom()
              }}
              onKeyDown={handleKeyDown}
            />
            <div className="absolute bottom-0.5 right-1 flex max-sm:bottom-0">
              {supportAttachment ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="box-border flex h-8 w-8 cursor-pointer items-center justify-center rounded-full p-1.5 text-slate-800 hover:bg-secondary/80 dark:text-slate-600 max-sm:h-7 max-sm:w-7">
                        <FileUploader beforeUpload={() => checkAccessStatus()} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="mb-1 max-w-36">
                      {isOldVisionModel ? t('imageUploadTooltip') : t('uploadTooltip')}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
              {supportSpeechRecognition ? (
                <TooltipProvider>
                  <Tooltip open={isRecording}>
                    <TooltipTrigger asChild>
                      <div
                        className="box-border flex h-8 w-8 cursor-pointer items-center justify-center rounded-full p-1.5 text-slate-800 hover:bg-secondary/80 dark:text-slate-600 max-sm:h-7 max-sm:w-7"
                        onClick={() => handleRecorder()}
                      >
                        <Mic className={isRecording ? 'animate-pulse' : ''} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      className={cn(
                        'mb-1 px-2 py-1 text-center',
                        isUndefined(audioRecordRef.current?.isRecording) ? '' : 'font-mono text-red-500',
                      )}
                    >
                      {isUndefined(audioRecordRef.current?.isRecording) ? t('startRecording') : formatTime(recordTime)}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
            </div>
          </div>
          {isThinking ? (
            <Button
              className="rounded-full max-sm:h-8 max-sm:w-8 [&_svg]:size-4 max-sm:[&_svg]:size-3"
              title={t('stop')}
              variant="secondary"
              size="icon"
              onClick={() => handleStopGenerate()}
            >
              <Square />
            </Button>
          ) : content === '' && files.length === 0 && supportSpeechRecognition ? (
            <Button
              className="max-sm:h-8 max-sm:w-8 [&_svg]:size-5 max-sm:[&_svg]:size-4"
              title={t('voiceMode')}
              variant="secondary"
              size="icon"
              onClick={() => setTalkMode('voice')}
            >
              <AudioLines />
            </Button>
          ) : (
            <Button
              className="max-sm:h-8 max-sm:w-8 [&_svg]:size-5 max-sm:[&_svg]:size-4"
              title={t('send')}
              variant="secondary"
              size="icon"
              disabled={isRecording || isUploading}
              onClick={() => handleSubmit(content)}
            >
              <SendHorizontal />
            </Button>
          )}
        </div>
      </div>
      {talkMode === 'voice' ? (
        canUseMultimodalLive ? (
          <MultimodalLive onClose={() => setTalkMode('chat')} />
        ) : (
          <TalkWithVoice
            status={status}
            content={content}
            subtitle={subtitle}
            errorMessage={errorMessage}
            recordTime={recordTime}
            isRecording={isRecording}
            onRecorder={handleRecorder}
            onStop={handleStopTalking}
            onClose={() => setTalkMode('chat')}
            openSetting={() => setSetingOpen(true)}
          />
        )
      ) : null}
      <Setting open={settingOpen} hiddenTalkPanel={!supportSpeechRecognition} onClose={() => setSetingOpen(false)} />
    </main>
  )
}
