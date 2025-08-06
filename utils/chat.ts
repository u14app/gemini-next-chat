import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@xiangfa/generative-ai'
import type {
  InlineDataPart,
  ModelParams,
  Tool,
  ToolConfig,
  Part,
  SafetySetting,
  GenerationConfig,
} from '@xiangfa/generative-ai'
import { getVisionPrompt, getFunctionCallPrompt } from '@/utils/prompt'
import { hasUploadFiles, getRandomKey } from '@/utils/common'
import { OldVisionModel, DefaultModel } from '@/constant/model'
import { isUndefined } from 'lodash-es'

export type RequestProps = {
  model?: string
  systemInstruction?: string
  tools?: Tool[]
  toolConfig?: ToolConfig
  messages: Message[]
  apiKey: string
  baseUrl?: string
  generationConfig: {
    topP: number
    topK: number
    temperature: number
    maxOutputTokens: number
  }
  safety: string
}

export type NewModelParams = ModelParams & {
  tools?: Array<Tool | { googleSearch: {} } | { codeExecution: {} }>
  safetySettings?: SafetySetting[] & Array<{ category: string; threshold: string }>
}

export function getSafetySettings(level: string) {
  let threshold: HarmBlockThreshold
  switch (level) {
    case 'none':
      threshold = HarmBlockThreshold.BLOCK_NONE
      break
    case 'low':
      threshold = HarmBlockThreshold.BLOCK_LOW_AND_ABOVE
      break
    case 'middle':
      threshold = HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      break
    case 'high':
      threshold = HarmBlockThreshold.BLOCK_ONLY_HIGH
      break
    default:
      threshold = HarmBlockThreshold.HARM_BLOCK_THRESHOLD_UNSPECIFIED
      break
  }
  return [
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    HarmCategory.HARM_CATEGORY_HARASSMENT,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  ].map((category) => {
    return { category, threshold }
  })
}

function canUseSearchAsTool(model: string) {
  if (model.startsWith('gemini-2.5-pro') || model.startsWith('gemini-2.5-flash')) return true
  return (
    model.startsWith('gemini-2.0') && !model.includes('lite') && !model.includes('thinking') && !model.includes('image')
  )
}

export default async function chat({
  messages = [],
  systemInstruction,
  tools,
  toolConfig,
  model = DefaultModel,
  apiKey,
  baseUrl,
  generationConfig,
  safety,
}: RequestProps) {
  const genAI = new GoogleGenerativeAI(getRandomKey(apiKey, hasUploadFiles(messages)))
  const modelParams: NewModelParams = {
    model,
    generationConfig,
    safetySettings: getSafetySettings(safety),
  }
  if (systemInstruction) {
    if (!model.startsWith('gemini-1.0')) {
      modelParams.systemInstruction = systemInstruction
    } else {
      const systemInstructionMessages = [
        { id: 'systemInstruction', role: 'user', parts: [{ text: systemInstruction }] },
        { id: 'systemInstruction2', role: 'model', parts: [{ text: 'ok' }] },
      ]
      messages = [...systemInstructionMessages, ...messages]
    }
  }
  if (
    tools &&
    !OldVisionModel.includes(model) &&
    !model.includes('lite') &&
    !model.includes('thinking') &&
    !model.includes('image')
  ) {
    const toolPrompt = getFunctionCallPrompt()
    modelParams.tools = tools
    modelParams.systemInstruction = modelParams.systemInstruction
      ? `${modelParams.systemInstruction}\n\n${toolPrompt}`
      : toolPrompt
    modelParams.generationConfig = {
      ...generationConfig,
      temperature: 0,
    }
    if (toolConfig) modelParams.toolConfig = toolConfig
  }
  if (canUseSearchAsTool(model)) {
    const officialPlugins = [{ googleSearch: {} }]
    if (!tools) {
      modelParams.tools = officialPlugins
    }
    if (modelParams.safetySettings) {
      const safetySettings: NewModelParams['safetySettings'] = []
      modelParams.safetySettings.forEach((item) => {
        if (safety === 'none') {
          safetySettings.push({ category: item.category, threshold: 'OFF' })
        } else {
          safetySettings.push(item)
        }
      })
      safetySettings.push({
        category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
        threshold: HarmBlockThreshold.BLOCK_NONE,
      })
      modelParams.safetySettings = safetySettings
    }
  }
  if (model.startsWith('gemini-2.0-flash-exp-image-generation') && modelParams.generationConfig) {
    modelParams.generationConfig.responseModalities = ['Text', 'Image']
  }
  const geminiModel = genAI.getGenerativeModel(modelParams, { baseUrl })
  const message = messages.pop()
  if (isUndefined(message)) {
    throw new Error('Request parameter error')
  }
  if (OldVisionModel.includes(model)) {
    const textMessages: Message[] = []
    const imageMessages: InlineDataPart[] = message.parts.filter((part) =>
      part.inlineData?.mimeType.startsWith('image/'),
    ) as InlineDataPart[]
    for (const item of messages) {
      for (const part of item.parts) {
        if (part.text) {
          textMessages.push(item)
        } else if (part.inlineData?.mimeType.startsWith('image/')) {
          imageMessages.push(part)
        }
      }
    }
    const prompt = getVisionPrompt(message, textMessages)
    if (imageMessages.length > 16) {
      throw new Error('Limited to 16 pictures')
    }
    const { stream } = await geminiModel.generateContentStream([prompt, ...imageMessages])
    return stream
  } else {
    const chat = geminiModel.startChat({
      history: messages.map((item) => {
        let parts: Part[] = []
        if (item.role === 'model') {
          let textPart: Part | null = null
          for (const part of item.parts) {
            if (part.text) {
              textPart = part
            } else {
              parts.push(part)
            }
          }
          if (textPart) parts = [textPart, ...parts]
        } else {
          parts = item.parts
        }
        return { role: item.role, parts }
      }),
    })
    const { stream } = await chat.sendMessageStream(message.parts)
    return stream
  }
}
