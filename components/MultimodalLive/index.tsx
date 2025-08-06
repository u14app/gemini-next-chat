'use client'
import dynamic from 'next/dynamic'
import { ReactNode, useState, useEffect, useRef, useMemo, useLayoutEffect, memo } from 'react'
import {
  Mic,
  MicOff,
  ScreenShare,
  ScreenShareOff,
  Video,
  VideoOff,
  AudioLines,
  X,
  SwitchCamera,
  LogOut,
  Settings,
} from 'lucide-react'
import SiriWave from 'siriwave'
import { Button } from '@/components/ui/button'
import { useMultimodalLive } from '@/hooks/useMultimodalLive'
import { useScreenCapture } from '@/hooks/useScreenCapture'
import { useWebcam } from '@/hooks/useWebcam'
import { AudioRecorder } from '@/lib/multimodal-live/audio-recorder'
import type { UseMediaStreamResult, ServerContent } from '@/lib/multimodal-live/types'
import { useMultimodalLiveStore } from '@/store/multimodal'
import { useMessageStore } from '@/store/chat'
import { useSettingStore } from '@/store/setting'
import { getMultimodalLivePrompt, getClientContentPrompt } from '@/utils/prompt'
import { cn } from '@/utils'

type Props = {
  onClose: () => void
}

type MediaStreamButtonProps = {
  isStreaming: boolean
  onIcon: ReactNode
  offIcon: ReactNode
  start: () => Promise<any>
  stop: () => any
}

const Setting = dynamic(() => import('./Setting'))
const SystemInstruction = dynamic(() => import('@/components/SystemInstruction'))

/**
 * button used for triggering webcam or screen-capture
 */
function MediaStreamButton({ isStreaming, onIcon, offIcon, start, stop }: MediaStreamButtonProps) {
  return isStreaming ? (
    <Button
      className="h-12 w-12 rounded-full opacity-100 transition-all duration-200 ease-in [&_svg]:size-6"
      onClick={stop}
      size="icon"
      variant="outline"
    >
      {onIcon}
    </Button>
  ) : (
    <Button
      className="h-12 w-12 rounded-full opacity-30 transition-all duration-200 ease-in [&_svg]:size-6"
      onClick={start}
      size="icon"
      variant="outline"
    >
      {offIcon}
    </Button>
  )
}

function MultimodalLive({ onClose }: Props) {
  const {
    update: updateMultimodalLiveState,
    isVideoStreaming,
    apiKey,
    apiProxy,
    voiceName,
    responseModalities,
  } = useMultimodalLiveStore()
  const { apiKey: globalApiKey, model } = useSettingStore()
  const { systemInstruction, instruction } = useMessageStore()
  const { client, connected, setConfig, connect, disconnect } = useMultimodalLive({
    url: `${apiProxy || 'wss://generativelanguage.googleapis.com'}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`,
    apiKey: apiKey || globalApiKey,
  })
  const videoRef = useRef<HTMLVideoElement>(null)
  const renderCanvasRef = useRef<HTMLCanvasElement>(null)
  const siriWaveRef = useRef<HTMLDivElement>(null)
  const webcam = useWebcam()
  const screenCapture = useScreenCapture()
  const [activeVideoStream, setActiveVideoStream] = useState<MediaStream | null>(null)
  const [subtitle, setSubtitle] = useState<string>('')
  const [muted, setMuted] = useState(false)
  const [supportsVideo, setSupportsVideo] = useState<boolean>(true)
  const [supportsScreenCapture, setSupportsScreenCapture] = useState<boolean>(true)
  const [openSetting, setOpenSetting] = useState(false)

  const audioRecorder = useMemo(() => new AudioRecorder(), [])
  const videoStreams = useMemo(() => [webcam, screenCapture], [webcam, screenCapture])

  //handler for swapping from one video-stream to the next
  const changeStreams = (next?: UseMediaStreamResult) => async () => {
    if (next) {
      const mediaStream = await next.start()
      setActiveVideoStream(mediaStream)
      updateMultimodalLiveState({ isVideoStreaming: true })
    } else {
      setActiveVideoStream(null)
      updateMultimodalLiveState({ isVideoStreaming: false })
    }

    videoStreams.filter((msr) => msr !== next).forEach((msr) => msr.stop())
  }

  const switchWebcam = async () => {
    const mediaStream = await webcam.switchWebcam()
    setActiveVideoStream(mediaStream)
    updateMultimodalLiveState({ isVideoStreaming: true })
  }

  const close = () => {
    disconnect()
    updateMultimodalLiveState({ isVideoStreaming: false })
    // close streams
    changeStreams()
  }

  const handleConnect = () => {
    const { apiKey } = useMultimodalLiveStore.getState()
    const { apiKey: globalApiKey } = useSettingStore.getState()
    if (apiKey || globalApiKey) {
      connect()
    } else {
      setOpenSetting(true)
    }
  }

  useEffect(() => {
    const onData = (base64: string) => {
      client.sendRealtimeInput([
        {
          mimeType: 'audio/pcm;rate=16000',
          data: base64,
        },
      ])
    }
    if (connected && !muted && audioRecorder) {
      audioRecorder.addListener('data', onData).start()
    } else {
      audioRecorder.stop()
    }
    return () => {
      audioRecorder.removeListener('data', onData)
    }
  }, [connected, client, muted, audioRecorder])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = activeVideoStream
    }

    let timeoutId = -1

    function sendVideoFrame() {
      const renderCanvas = renderCanvasRef.current

      if (!renderCanvas || !videoRef.current) {
        return
      }

      const ctx = renderCanvas.getContext('2d')!
      renderCanvas.width = videoRef.current.videoWidth * 0.25
      renderCanvas.height = videoRef.current.videoHeight * 0.25
      if (renderCanvas.width + renderCanvas.height > 0) {
        // Draw the video screen to canvas
        ctx.drawImage(videoRef.current, 0, 0, renderCanvas.width, renderCanvas.height)
        const base64 = renderCanvas.toDataURL('image/jpeg', 1.0)
        const data = base64.slice(base64.indexOf(',') + 1, Infinity)
        client.sendRealtimeInput([{ mimeType: 'image/jpeg', data }])
      }
      if (connected) {
        timeoutId = window.setTimeout(sendVideoFrame, 1000 / 0.5)
      }
    }
    if (connected && activeVideoStream !== null) {
      requestAnimationFrame(sendVideoFrame)
    }
    return () => {
      clearTimeout(timeoutId)
    }
  }, [connected, activeVideoStream, client, videoRef])

  useEffect(() => {
    let siriWave: SiriWave
    const { systemInstruction } = useMessageStore.getState()

    const initSiriWave = () => {
      siriWave = new SiriWave({
        container: siriWaveRef.current!,
        style: 'ios9',
        speed: 0.04,
        amplitude: 0.1,
        width: window.innerWidth,
        height: window.innerHeight / 5,
      })
    }
    const resetSiriWave = () => {
      siriWave?.dispose()
      initSiriWave()
    }
    initSiriWave()

    setConfig({
      model: `models/${model}`,
      tools: [{ googleSearch: {} }],
      generationConfig: {
        responseModalities: [responseModalities],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
      },
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
    })

    const onSetupComplete = () => {
      const { messages } = useMessageStore.getState()
      client.send({ text: messages.length > 0 ? getClientContentPrompt(messages) : 'Hello' })
    }

    const onAudio = () => {
      if (siriWave) {
        const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)
        siriWave.setSpeed(isSafari ? 0.1 : 0.05)
        siriWave.setAmplitude(2)
      }
    }

    let timeoutId = -1
    const onContent = (data: ServerContent) => {
      if ('modelTurn' in data) {
        const texts = []
        for (const part of data.modelTurn.parts) {
          if (part.text) texts.push(part.text)
        }
        clearTimeout(timeoutId)
        setSubtitle(texts.join('\n\n'))
      }
    }

    const onTurncomplete = () => {
      if (siriWave) {
        siriWave.setSpeed(0.04)
        siriWave.setAmplitude(0.1)
      }
      timeoutId = window.setTimeout(() => {
        setSubtitle('')
      }, 1500)
    }

    const onClose = () => {
      onTurncomplete()
    }

    window.addEventListener('resize', resetSiriWave)
    client.addListener('setupcomplete', onSetupComplete)
    client.addListener('audio', onAudio)
    client.addListener('content', onContent)
    client.addListener('turncomplete', onTurncomplete)
    client.addListener('close', onClose)
    return () => {
      siriWave?.dispose()
      client.removeListener('close', onClose)
      client.removeListener('turncomplete', onTurncomplete)
      client.removeListener('content', onContent)
      client.removeListener('audio', onAudio)
      client.removeListener('setupcomplete', onSetupComplete)
      window.removeEventListener('resize', resetSiriWave)
    }
  }, [client, setConfig, voiceName, model, responseModalities])

  useEffect(() => {
    const defaultRoleSetting = getMultimodalLivePrompt(voiceName)

    if (!systemInstruction) {
      instruction(defaultRoleSetting)
    }
    return () => {
      if (systemInstruction === defaultRoleSetting) {
        instruction('')
      }
    }
  }, [systemInstruction, instruction, voiceName])

  useLayoutEffect(() => {
    setSupportsVideo('getUserMedia' in navigator.mediaDevices)
    setSupportsScreenCapture('getDisplayMedia' in navigator.mediaDevices)
  }, [])

  return (
    <div className="fixed left-0 right-0 top-0 z-50 flex h-full w-screen flex-col bg-slate-900">
      <div className="items-top relative h-full w-full justify-center">
        <div className={cn('mx-auto h-full w-full max-w-screen-sm', { hidden: connected })}>
          <SystemInstruction className="relative top-1/2 mx-4 -translate-y-1/2" maxHeight="300px" closeable={false} />
        </div>

        <video
          className={cn('absolute h-full w-full flex-grow object-cover transition-all duration-300', {
            hidden: !videoRef.current || !isVideoStreaming,
          })}
          ref={videoRef}
          autoPlay
          playsInline
        />
        <canvas className="hidden" ref={renderCanvasRef} />

        <div
          className={cn('fixed left-1/2 top-[30%] flex -translate-x-1/2 flex-col items-center', {
            hidden: isVideoStreaming,
          })}
        >
          <div className={cn('mt-16 h-8 items-center justify-center', { hidden: !connected })}>
            <div className={cn('h-1/5 w-full', { hidden: responseModalities === 'Text' })} ref={siriWaveRef}></div>
            <div className="whitespace-pre-wrap text-center text-red-300">{subtitle}</div>
          </div>
        </div>

        <section
          className="absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center"
          style={{ bottom: 'var(--safe-area-inset-bottom)' }}
        >
          <div className={cn('absolute bottom-12 flex items-center justify-center gap-6', { hidden: connected })}>
            <Button
              className="h-10 w-10 rounded-full text-slate-700 dark:text-slate-500 [&_svg]:size-5"
              variant="secondary"
              size="icon"
              onClick={() => setOpenSetting(true)}
            >
              <Settings />
            </Button>
            <Button
              className="h-14 w-14 rounded-full bg-green-500 text-white hover:bg-green-600 active:bg-green-700 [&_svg]:size-7"
              size="icon"
              onClick={() => handleConnect()}
            >
              <AudioLines />
            </Button>
            <Button
              className="h-10 w-10 rounded-full text-slate-700 dark:text-slate-500 [&_svg]:size-5"
              variant="secondary"
              size="icon"
              onClick={() => onClose()}
            >
              <LogOut />
            </Button>
          </div>

          <div
            className={cn('flex w-full max-w-[360px] flex-col items-center justify-between gap-2 p-4 pb-12 pt-4', {
              invisible: !connected,
            })}
          >
            <nav className="mx-auto inline-flex gap-3">
              <Button
                className={cn(
                  muted ? 'opacity-30' : 'opacity-100',
                  'h-12 w-12 rounded-full transition-all duration-200 ease-in [&_svg]:size-6',
                )}
                variant="outline"
                onClick={() => setMuted(!muted)}
                size="icon"
              >
                {!muted ? <Mic /> : <MicOff />}
              </Button>

              {supportsVideo && (
                <>
                  <MediaStreamButton
                    isStreaming={webcam.isStreaming}
                    start={changeStreams(webcam)}
                    stop={changeStreams()}
                    onIcon={<VideoOff />}
                    offIcon={<Video />}
                  />
                  {supportsScreenCapture ? (
                    <MediaStreamButton
                      isStreaming={screenCapture.isStreaming}
                      start={changeStreams(screenCapture)}
                      stop={changeStreams()}
                      onIcon={<ScreenShareOff />}
                      offIcon={<ScreenShare />}
                    />
                  ) : (
                    <Button
                      className={cn(
                        webcam.isStreaming ? 'opacity-100' : 'opacity-30',
                        'h-12 w-12 rounded-full transition-all duration-200 ease-in [&_svg]:size-6',
                      )}
                      variant="outline"
                      size="icon"
                      onClick={() => switchWebcam()}
                    >
                      <SwitchCamera />
                    </Button>
                  )}
                </>
              )}

              <Button
                className="h-12 w-12 rounded-full bg-red-500 hover:bg-red-600 active:bg-red-700 [&_svg]:size-6"
                size="icon"
                onClick={() => close()}
              >
                <X />
              </Button>
            </nav>
          </div>
        </section>
      </div>
      <Setting open={openSetting} onClose={() => setOpenSetting(false)} />
    </div>
  )
}

export default memo(MultimodalLive)
