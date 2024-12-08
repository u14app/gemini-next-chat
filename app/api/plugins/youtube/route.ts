import { NextResponse, type NextRequest } from 'next/server'
import { ErrorType } from '@/constant/errors'
import { handleError } from '../../utils'
import { scrapeYouTube } from 'scrape-youtube'

export const preferredRegion = ['sfo1']

export async function POST(req: NextRequest) {
  const { body } = await req.json()
  const { query = '' } = body

  if (query === '') {
    return NextResponse.json({ code: 40001, message: ErrorType.MissingParam }, { status: 400 })
  }

  try {
    const videos = await scrapeYouTube.search(query, {
      limit: 12,
      type: 'video'
    })

    // Transform to match our expected format
    const response = {
      items: videos.map(video => ({
        id: { videoId: video.id },
        snippet: {
          title: video.title,
          description: video.description,
          channelTitle: video.channel.name,
          thumbnails: {
            medium: {
              url: video.thumbnail
            }
          }
        }
      }))
    }

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof Error) {
      return handleError(error.message)
    }
  }
}
