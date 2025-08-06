'use client'
import { useRef, useMemo, memo, useCallback } from 'react'
import { Paperclip, ImagePlus } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import type { FileManagerOptions } from '@/utils/FileManager'
import { encodeToken } from '@/utils/signature'
import { fileUpload, imageUpload } from '@/utils/upload'
import { isOfficeFile } from '@/utils/common'
import { useSettingStore, useEnvStore } from '@/store/setting'
import { useAttachmentStore } from '@/store/attachment'
import { GEMINI_API_BASE_URL } from '@/constant/urls'
import { OldVisionModel } from '@/constant/model'
import mimeType, { imageMimeType } from '@/constant/attachment'
import { isFunction } from 'lodash-es'

type Props = {
  beforeUpload?: () => void
  afterUpload?: () => void
}

function FileUploader({ beforeUpload, afterUpload }: Props) {
  const { toast } = useToast()
  const attachmentRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const settingStore = useSettingStore()
  const isOldVisionModel = useMemo(() => {
    return OldVisionModel.includes(settingStore.model)
  }, [settingStore.model])

  const handleError = useCallback(
    (err: string) => {
      toast({ description: err })
    },
    [toast],
  )

  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (isFunction(beforeUpload)) beforeUpload()

      const { apiKey, apiProxy, password } = useSettingStore.getState()
      const { uploadLimit } = useEnvStore.getState()
      const options: FileManagerOptions =
        apiKey !== '' ? { apiKey, baseUrl: apiProxy || GEMINI_API_BASE_URL } : { token: encodeToken(password) }
      const { add: addAttachment, update: updateAttachment } = useAttachmentStore.getState()

      const fileList: File[] = []
      if (files) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          if (mimeType.includes(file.type)) {
            if (isOfficeFile(file.type)) {
              const { parseOffice } = await import('@/utils/officeParser')
              const newFile = await parseOffice(file, { type: 'file' })
              if (newFile instanceof File) fileList.push(newFile)
            } else {
              fileList.push(file)
            }
          } else if (file.type.startsWith('text/')) {
            fileList.push(file)
          }
        }
      }

      await fileUpload({
        files: fileList,
        uploadLimit,
        fileManagerOptions: options,
        addAttachment,
        updateAttachment,
        onError: handleError,
      })

      if (attachmentRef.current && attachmentRef.current.value) {
        attachmentRef.current.value = ''
      }

      if (isFunction(afterUpload)) afterUpload()
    },
    [handleError, beforeUpload, afterUpload],
  )

  const handleImageUpload = useCallback(
    async (files: FileList | null) => {
      if (isFunction(beforeUpload)) beforeUpload()

      const { add: addAttachment, update: updateAttachment } = useAttachmentStore.getState()

      await imageUpload({ files, addAttachment, updateAttachment, onError: handleError })

      if (imageRef.current && imageRef.current.value) {
        imageRef.current.value = ''
      }

      if (isFunction(afterUpload)) afterUpload()
    },
    [handleError, beforeUpload, afterUpload],
  )

  return (
    <>
      <input
        ref={attachmentRef}
        type="file"
        accept={mimeType.join(',')}
        multiple
        hidden
        onChange={(ev) => handleFileUpload(ev.target.files)}
      />
      <input
        ref={imageRef}
        type="file"
        accept={imageMimeType.join(',')}
        multiple
        hidden
        onChange={(ev) => handleImageUpload(ev.target.files)}
      />
      {isOldVisionModel ? (
        <ImagePlus onClick={() => imageRef.current?.click()} />
      ) : (
        <Paperclip onClick={() => attachmentRef.current?.click()} />
      )}
    </>
  )
}

export default memo(FileUploader)
