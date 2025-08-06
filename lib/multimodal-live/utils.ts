import type {
  SetupMessage,
  ClientContentMessage,
  RealtimeInputMessage,
  ToolResponseMessage,
  SetupCompleteMessage,
  ServerContentMessage,
  ToolCallMessage,
  ToolCallCancellationMessage,
  ModelTurn,
  TurnComplete,
  Interrupted,
  ToolCall,
  ToolResponse,
  LiveFunctionCall,
  LiveFunctionResponse,
} from './types'

export type GetAudioContextOptions = AudioContextOptions & {
  id?: string
}

const map: Map<string, AudioContext> = new Map()

export const audioContext: (options?: GetAudioContextOptions) => Promise<AudioContext> = (() => {
  return async (options?: GetAudioContextOptions) => {
    if (options?.id && map.has(options.id)) {
      const ctx = map.get(options.id)
      if (ctx) {
        return ctx
      }
    }
    const ctx = new AudioContext(options)
    if (options?.id) {
      map.set(options.id, ctx)
    }
    return ctx
  }
})()

export const blobToJSON = (blob: Blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result) {
        const json = JSON.parse(reader.result as string)
        resolve(json)
      } else {
        reject('oops')
      }
    }
    reader.readAsText(blob)
  })

export function base64ToArrayBuffer(base64: string) {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

// Type-Guards

const prop = (a: any, prop: string) => typeof a === 'object' && typeof a[prop] === 'object'

// outgoing messages
export const isSetupMessage = (a: unknown): a is SetupMessage => prop(a, 'setup')

export const isClientContentMessage = (a: unknown): a is ClientContentMessage => prop(a, 'clientContent')

export const isRealtimeInputMessage = (a: unknown): a is RealtimeInputMessage => prop(a, 'realtimeInput')

export const isToolResponseMessage = (a: unknown): a is ToolResponseMessage => prop(a, 'toolResponse')

// incoming messages
export const isSetupCompleteMessage = (a: unknown): a is SetupCompleteMessage => prop(a, 'setupComplete')

export const isServerContentMessage = (a: any): a is ServerContentMessage => prop(a, 'serverContent')

export const isToolCallMessage = (a: any): a is ToolCallMessage => prop(a, 'toolCall')

export const isToolCallCancellationMessage = (a: unknown): a is ToolCallCancellationMessage =>
  prop(a, 'toolCallCancellation') && isToolCallCancellation((a as any).toolCallCancellation)

export const isModelTurn = (a: any): a is ModelTurn => typeof (a as ModelTurn).modelTurn === 'object'

export const isTurnComplete = (a: any): a is TurnComplete => typeof (a as TurnComplete).turnComplete === 'boolean'

export const isInterrupted = (a: any): a is Interrupted => (a as Interrupted).interrupted

export function isToolCall(value: unknown): value is ToolCall {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>

  return Array.isArray(candidate.functionCalls) && candidate.functionCalls.every((call) => isLiveFunctionCall(call))
}

export function isToolResponse(value: unknown): value is ToolResponse {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>

  return (
    Array.isArray(candidate.functionResponses) &&
    candidate.functionResponses.every((resp) => isLiveFunctionResponse(resp))
  )
}

export function isLiveFunctionCall(value: unknown): value is LiveFunctionCall {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.name === 'string' &&
    typeof candidate.id === 'string' &&
    typeof candidate.args === 'object' &&
    candidate.args !== null
  )
}

export function isLiveFunctionResponse(value: unknown): value is LiveFunctionResponse {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>

  return typeof candidate.response === 'object' && typeof candidate.id === 'string'
}

export const isToolCallCancellation = (a: unknown): a is ToolCallCancellationMessage['toolCallCancellation'] =>
  typeof a === 'object' && Array.isArray((a as any).ids)
