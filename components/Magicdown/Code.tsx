import { useState, useRef, useEffect, type ReactNode, memo } from 'react'
import { useTranslation } from 'react-i18next'
import copy from 'copy-to-clipboard'
import { Copy, CopyCheck, ChevronUp, ChevronDown } from 'lucide-react'
import Button from '@/components/Button'
import { langAlias } from '@/constant/highlight'
import { useIsMobile } from '@/hooks/use-mobile'
import { clsx } from 'clsx'
import { capitalize, get } from 'lodash-es'

import './highlight.css'

type Props = {
  children: ReactNode
  lang: string
}

function getLangAlias(lang: string): string {
  return get(langAlias, lang, capitalize(lang)) || ''
}

function Code({ children, lang }: Props) {
  const { t } = useTranslation()
  const codeWrapperRef = useRef<HTMLDivElement>(null)
  const [waitingCopy, setWaitingCopy] = useState<boolean>(false)
  const [collapsible, setCollapsible] = useState<boolean>(false)
  const [isCollapse, setIsCollapse] = useState<boolean>(false)
  const isMobile = useIsMobile(450)

  const handleCopy = () => {
    if (codeWrapperRef.current) {
      setWaitingCopy(true)
      copy(codeWrapperRef.current.innerText)
      setTimeout(() => {
        setWaitingCopy(false)
      }, 1200)
    }
  }

  useEffect(() => {
    if (codeWrapperRef.current && codeWrapperRef.current.clientHeight > 160) {
      setCollapsible(true)
      if (isMobile) setIsCollapse(true)
    }
  }, [isMobile])

  return (
    <>
      <div className="flex h-10 w-full items-center justify-between overflow-x-auto break-all rounded-t bg-gray-200 pl-4 pr-3 text-sm text-slate-500 dark:bg-[rgb(31,41,55)]">
        {lang ? <span title={lang}>{getLangAlias(lang)}</span> : <span></span>}
        <div className="flex gap-1">
          <Button
            className="h-6 w-6 rounded-sm p-1 dark:hover:bg-slate-900/80"
            variant="ghost"
            title={t('copy')}
            onClick={() => handleCopy()}
          >
            {waitingCopy ? <CopyCheck className="h-full w-full text-green-500" /> : <Copy className="h-full w-full" />}
          </Button>
          {collapsible ? (
            <Button
              className="h-6 w-6 rounded-sm p-1 dark:hover:bg-slate-900/80"
              variant="ghost"
              title={isCollapse ? 'Expand' : 'Collapse'}
              onClick={() => setIsCollapse(!isCollapse)}
            >
              {isCollapse ? (
                <ChevronDown className="h-full w-full text-green-500" />
              ) : (
                <ChevronUp className="h-full w-full" />
              )}
            </Button>
          ) : null}
        </div>
      </div>
      <div ref={codeWrapperRef} className={clsx('overflow-auto rounded-b', isCollapse ? 'h-40' : 'h-auto')}>
        {children}
      </div>
    </>
  )
}

export default memo(Code)
