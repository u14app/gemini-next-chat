import type { Content, FunctionCall, GenerationConfig, GenerativeContentBlob, Part, Tool } from '@xiangfa/generative-ai'

/**
 * this module contains type-definitions and Type-Guards
 */

// Type-definitions

/* outgoing types */

/**
 * the config to initiate the session
 */
export type LiveConfig = {
  model: string
  systemInstruction?: { parts: Part[] }
  generationConfig?: Partial<LiveGenerationConfig>
  tools?: Array<Tool | { googleSearch: object } | { codeExecution: object }>
}

export type LiveGenerationConfig = GenerationConfig & {
  responseModalities: string[]
  speechConfig?: {
    voiceConfig?: {
      prebuiltVoiceConfig?: {
        voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Aoede' | string
      }
    }
  }
}

export type LiveOutgoingMessage = SetupMessage | ClientContentMessage | RealtimeInputMessage | ToolResponseMessage

export type SetupMessage = {
  setup: LiveConfig
}

export type ClientContentMessage = {
  clientContent: {
    turns: Content[]
    turnComplete: boolean
  }
}

export type RealtimeInputMessage = {
  realtimeInput: {
    mediaChunks: GenerativeContentBlob[]
  }
}

export type ToolResponseMessage = {
  toolResponse: {
    functionResponses: LiveFunctionResponse[]
  }
}

export type ToolResponse = ToolResponseMessage['toolResponse']

export type LiveFunctionResponse = {
  response: object
  id: string
}

/** Incoming types */

export type LiveIncomingMessage =
  | ToolCallCancellationMessage
  | ToolCallMessage
  | ServerContentMessage
  | SetupCompleteMessage

export type SetupCompleteMessage = { setupComplete: object }

export type ServerContentMessage = {
  serverContent: ServerContent
}

export type ServerContent = ModelTurn | TurnComplete | Interrupted

export type ModelTurn = {
  modelTurn: {
    parts: Part[]
  }
}

export type TurnComplete = { turnComplete: boolean }

export type Interrupted = { interrupted: true }

export type ToolCallCancellationMessage = {
  toolCallCancellation: {
    ids: string[]
  }
}

export type ToolCallCancellation = ToolCallCancellationMessage['toolCallCancellation']

export type ToolCallMessage = {
  toolCall: ToolCall
}

export type LiveFunctionCall = FunctionCall & {
  id: string
}

/**
 * A `toolCall` message
 */
export type ToolCall = {
  functionCalls: LiveFunctionCall[]
}

/** log types */
export type StreamingLog = {
  date: Date
  type: string
  count?: number
  message: string | LiveOutgoingMessage | LiveIncomingMessage
}

export type UseMediaStreamResult = {
  type: 'webcam' | 'screen'
  start: () => Promise<MediaStream>
  stop: () => void
  isStreaming: boolean
  stream: MediaStream | null
}

export type MultimodalLiveAPIClientConnection = {
  url?: string
  apiKey: string
  model?: string
}
