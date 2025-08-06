'use client'
import { useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import ResponsiveDialog from '@/components/ResponsiveDialog'
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useMultimodalLiveStore } from '@/store/multimodal'
import { useSettingStore } from '@/store/setting'
import { voice } from '@/constant/multimodal'
import { toPairs, omitBy, isFunction } from 'lodash-es'

type SettingProps = {
  open: boolean
  onClose: () => void
}

const formSchema = z.object({
  apiKey: z.string(),
  apiProxy: z.string().optional(),
  voiceName: z.string(),
  responseModalities: z.string().optional(),
})

function Setting({ open, onClose }: SettingProps) {
  const { t } = useTranslation()
  const { apiKey: globalApiKey } = useSettingStore()

  const VoiceOptions = useCallback(() => {
    return toPairs(voice).map((kv) => {
      return (
        <SelectItem key={kv[0]} value={kv[0]}>
          {kv[1]}
        </SelectItem>
      )
    })
  }, [])

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: async () => {
      return new Promise((resolve) => {
        const state = useMultimodalLiveStore.getState()
        const store = omitBy(state, (item) => isFunction(item)) as z.infer<typeof formSchema>
        if (!store.apiKey) store.apiKey = globalApiKey
        setTimeout(() => {
          resolve(store)
        }, 500)
      })
    },
  })

  const handleSubmit = useCallback(
    (values: z.infer<typeof formSchema>) => {
      const { update } = useMultimodalLiveStore.getState()
      update(values)
      onClose()
    },
    [onClose],
  )

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={t('setting')}
      description={t('multimodalSettingDesc')}
      footer={
        <>
          <Button className="flex-1" type="submit" onClick={form.handleSubmit(handleSubmit)}>
            {t('save')}
          </Button>
          <Button className="flex-1 max-sm:mt-2" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form className="grid w-full gap-4 px-4 py-4 max-sm:px-0">
          <FormField
            control={form.control}
            name="apiKey"
            render={({ field }) => (
              <FormItem className="grid grid-cols-4 items-center gap-4 space-y-0">
                <FormLabel className="text-right">
                  <span className="leading-12 mr-1 text-red-500">*</span>
                  {t('geminiKey')}
                </FormLabel>
                <FormControl>
                  <Input className="col-span-3" type="password" placeholder={t('geminiKeyPlaceholder')} {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="apiProxy"
            render={({ field }) => (
              <FormItem className="grid grid-cols-4 items-center gap-4 space-y-0">
                <FormLabel className="text-right">{t('apiProxyUrl')}</FormLabel>
                <FormControl>
                  <Input className="col-span-3" placeholder="wss://generativelanguage.googleapis.com" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="voiceName"
            render={({ field }) => (
              <FormItem className="grid grid-cols-4 items-center gap-4 space-y-0">
                <FormLabel className="text-right">{t('voiceName')}</FormLabel>
                <FormControl>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="col-span-3">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <VoiceOptions />
                    </SelectContent>
                  </Select>
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="responseModalities"
            render={({ field }) => (
              <FormItem className="grid grid-cols-4 items-center gap-4 space-y-0">
                <FormLabel className="text-right">{t('responseType')}</FormLabel>
                <FormControl>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="col-span-3">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Text">{t('text')}</SelectItem>
                      <SelectItem value="Audio">{t('audio')}</SelectItem>
                      {/* <SelectItem value="Image">{t('image')}</SelectItem> */}
                    </SelectContent>
                  </Select>
                </FormControl>
              </FormItem>
            )}
          />
        </form>
      </Form>
    </ResponsiveDialog>
  )
}

export default memo(Setting)
