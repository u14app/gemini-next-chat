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
      // Forward to OpenAI API route
      const url = new URL('/api/openai', req.url)
      url.searchParams.set('model', model)
      
      return fetch(url.toString(), {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(body),
      })
    } else if (provider === 'anthropic') {
      // Forward to Anthropic API route
      const url = new URL('/api/anthropic', req.url)
      url.searchParams.set('model', model)
      
      return fetch(url.toString(), {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(body),
      })
    } else if (provider === 'xai') {
      // Forward to xAI API route
      const url = new URL('/api/xai', req.url)
      url.searchParams.set('model', model)
      
      return fetch(url.toString(), {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(body),
      })
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
