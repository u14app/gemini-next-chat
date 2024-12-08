'use client'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, ChevronRight } from 'lucide-react'
import ResponsiveDialog from '@/components/ResponsiveDialog'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Props = {
  data: YoutubeResult['data']
}

function Youtube(props: Props) {
  const { data } = props
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState<boolean>(false)

  if (!data?.items) return null

  return (
    <>
      <div className="chat-content overflow-x-auto scroll-smooth">
        <div className="flex gap-1.5 max-md:gap-1">
          {data.items.slice(0, 4).map((item) => (
            <a
              key={item.id.videoId}
              href={`https://www.youtube.com/watch?v=${item.id.videoId}`}
              target="_blank"
            >
              <Card className="w-40 flex-1 hover:bg-gray-50 hover:dark:bg-gray-900">
                <CardHeader className="p-2 pb-0">
                  <CardTitle className="truncate text-sm text-blue-500" title={item.snippet.title}>
                    {item.snippet.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-2">
                  <div className="relative aspect-video w-full overflow-hidden rounded-sm">
                    <img
                      src={item.snippet.thumbnails.medium.url}
                      alt={item.snippet.title}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Play className="h-6 w-6 text-white" />
                    </div>
                  </div>
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {item.snippet.channelTitle}
                  </p>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
        {data.items.length > 4 && (
          <button
            className="mt-2 flex items-center gap-1 text-xs text-blue-500"
            onClick={() => setDialogOpen(true)}
          >
            {t('showMore')}
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>

      <ResponsiveDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <ScrollArea className="h-[calc(100vh-8rem)] pr-4">
          <div className="grid grid-cols-2 gap-4 pb-4 md:grid-cols-3 lg:grid-cols-4">
            {data.items.map((item) => (
              <a
                key={item.id.videoId}
                href={`https://www.youtube.com/watch?v=${item.id.videoId}`}
                target="_blank"
              >
                <Card className="hover:bg-gray-50 hover:dark:bg-gray-900">
                  <CardHeader className="p-2 pb-0">
                    <CardTitle className="truncate text-sm text-blue-500" title={item.snippet.title}>
                      {item.snippet.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-2">
                    <div className="relative aspect-video w-full overflow-hidden rounded-sm">
                      <img
                        src={item.snippet.thumbnails.medium.url}
                        alt={item.snippet.title}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <Play className="h-8 w-8 text-white" />
                      </div>
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-500">
                      {item.snippet.channelTitle}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{item.snippet.description}</p>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
          <ScrollBar orientation="vertical" />
        </ScrollArea>
      </ResponsiveDialog>
    </>
  )
}

export default memo(Youtube)
