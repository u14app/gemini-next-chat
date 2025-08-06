export const imageMimeType = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']

export const audioMimeType = ['audio/wav', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac']

export const videoMimeType = [
  'video/mp4',
  'video/mpeg',
  'video/mov',
  'video/avi',
  'video/x-flv',
  'video/mpg',
  'video/webm',
  'video/wmv',
  'video/3gpp',
]

export const textMimeType = [
  'application/x-javascript', // .js
  'application/x-typescript', // .ts
  'application/x-python-code', // .py
  'application/json', // .json
  'application/rtf', // .rtf
  'application/pdf', // .pdf
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.oasis.opendocument.text', // .odt
  'application/vnd.oasis.opendocument.presentation', // .odp
  'application/vnd.oasis.opendocument.spreadsheet', // .ods
  'text/plain',
  'text/html',
  'text/css',
  'text/md',
  'text/csv',
  'text/xml',
  'text/rtf',
  'text/javascript',
  'text/x-python',
  'text/*',
]

export default [imageMimeType, audioMimeType, videoMimeType, textMimeType].flat()
