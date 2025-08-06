'use client'
import { useState, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import Lightbox from 'yet-another-react-lightbox'
import LightboxFullscreen from 'yet-another-react-lightbox/plugins/fullscreen'
import LightboxDownload from 'yet-another-react-lightbox/plugins/download'
import { type GeneratedImage } from '@/utils/generateImages'
import { isEmpty } from 'lodash-es'

import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/captions.css'

type Props = {
  data: GeneratedImage[]
}

function Imagen(props: Props) {
  const { data = [] } = props
  const [showLightbox, setShowLightbox] = useState<boolean>(false)
  const [lightboxIndex, setLightboxIndex] = useState<number>(0)

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index)
    setShowLightbox(true)
  }, [])

  if (isEmpty(data)) return null

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {data.map((item, idx) => {
          return (
            <div key={idx} className="group/imagen relative h-40 w-40 max-sm:h-36 max-sm:w-36">
              <picture>
                <source srcSet={item.imageBytes} type="image/jpeg" />
                <img
                  className="h-full w-full rounded-sm object-cover"
                  src={item.imageBytes}
                  alt={`image-${idx + 1}`}
                  onClick={() => openLightbox(idx)}
                />
              </picture>
              <a
                className="absolute bottom-2 right-2 cursor-pointer rounded-full bg-white/20 p-1 text-white opacity-0 hover:bg-white/40 group-hover/imagen:opacity-100"
                href={item.imageBytes}
                download
                target="_blank"
              >
                <Download className="h-4 w-4" />
              </a>
            </div>
          )
        })}
      </div>
      <Lightbox
        open={showLightbox}
        close={() => setShowLightbox(false)}
        slides={data.map((item) => ({
          src: item.imageBytes!,
          downloadUrl: item.imageBytes,
        }))}
        index={lightboxIndex}
        plugins={[LightboxFullscreen, LightboxDownload]}
      />
    </>
  )
}

export default memo(Imagen)
