import EventEmitter from 'eventemitter3'
import { createWorketFromSrc } from './audioworklet-registry'
import { AudioRecordingWorklet } from './worklets/audio-processing'
import { VolMeterWorket } from './worklets/vol-meter'
import { audioContext } from './utils'

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
}

export class AudioRecorder extends EventEmitter {
  stream: MediaStream | undefined
  audioContext: AudioContext | undefined
  source: MediaStreamAudioSourceNode | undefined
  recording: boolean = false
  recordingWorklet: AudioWorkletNode | undefined
  vuWorklet: AudioWorkletNode | undefined

  private starting: Promise<void> | null = null

  constructor(public sampleRate = 16000) {
    super()
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Could not request user media')
    }

    this.starting = new Promise(async (resolve) => {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      this.audioContext = await audioContext({ sampleRate: this.sampleRate })
      this.source = this.audioContext.createMediaStreamSource(this.stream)

      const workletName = 'audio-recorder-worklet'
      await this.audioContext.audioWorklet.addModule(createWorketFromSrc(workletName, AudioRecordingWorklet))
      this.recordingWorklet = new AudioWorkletNode(this.audioContext, workletName)

      this.recordingWorklet.port.onmessage = async (ev: MessageEvent) => {
        // worklet processes recording floats and messages converted buffer
        const arrayBuffer = ev.data.data.int16arrayBuffer

        if (arrayBuffer) {
          const arrayBufferString = arrayBufferToBase64(arrayBuffer)
          this.emit('data', arrayBufferString)
        }
      }
      this.source.connect(this.recordingWorklet)

      // vu meter worklet
      const vuWorkletName = 'vu-meter'
      await this.audioContext.audioWorklet.addModule(createWorketFromSrc(vuWorkletName, VolMeterWorket))
      this.vuWorklet = new AudioWorkletNode(this.audioContext, vuWorkletName)
      this.vuWorklet.port.onmessage = (ev: MessageEvent) => {
        this.emit('volume', ev.data.volume)
      }

      this.source.connect(this.vuWorklet)
      this.recording = true
      resolve()
      this.starting = null
    })
  }

  stop() {
    // its plausible that stop would be called before start completes
    // such as if the websocket immediately hangs up
    const handleStop = () => {
      this.source?.disconnect()
      this.stream?.getTracks().forEach((track) => track.stop())
      this.stream = undefined
      this.recordingWorklet = undefined
      this.vuWorklet = undefined
    }
    if (this.starting) {
      this.starting.then(handleStop)
      return
    }
    handleStop()
  }
}
