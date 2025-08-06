import imageCompression from 'browser-image-compression'
import FileManager, { type FileManagerOptions } from '@/utils/FileManager'
import { encodeBase64 } from '@/utils/signature'
import { formatSize, readFileAsDataURL } from '@/utils/common'
import { isNull, isFunction, isString } from 'lodash-es'

type fileUploadOptions = {
  files: FileList | File[] | null
  uploadLimit: number
  fileManagerOptions: FileManagerOptions
  addAttachment: (fileInfor: FileInfor) => void
  updateAttachment: (id: string, fileInfor: FileInfor) => void
  onError?: (error: string) => void
}

type imageUploadOptions = {
  files: FileList | File[] | null
  addAttachment: (fileInfor: FileInfor) => void
  updateAttachment: (id: string, fileInfor: FileInfor) => void
  onError?: (error: string) => void
}

const compressionOptions = {
  maxSizeMB: 4,
  useWebWorker: true,
  initialQuality: 0.85,
  libURL: 'scripts/browser-image-compression.js',
}

export async function fileUpload({
  files,
  uploadLimit,
  fileManagerOptions,
  addAttachment,
  updateAttachment,
  onError,
}: fileUploadOptions) {
  if (isNull(files)) return false
  if (fileManagerOptions.token === '' || fileManagerOptions.apiKey === '') return false

  for await (const file of files) {
    if (uploadLimit > 0 && file.size > uploadLimit) {
      const errorMessage = `File size larger than ${formatSize(uploadLimit)} limit!`
      if (isFunction(onError)) onError(errorMessage)
      throw new Error(errorMessage)
    }
    const fileInfor: FileInfor = {
      id: encodeBase64(`${file.name}:${file.type}:${file.size}`),
      name: file.name,
      mimeType: file.type,
      size: file.size,
      status: 'PROCESSING',
    }
    let uploadFile: File
    if (file.type.startsWith('image/')) {
      const compressedFile = await imageCompression(file, compressionOptions)
      uploadFile = new File([compressedFile], file.name, { type: file.type })
      fileInfor.dataUrl = await imageCompression.getDataUrlFromFile(uploadFile)
      fileInfor.size = uploadFile.size
    } else {
      uploadFile = file
    }
    addAttachment(fileInfor)

    const checkFileStatus = async (fileMeta: FileMetadata) => {
      if (fileMeta.state === 'PROCESSING') {
        const task = async () => {
          const fileManager = new FileManager(fileManagerOptions)
          const fileMetadata: FileMetadata = await fileManager.getFileMetadata(fileMeta.name.substring(6))
          if (fileMetadata.state !== 'PROCESSING') {
            fileInfor.status = fileMetadata.state
            fileInfor.metadata = fileMetadata
            updateAttachment(fileInfor.id, fileInfor)
          } else {
            setTimeout(task, 2000)
          }
        }
        setTimeout(task, 2000)
      } else {
        fileInfor.status = fileMeta.state
        fileInfor.metadata = fileMeta
        updateAttachment(fileInfor.id, fileInfor)
      }
      return false
    }

    const fileManager = new FileManager(fileManagerOptions)
    if (uploadFile.size <= 2097152) {
      // If the file is smaller than 2MB, use DataUrl
      fileInfor.status = 'ACTIVE'
      if (!fileInfor.dataUrl) {
        fileInfor.dataUrl = await readFileAsDataURL(uploadFile)
      }
      updateAttachment(fileInfor.id, fileInfor)
    } else if (file.size <= 8388608) {
      // If the file is smaller than 8MB are uploaded directly
      fileManager
        .uploadFile(uploadFile)
        .then((fileMetadata) => {
          if (fileMetadata.file) {
            checkFileStatus(fileMetadata.file)
          } else {
            throw new Error('File upload fail')
          }
        })
        .catch((err: string) => {
          if (isFunction(onError)) {
            fileInfor.status = 'FAILED'
            updateAttachment(fileInfor.id, fileInfor)
            onError(isString(err) ? err : 'File upload fail')
          }
        })
    } else {
      fileManager
        .resumableUploadFile(uploadFile)
        .then((fileMetadata) => {
          if (fileMetadata.file) {
            checkFileStatus(fileMetadata.file)
          } else {
            throw new Error('File upload fail')
          }
        })
        .catch((err: string) => {
          if (isFunction(onError)) {
            fileInfor.status = 'FAILED'
            updateAttachment(fileInfor.id, fileInfor)
            onError(isString(err) ? err : 'File upload fail')
          }
        })
    }
  }
}

export async function imageUpload({ files, addAttachment, updateAttachment, onError }: imageUploadOptions) {
  if (isNull(files)) return false
  for await (const file of files) {
    const fileInfor: FileInfor = {
      id: encodeBase64(`${file.name}:${file.type}:${file.size}`),
      name: file.name,
      mimeType: file.type,
      size: file.size,
      status: 'PROCESSING',
    }
    addAttachment(fileInfor)
    const compressedFile = await imageCompression(file, compressionOptions).catch((err: string) => {
      if (isFunction(onError)) {
        fileInfor.status = 'FAILED'
        updateAttachment(fileInfor.id, fileInfor)
        onError(err)
      }
    })
    if (compressedFile) {
      fileInfor.dataUrl = await imageCompression.getDataUrlFromFile(compressedFile)
      fileInfor.size = compressedFile.size
      fileInfor.status = 'ACTIVE'
      updateAttachment(fileInfor.id, fileInfor)
    }
  }
}
