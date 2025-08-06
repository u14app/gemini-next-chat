import { NextResponse, type NextRequest } from 'next/server'
import { XAI_API_BASE_URL } from '@/constant/urls'
import { handleError } from '../utils'
import { getRandomKey } from '@/utils/common'

export const runtime = 'edge'
export const preferredRegion = ['cle1', 'iad1', 'pdx1', 'sfo1', 'sin1', 'syd1', 'hnd1', 'kix1']

const xaiApiKey = process.env.XAI_API_KEY as string
const xaiApiBaseUrl = process.env.XAI_API_BASE_URL as string

export async function POST(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const body = await req.json()
  const model = searchParams.get('model')!
  const apiKey = getRandomKey(xaiApiKey)

  try {
    // Convert Gemini-style request to xAI/OpenAI-compatible format
    const xaiMessages = body.contents?.map((content: any) => {
      if (content.role === 'user') {
        const parts = content.parts || []
        if (parts.length === 1 && parts[0].text) {
          return { role: 'user', content: parts[0].text }
        } else {
          // Handle multi-modal content for vision models
          const content_parts = parts.map((part: any) => {
            if (part.text) {
              return { type: 'text', text: part.text }
            } else if (part.inlineData) {
              return {
                type: 'image_url',
                image_url: {
                  url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
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

    const xaiRequest = {
      model: model,
      messages: xaiMessages,
      stream: true,
      temperature: body.generationConfig?.temperature || 0.7,
      max_tokens: body.generationConfig?.maxOutputTokens || 1000,
      top_p: body.generationConfig?.topP || 1.0,
    }

    const response = await fetch(`${xaiApiBaseUrl || XAI_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(xaiRequest),
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`xAI API error: ${response.status} ${errorData}`)
    }

    // Transform xAI streaming response to Gemini format (similar to OpenAI)
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk)
        const lines = text.split('\n')
        
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6))
              const content = data.choices?.[0]?.delta?.content
              
              if (content) {
                const geminiChunk = {
                  candidates: [{
                    content: {
                      parts: [{ text: content }],
                      role: 'model'
                    },
                    finishReason: data.choices?.[0]?.finish_reason === 'stop' ? 'STOP' : null
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
