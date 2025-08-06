import { NextResponse, type NextRequest } from 'next/server'
import { GEMINI_API_BASE_URL } from '@/constant/urls'
import { handleError } from '../utils'
import { hasUploadFiles, getRandomKey } from '@/utils/common'
import { ModelProviders } from '@/constant/model'

export const runtime = 'edge'
export const preferredRegion = ['cle1', 'iad1', 'pdx1', 'sfo1', 'sin1', 'syd1', 'hnd1', 'kix1']

const geminiApiKey = process.env.GEMINI_API_KEY as string
const geminiApiBaseUrl = process.env.GEMINI_API_BASE_URL as string

export async function POST(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const body = await req.json()
  const model = searchParams.get('model')!
  const provider = ModelProviders[model] || 'google'

  try {
    // Route to appropriate provider API
    if (provider === 'openai') {
      // Import and call OpenAI handler directly
      const { POST: openaiHandler } = await import('../openai/route')
      const openaiReq = new NextRequest(req.url.replace('/api/chat', '/api/openai') + `?model=${model}`, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(body),
      })
      return openaiHandler(openaiReq)
    } else if (provider === 'anthropic') {
      // Import and call Anthropic handler directly
      const { POST: anthropicHandler } = await import('../anthropic/route')
      const anthropicReq = new NextRequest(req.url.replace('/api/chat', '/api/anthropic') + `?model=${model}`, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(body),
      })
      return anthropicHandler(anthropicReq)
    } else if (provider === 'xai') {
      // Import and call xAI handler directly
      const { POST: xaiHandler } = await import('../xai/route')
      const xaiReq = new NextRequest(req.url.replace('/api/chat', '/api/xai') + `?model=${model}`, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(body),
      })
      return xaiHandler(xaiReq)
    } else {
      // Default to Google Gemini
      const version = 'v1beta'
      const apiKey = getRandomKey(geminiApiKey, hasUploadFiles(body.contents))
      
      let url = `${geminiApiBaseUrl || GEMINI_API_BASE_URL}/${version}/models/${model}`
      if (!model.startsWith('imagen')) url += '?alt=sse'
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': req.headers.get('Content-Type') || 'application/json',
          'x-goog-api-client': req.headers.get('x-goog-api-client') || 'genai-js/0.21.0',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      })
      return new NextResponse(response.body, response)
    }
  } catch (error) {
    if (error instanceof Error) {
      return handleError(error.message)
    }
  }
}
