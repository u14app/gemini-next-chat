import { NextResponse, type NextRequest } from 'next/server'
import { handleError } from '../utils'
import { ErrorType } from '@/constant/errors'
import { getRandomKey } from '@/utils/common'
import { isNull } from 'lodash-es'

export const runtime = 'edge'
export const preferredRegion = ['cle1', 'iad1', 'pdx1', 'sfo1', 'sin1', 'syd1', 'hnd1', 'kix1']

const geminiApiKey = process.env.GEMINI_API_KEY as string
const geminiApiBaseUrl = process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com'

export async function POST(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const uploadType = searchParams.get('uploadType')

  try {
    if (uploadType === 'resumable') {
      const { fileName, mimeType } = await req.json()
      const apiKey = getRandomKey(geminiApiKey, true)
      const response = await fetch(`${geminiApiBaseUrl}/upload/v1beta/files?uploadType=resumable&key=${apiKey}`, {
        method: 'POST',
        body: JSON.stringify({
          file: {
            displayName: fileName,
            mimeType,
          },
        }),
      })
      const sessionUrl = response.headers.get('Location')
      if (isNull(sessionUrl)) {
        return NextResponse.json({ code: 50002, message: ErrorType.NoUploadURL }, { status: 500 })
      }
      const uploadUrl = new URL(sessionUrl)
      uploadUrl.protocol = req.nextUrl.protocol
      uploadUrl.host = req.nextUrl.host
      uploadUrl.pathname = '/api/google/upload/v1beta/files'
      uploadUrl.searchParams.delete('key')
      const url = uploadUrl.toString()
      return NextResponse.json({ url }, { headers: { Location: url } })
    } else {
      throw new Error(ErrorType.UnsupportedApiType)
    }
  } catch (error) {
    if (error instanceof Error) {
      return handleError(error.message)
    }
  }
}
