import { NextResponse, type NextRequest } from 'next/server'
import { handleError } from '../utils'
import { ErrorType } from '@/constant/errors'
import { getRandomKey } from '@/utils/common'

const geminiApiKey = process.env.GEMINI_API_KEY as string
const geminiApiBaseUrl = process.env.GEMINI_API_BASE_URL as string
const mode = process.env.NEXT_PUBLIC_BUILD_MODE

export const runtime = 'edge'
export const preferredRegion = ['cle1', 'iad1', 'pdx1', 'sfo1', 'sin1', 'syd1', 'hnd1', 'kix1']

export async function GET(req: NextRequest) {
  if (mode === 'export') return new NextResponse('Not available under static deployment')

  if (!geminiApiKey) {
    return NextResponse.json({ code: 50001, message: ErrorType.NoGeminiKey }, { status: 500 })
  }

  try {
    const apiKey = getRandomKey(geminiApiKey)
    const apiBaseUrl = geminiApiBaseUrl || 'https://generativelanguage.googleapis.com'
    const response = await fetch(`${apiBaseUrl}/v1beta/models?key=${apiKey}`, { next: { revalidate: 60 } })
    const result = await response.json()
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error) {
      return handleError(error.message)
    }
  }
}
