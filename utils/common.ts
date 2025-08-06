import LanguageDetector from 'i18next-browser-languagedetector'
import locales from '@/constant/locales'

export function detectLanguage() {
  const languageDetector = new LanguageDetector()
  languageDetector.init()
  const detectedLang = languageDetector.detect()
  let lang: string = 'en-US'
  const localeLang = Object.keys(locales)
  if (Array.isArray(detectedLang)) {
    detectedLang.reverse().forEach((langCode) => {
      if (localeLang.includes(langCode)) {
        lang = langCode
      }
    })
  } else if (typeof detectedLang === 'string') {
    if (localeLang.includes(detectedLang)) {
      lang = detectedLang
    }
  }
  return lang
}

export function shuffleArray<T>(array: T[]): T[] {
  const newArray = array.slice() // Create a copy of the original array

  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)) // Randomly generate an integer between 0 and i
    // Swap the values of newArray[i] and newArray[j]
    ;[newArray[i], newArray[j]] = [newArray[j], newArray[i]]
  }

  return newArray
}

export function formatTime(seconds: number): string {
  if (seconds < 0) return `--:--`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  const minutesStr = minutes.toString().padStart(2, '0')
  const secondsStr = remainingSeconds.toString().padStart(2, '0')

  return `${minutesStr}:${secondsStr}`
}

export async function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.addEventListener('load', () => resolve(reader.result as string))
    reader.addEventListener('error', reject)
  })
}

export function formatSize(size: number, pointLength = 2, units?: string[]): string {
  if (typeof size === 'undefined') return '0'
  if (typeof units === 'undefined') units = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  let unit
  while ((unit = units.shift() as string) && size >= 1024) size = size / 1024
  return (unit === units[0] ? size : size.toFixed(pointLength === undefined ? 2 : pointLength)) + unit
}

export function sentenceSegmentation(content: string, locale: string) {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' })
  const segments = segmenter.segment(content)
  return Array.from(segments).map((item) => item.segment)
}

export function isBase64(str: string) {
  if (str.startsWith('data:') && str.indexOf('base64') !== -1) {
    return true
  } else {
    return false
  }
}

export function base64ToBlob(base64String: string, contentType: string = ''): Blob {
  const byteCharacters = atob(base64String)
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }
  const byteArray = new Uint8Array(byteNumbers)
  return new Blob([byteArray], { type: contentType })
}

export function downloadFile(content: string, filename: string, fileType: string) {
  // Prepending a BOM sequence at the beginning of the text file to encoded as UTF-8.
  const BOM = new Uint8Array([0xef, 0xbb, 0xbf])
  const blob = new Blob([BOM, content], { type: fileType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function hasUploadFiles(messages: Message[] = []): boolean {
  return messages.some((message) => message.parts.some((part) => part.fileData))
}

export function getRandomKey(apiKey: string, useUploadKey = false): string {
  const apiKeyList = apiKey.split(',')
  if (apiKeyList[0].startsWith('AI') && apiKeyList[0].length === 39) {
    if (apiKeyList.length === 1) return apiKeyList[0]
    return useUploadKey ? apiKeyList[0] : shuffleArray(apiKeyList)[0]
  } else {
    return apiKey
  }
}

export function convertSvgToImage(svg: ChildNode | null) {
  if (svg) {
    const text = new XMLSerializer().serializeToString(svg)
    return downloadFile(text, 'Mermaid', 'image/svg+xml')
  }
}

export function isOfficeFile(mimeType: string) {
  const officeFileTypes = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    odt: 'application/vnd.oasis.opendocument.text',
    odp: 'application/vnd.oasis.opendocument.presentation',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
  }
  return Object.values(officeFileTypes).includes(mimeType)
}

export function isFullGemini2FlashModel(model: string) {
  return model.startsWith('gemini-2.0-flash') && !model.includes('lite') && !model.includes('thinking')
}
