import { NextResponse, type NextRequest } from 'next/server'
import { ErrorType } from '@/constant/errors'
import { getRandomKey } from '@/utils/common'
import { isNull } from 'lodash-es'

export const runtime = 'edge'
export const preferredRegion = ['cle1', 'iad1', 'pdx1', 'sfo1', 'sin1', 'syd1', 'hnd1', 'kix1']

const geminiApiKey = process.env.GEMINI_API_KEY as string
const geminiApiBaseUrl = process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com'

export async function GET(req: NextRequest) {
  const apiKey = getRandomKey(geminiApiKey, true)
  const searchParams = req.nextUrl.searchParams
  const id = searchParams.get('id')
  searchParams.delete('token')
  searchParams.delete('id')
  searchParams.set('key', apiKey)
  const response = await fetch(`${geminiApiBaseUrl}/v1beta/files/${id}?${searchParams.toString()}`)
  return new NextResponse(response.body, response)
}

export async function POST(req: NextRequest) {
  const apiKey = getRandomKey(geminiApiKey, true)
  const searchParams = req.nextUrl.searchParams
  const uploadType = searchParams.get('uploadType')
  const uploadId = searchParams.get('upload_id')
  if (uploadType === 'resumable' && isNull(uploadId)) {
    throw new Error(ErrorType.UnsupportedApiType)
  }
  searchParams.delete('token')
  searchParams.set('key', apiKey)

  const response = await fetch(`${geminiApiBaseUrl}/upload/v1beta/files?${searchParams.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': req.headers.get('Content-Type') as string,
    },
    body: req.body,
  })
  return new NextResponse(response.body, response)
}

export async function PUT(req: NextRequest) {
  const apiKey = getRandomKey(geminiApiKey, true)
  const searchParams = req.nextUrl.searchParams
  searchParams.delete('token')
  searchParams.set('key', apiKey)

  const response = await fetch(`${geminiApiBaseUrl}/upload/v1beta/files?${searchParams.toString()}`, {
    method: 'PUT',
    headers: {
      'Content-Type': req.headers.get('Content-Type') as string,
      'Content-Range': req.headers.get('Content-Range') as string,
    },
    body: req.body,
  })
  return new NextResponse(response.body, response)
}
