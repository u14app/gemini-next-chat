import { useRef, useState, useEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Mic, Settings, LogOut } from 'lucide-react'
import SiriWave from 'siriwave'
import Button from '@/components/Button'
import { formatTime } from '@/utils/common'

type Props = {
  status: 'thinkng' | 'silence' | 'talking'
  content: string
  subtitle: string
  errorMessage?: string
  recordTime: number
  isRecording: boolean
  onRecorder: () => void
  onStop: () => void
  onClose?: () => void
  openSetting?: () => void
}

function noop() {}

function TalkWithVoice({
  status = 'silence',
  content,
  subtitle,
  errorMessage,
  recordTime,
  isRecording,
  onRecorder,
  onStop,
  onClose = noop,
  openSetting = noop,
}: Props) {
  const { t } = useTranslation()
  const siriWaveRef = useRef<HTMLDivElement>(null)
  const [siriWave, setSiriWave] = useState<SiriWave>()

  useEffect(() => {
    let instance: SiriWave
    const initSiriWave = () => {
      instance = new SiriWave({
        container: siriWaveRef.current!,
        style: 'ios9',
        speed: 0.04,
        amplitude: 0.1,
        width: window.innerWidth,
        height: window.innerHeight / 5,
      })
      setSiriWave(instance)
    }
    const resetSiriWave = () => {
      instance?.dispose()
      initSiriWave()
    }
    initSiriWave()
    window.addEventListener('resize', resetSiriWave)
    return () => {
      instance?.dispose()
      window.removeEventListener('resize', resetSiriWave)
    }
  }, [])

  useEffect(() => {
    if (siriWave) {
      if (status === 'talking') {
        const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)
        siriWave.setSpeed(isSafari ? 0.1 : 0.05)
        siriWave.setAmplitude(2)
      } else if (status === 'silence') {
        siriWave.setSpeed(0.04)
        siriWave.setAmplitude(0.1)
      }
    }
  }, [status, siriWave])

  return (
    <div>
      <div className="fixed left-0 right-0 top-0 z-50 flex h-full w-screen flex-col items-center justify-center bg-slate-900">
        <div className="h-1/5 w-full" ref={siriWaveRef}></div>
        <div className="absolute bottom-0 flex h-2/5 w-2/3 flex-col justify-between pb-12 text-center">
          <div className="text-sm leading-6">
            <div className="animate-pulse text-lg text-white">{status === 'thinkng' ? t('status.thinking') : ''}</div>
            {errorMessage !== '' ? (
              <div className="whitespace-pre-wrap text-center font-semibold text-red-500">{errorMessage}</div>
            ) : status === 'talking' ? (
              <div className="whitespace-pre-wrap text-center text-red-300">{subtitle}</div>
            ) : (
              <div className="whitespace-pre-wrap text-center text-green-300">{content}</div>
            )}
          </div>
          <div className="flex items-center justify-center pt-2">
            <Button
              className="h-10 w-10 rounded-full text-slate-700 dark:text-slate-500 [&_svg]:size-5"
              title={t('setting')}
              variant="secondary"
              size="icon"
              onClick={() => openSetting()}
            >
              <Settings />
            </Button>
            {status === 'talking' ? (
              <Button
                className="mx-6 h-14 w-14 rounded-full [&_svg]:size-8"
                title={t('stopTalking')}
                variant="destructive"
                size="icon"
                onClick={() => onStop()}
              >
                <Pause />
              </Button>
            ) : (
              <Button
                className="mx-6 h-14 w-14 rounded-full font-mono [&_svg]:size-8"
                title={t('startRecording')}
                variant="destructive"
                size="icon"
                disabled={status === 'thinkng'}
                onClick={() => onRecorder()}
              >
                {isRecording ? formatTime(recordTime) : <Mic className="h-8 w-8" />}
              </Button>
            )}
            <Button
              className="h-10 w-10 rounded-full text-slate-700 dark:text-slate-500 [&_svg]:size-5"
              title={t('exit')}
              variant="secondary"
              size="icon"
              onClick={() => {
                onStop()
                onClose()
              }}
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(TalkWithVoice)
