'use client'
import { useState, useEffect } from 'react'
import type { UseMediaStreamResult } from '@/lib/multimodal-live/types'

export function useScreenCapture(): UseMediaStreamResult {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)

  const start = async () => {
    // const controller = new CaptureController();
    // controller.setFocusBehavior("no-focus-change");
    const mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'monitor',
      },
      // controller
    })
    setStream(mediaStream)
    setIsStreaming(true)
    return mediaStream
  }

  const stop = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      setStream(null)
      setIsStreaming(false)
    }
  }

  useEffect(() => {
    const handleStreamEnded = () => {
      setIsStreaming(false)
      setStream(null)
    }
    if (stream) {
      stream.addEventListener('removetrack', handleStreamEnded)
      stream.getTracks().forEach((track) => track.addEventListener('ended', handleStreamEnded))
      return () => {
        stream.removeEventListener('removetrack', handleStreamEnded)
        stream.getTracks().forEach((track) => track.removeEventListener('ended', handleStreamEnded))
      }
    }
  }, [stream])

  return {
    type: 'screen',
    start,
    stop,
    isStreaming,
    stream,
  }
}
