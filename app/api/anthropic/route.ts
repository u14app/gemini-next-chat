import { NextResponse, type NextRequest } from 'next/server'
import { ANTHROPIC_API_BASE_URL } from '@/constant/urls'
import { handleError } from '../utils'
import { getRandomKey } from '@/utils/common'

export const runtime = 'edge'
export const preferredRegion = ['cle1', 'iad1', 'pdx1', 'sfo1', 'sin1', 'syd1', 'hnd1', 'kix1']

const anthropicApiKey = process.env.ANTHROPIC_API_KEY as string
const anthropicApiBaseUrl = process.env.ANTHROPIC_API_BASE_URL as string

export async function POST(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const body = await req.json()
  const model = searchParams.get('model')!
  const apiKey = getRandomKey(anthropicApiKey)

  try {
    // Convert Gemini-style request to Anthropic format
    const anthropicMessages = body.contents?.map((content: any) => {
      if (content.role === 'user') {
        const parts = content.parts || []
        if (parts.length === 1 && parts[0].text) {
          return { role: 'user', content: parts[0].text }
        } else {
          // Handle multi-modal content
          const content_parts = parts.map((part: any) => {
            if (part.text) {
              return { type: 'text', text: part.text }
            } else if (part.inlineData) {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: part.inlineData.mimeType,
                  data: part.inlineData.data
                }
              }
            }
            return null
          }).filter(Boolean)
          
          return { role: 'user', content: content_parts }
        }
      } else if (content.role === 'model') {
        const text = content.parts?.[0]?.text || ''
        return { role: 'assistant', content: text }
      }
      return null
    }).filter(Boolean) || []

    const anthropicRequest = {
      model: model,
      messages: anthropicMessages,
      max_tokens: body.generationConfig?.maxOutputTokens || 1000,
      temperature: body.generationConfig?.temperature || 0.7,
      top_p: body.generationConfig?.topP || 1.0,
      stream: true,
    }

    const response = await fetch(`${anthropicApiBaseUrl || ANTHROPIC_API_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicRequest),
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Anthropic API error: ${response.status} ${errorData}`)
    }

    // Transform Anthropic streaming response to Gemini format
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk)
        const lines = text.split('\n')
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              
              if (data.type === 'content_block_delta' && data.delta?.text) {
                const geminiChunk = {
                  candidates: [{
                    content: {
                      parts: [{ text: data.delta.text }],
                      role: 'model'
                    },
                    finishReason: null
                  }]
                }
                
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(geminiChunk)}\n\n`))
              } else if (data.type === 'message_stop') {
                const geminiChunk = {
                  candidates: [{
                    content: {
                      parts: [{ text: '' }],
                      role: 'model'
                    },
                    finishReason: 'STOP'
                  }]
                }
                
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(geminiChunk)}\n\n`))
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    })

    return new NextResponse(response.body?.pipeThrough(transformStream), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    })
  } catch (error) {
    if (error instanceof Error) {
      return handleError(error.message)
    }
  }
}
