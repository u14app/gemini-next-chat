'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MultimodalLiveClient, AudioStreamer, VolMeterWorket } from '@/lib/multimodal-live'
import type { LiveConfig, MultimodalLiveAPIClientConnection } from '@/lib/multimodal-live/types'
import { audioContext } from '@/lib/multimodal-live/utils'

export type MultimodalLiveAPIResults = {
  client: MultimodalLiveClient
  setConfig: (config: LiveConfig) => void
  config: LiveConfig
  connected: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  volume: number
}

export function useMultimodalLive({ url, apiKey, model }: MultimodalLiveAPIClientConnection): MultimodalLiveAPIResults {
  const audioStreamerRef = useRef<AudioStreamer | null>(null)
  const [connected, setConnected] = useState(false)
  const [config, setConfig] = useState<LiveConfig>({
    model: `models/${model || 'gemini-2.0-flash-exp'}`,
  })
  const [volume, setVolume] = useState(0)

  const client = useMemo(() => new MultimodalLiveClient({ url, apiKey, model }), [url, apiKey, model])

  const connect = async () => {
    if (!config) {
      throw new Error('config has not been set')
    }
    client.disconnect()
    await client.connect(config)
    setConnected(true)
  }

  const disconnect = async () => {
    client.disconnect()
    setConnected(false)
  }

  // register audio for streaming server -> speakers
  useEffect(() => {
    if (!audioStreamerRef.current) {
      audioContext({ id: 'audio-out' }).then((audioCtx: AudioContext) => {
        audioStreamerRef.current = new AudioStreamer(audioCtx)
        audioStreamerRef.current.addWorklet('vumeter-out', VolMeterWorket, (ev) => {
          setVolume(ev.data.volume)
        })
      })
    }
    return () => {
      setVolume(0)
    }
  }, [audioStreamerRef])

  useEffect(() => {
    const onClose = () => {
      setConnected(false)
    }

    const stopAudioStreamer = () => audioStreamerRef.current?.stop()

    const onAudio = (data: ArrayBuffer) => audioStreamerRef.current?.addPCM16(new Uint8Array(data))

    client.addListener('close', onClose)
    client.addListener('interrupted', stopAudioStreamer)
    client.addListener('audio', onAudio)

    return () => {
      client.removeListener('close', onClose)
      client.removeListener('interrupted', stopAudioStreamer)
      client.removeListener('audio', onAudio)
    }
  }, [client])

  return {
    client,
    config,
    setConfig,
    connected,
    connect,
    disconnect,
    volume,
  }
}
