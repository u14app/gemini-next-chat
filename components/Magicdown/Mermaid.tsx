import { useRef, useState, useCallback, memo, type ReactNode } from 'react'
import { Download, Eye } from 'lucide-react'
import Button from '@/components/Button'
import { convertSvgToImage } from '@/utils/common'
import { cn } from '@/utils'

type Props = {
  children: ReactNode
}

async function loadMermaid(element: HTMLElement) {
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false })
  mermaid
    .run({
      nodes: [element],
      suppressErrors: true,
    })
    .catch((e) => {
      console.error('[Mermaid]: ', e.message)
    })
}

function Mermaid({ children }: Props) {
  const mermaidContainerRef = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState<boolean>(false)

  const randerMermaid = useCallback(async () => {
    if (mermaidContainerRef.current) {
      await loadMermaid(mermaidContainerRef.current)
      setRendered(true)
    }
  }, [])

  const downloadMermaid = useCallback(() => {
    if (mermaidContainerRef.current) {
      convertSvgToImage(mermaidContainerRef.current.firstChild)
    }
  }, [])

  return (
    <div className="relative">
      <div className="absolute right-2 top-2 flex gap-1">
        {rendered ? (
          <Button
            className="h-6 w-6 opacity-80"
            variant="outline"
            title="Download"
            size="icon"
            onClick={() => downloadMermaid()}
          >
            <Download />
          </Button>
        ) : (
          <Button
            className="h-6 w-6 opacity-80"
            variant="outline"
            title="View"
            size="icon"
            onClick={() => randerMermaid()}
          >
            <Eye />
          </Button>
        )}
      </div>
      <div
        className={cn(
          'mermaid flex w-full overflow-auto rounded bg-[#f3f4f6] p-4 dark:bg-[rgb(15,23,42)]',
          rendered ? 'cursor-pointer justify-center' : '',
        )}
        ref={mermaidContainerRef}
      >
        {children}
      </div>
    </div>
  )
}

export default memo(Mermaid)
