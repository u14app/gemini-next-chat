import type { Content, GroundingMetadata } from '@xiangfa/generative-ai'
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types'

declare global {
  interface Message extends Content {
    id: string
    attachments?: FileInfor[]
    groundingMetadata?: GroundingMetadata & {
      groundingChunks: Array<{ web: { uri: string; title: string } }>
      groundingSupports: Array<{
        segment: { startIndex?: number; endIndex?: number; text: string }
        groundingChunkIndices: number[]
        confidenceScores: number[]
      }>
    }
  }

  interface Setting {
    password: string
    apiKey: string
    apiProxy: string
    model: string
    lang: string
    sttLang: string
    ttsLang: string
    ttsVoice: string
    talkMode: 'chat' | 'voice'
    maxHistoryLength: number
    assistantIndexUrl: string
    topP: number
    topK: number
    temperature: number
    maxOutputTokens: number
    safety: 'none' | 'low' | 'middle' | 'high'
    autoStartRecord: boolean
    autoStopRecord: boolean
    sidebarState: 'expanded' | 'collapsed'
  }

  interface Assistant {
    author: string
    createdAt: string
    homepage: string
    identifier: string
    meta: {
      avatar: string
      tags: string[]
      title: string
      description: string
    }
    schemaVersion: number
  }

  interface AssistantDetail extends Assistant {
    config: {
      systemRole: string
    }
  }

  type OpenAPIDocument<T extends {} = {}> = OpenAPIV3.Document<T> | OpenAPIV3_1.Document<T>

  type OpenAPIOperation<T extends {} = {}> = OpenAPIV3.OperationObject<T> | OpenAPIV3_1.OperationObject<T>

  type OpenAPIParameter = OpenAPIV3_1.ParameterObject | OpenAPIV3.ParameterObject

  type OpenAPIParameters = OpenAPIV3_1.ParameterObject[] | OpenAPIV3.ParameterObject[]

  type OpenAPIRequestBody = OpenAPIV3.RequestBodyObject | OpenAPIV3_1.RequestBodyObject

  interface PluginManifest {
    name_for_human: string
    name_for_model: string
    description_for_human: string
    description_for_model: string
    api: {
      is_user_authenticated: boolean
      type: string
      url: string
    }
    auth: {
      type: string
    }
    logo_url: string
    contact_email: string
    legal_info_url: string
    schema_version: string
  }

  interface FileMetadata {
    name: string
    displayName?: string
    mimeType: string
    sizeBytes: string
    createTime: string
    updateTime: string
    expirationTime: string
    sha256Hash: string
    uri: string
    state: 'STATE_UNSPECIFIED' | 'PROCESSING' | 'ACTIVE' | 'FAILED'
  }

  interface FileInfor {
    id: string
    name: string
    mimeType: string
    size: number
    preview?: string
    metadata?: FileMetadata
    dataUrl?: string
    status: 'STATE_UNSPECIFIED' | 'PROCESSING' | 'ACTIVE' | 'FAILED'
  }

  interface GatewayPayload {
    baseUrl: string
    method: 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'
    body?: any
    formData?: any
    headers?: Record<string, string>
    path?: Record<string, string>
    query?: Record<string, string>
    cookie?: Record<string, string>
  }

  interface Model {
    name: string
    baseModelId: string
    version: string
    displayName: string
    description: string
    inputTokenLimit: number
    outputTokenLimit: number
    supportedGenerationMethods: string[]
    temperature: number
    maxTemperature: number
    topP: number
    topK: number
  }

  interface FunctionResponse<T = unknown> {
    name: string
    content: T
  }

  interface UnsplashImage {
    id: string
    width: number
    height: number
    title: string
    color: string
    createdAt: string
    download: string
    link: string
    tags: string[]
    src: string
    thumbnail: string
    user: {
      name: string
      avatar: string
      link: string
    }
  }

  interface ArxivArticle {
    id: string
    updated: string
    published: string
    title: string
    summary: string
    author: string[]
    link: string
    pdf: string
  }

  interface ArxivResult {
    link: string
    title: string
    id: string
    updated: string
    total: number
    page: number
    size: number
    data: ArxivArticle[]
  }

  interface ErrorResponse {
    code: number
    message: string
  }

  interface Summary {
    ids: string[]
    content: string
  }

  interface Conversation {
    title: string
    messages: Message[]
    summary: Summary
    systemInstruction: string
    chatLayout: 'chat' | 'doc'
  }
}
