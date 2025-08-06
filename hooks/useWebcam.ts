'use client'
import { useState, useEffect } from 'react'
import type { UseMediaStreamResult } from '@/lib/multimodal-live/types'

export function useWebcam(): UseMediaStreamResult & {
  switchWebcam: () => Promise<MediaStream>
} {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentCameraIndex, setCurrentCameraIndex] = useState<number>(0)

  const start = async () => {
    const cameras = await getCameraDevices()
    const selectedCamera = cameras[currentCameraIndex]

    // Get a new video stream
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: selectedCamera.deviceId },
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

  // Get available camera devices
  const getCameraDevices = async (): Promise<MediaDeviceInfo[]> => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((device) => device.kind === 'videoinput')
  }

  // Switch Camera
  const switchWebcam = async () => {
    const cameras = await getCameraDevices()
    // Switch camera index
    const cameraIndex = (currentCameraIndex + 1) % cameras.length
    setCurrentCameraIndex(cameraIndex)

    const selectedCamera = cameras[cameraIndex]
    // Get a new video stream
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: selectedCamera.deviceId },
    })
    setStream(mediaStream)
    return mediaStream
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
    type: 'webcam',
    start,
    stop,
    switchWebcam,
    isStreaming,
    stream,
  }
}
