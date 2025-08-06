/**
 * A registry to map attached worklets by their audio-context
 * any module using `audioContext.audioWorklet.addModule(` should register the worklet here
 */
export type WorkletGraph = {
  node?: AudioWorkletNode
  handlers: Array<(this: MessagePort, ev: MessageEvent) => any>
}

export const registeredWorklets: Map<AudioContext, Record<string, WorkletGraph>> = new Map()

export const createWorketFromSrc = (workletName: string, workletSrc: string) => {
  const script = new Blob([`registerProcessor("${workletName}", ${workletSrc})`], {
    type: 'application/javascript',
  })

  return URL.createObjectURL(script)
}
