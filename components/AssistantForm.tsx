import { useCallback, memo, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Sparkles } from 'lucide-react'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import Button from '@/components/Button'
import { useAssistantStore } from '@/store/assistant'
import { useSettingStore } from '@/store/setting'
import { GEMINI_API_BASE_URL, ASSISTANT_INDEX_URL } from '@/constant/urls'
import { encodeToken } from '@/utils/signature'
import optimizePrompt, { type RequestProps } from '@/utils/optimizePrompt'
import AssistantMarketUrl from '@/utils/AssistantMarketUrl'
import { customAlphabet } from 'nanoid'
import dayjs from 'dayjs'
import { isFunction, isUndefined } from 'lodash-es'

type ChangeStauts = 'new' | 'edit' | 'clear'
type Props = {
  data?: AssistantDetail
  onChange?: (status: ChangeStauts) => void
}

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 12)

const assistantSchema = {
  author: '',
  createdAt: dayjs().format('YYYY-MM-DD'),
  homepage: '',
  identifier: '',
  meta: {
    avatar: '🤖',
    tags: [],
    title: '',
    description: '',
  },
  config: {
    systemRole: '',
  },
  schemaVersion: 1,
}

const formSchema = z.object({
  id: z.string(),
  title: z.string().max(20),
  description: z.string().max(120),
  systemInstruction: z.string(),
})

function AssistantForm(props: Props) {
  const { data, onChange } = props
  const { t } = useTranslation()
  const { addAssistant, updateAssistant } = useAssistantStore()
  const editMode = useMemo(() => !isUndefined(data), [data])

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      id: '',
      title: '',
      description: '',
      systemInstruction: '',
    },
  })

  const reset = useCallback(
    (status: ChangeStauts) => {
      form.clearErrors()
      form.reset({
        id: '',
        title: '',
        description: '',
        systemInstruction: '',
      })
      if (isFunction(onChange)) onChange(status)
    },
    [form, onChange],
  )

  const handleSubmit = useCallback(
    (values: z.infer<typeof formSchema>) => {
      const assistant: AssistantDetail = data || assistantSchema
      assistant.identifier = values.id || nanoid()
      assistant.meta.title = values.title
      assistant.meta.description = values.description
      assistant.config = {
        systemRole: values.systemInstruction,
      }
      if (editMode) {
        updateAssistant(values.id, assistant)
        reset('edit')
      } else {
        addAssistant(assistant)
        reset('new')
      }
    },
    [data, addAssistant, editMode, reset, updateAssistant],
  )

  const optimizeAssistantPrompt = useCallback(async () => {
    const content = form.getValues('systemInstruction')
    if (content === '') return false
    const { apiKey, apiProxy, password } = useSettingStore.getState()
    const config: RequestProps = {
      apiKey,
      content,
    }
    if (apiKey !== '') {
      config.baseUrl = apiProxy || GEMINI_API_BASE_URL
    } else {
      config.apiKey = encodeToken(password)
      config.baseUrl = '/api/google'
    }
    const readableStream = await optimizePrompt(config)
    let systemInstruction = ''
    const reader = readableStream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      systemInstruction += new TextDecoder().decode(value)
      form.setValue('systemInstruction', systemInstruction)
    }
  }, [form])

  const initData = useCallback(async () => {
    if (data) {
      if (isUndefined(data.config?.systemRole)) {
        const { lang, assistantIndexUrl } = useSettingStore.getState()
        const assistantMarketUrl = new AssistantMarketUrl(assistantIndexUrl || ASSISTANT_INDEX_URL)
        const response = await fetch(assistantMarketUrl.getAssistantUrl(data.identifier, lang))
        const assistantDeatil: AssistantDetail = await response.json()
        form.reset({
          id: assistantDeatil.identifier,
          title: assistantDeatil.meta.title,
          description: assistantDeatil.meta.description,
          systemInstruction: assistantDeatil.config.systemRole,
        })
      } else {
        form.reset({
          id: data.identifier,
          title: data.meta.title,
          description: data.meta.description,
          systemInstruction: data.config.systemRole,
        })
      }
    }
  }, [data, form])

  useEffect(() => {
    initData()
  }, [initData, data])

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="mt-1 space-y-3 max-sm:pb-2">
        <h3 className="font-semibold">{t('baseInfor')}</h3>
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="relative">
              <FormControl>
                <Input className="w-1/2" placeholder={t('assistantTitle')} {...field} />
              </FormControl>
              <FormMessage className="absolute" />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem className="relative">
              <FormControl>
                <Input placeholder={t('assistantDescription')} {...field} />
              </FormControl>
              <FormMessage className="absolute" />
            </FormItem>
          )}
        />
        <h3 className="font-semibold">{t('assistantRoleSetting')}</h3>
        <FormField
          control={form.control}
          name="systemInstruction"
          render={({ field }) => (
            <FormItem className="relative">
              <FormControl>
                <Textarea
                  className="h-[218px] whitespace-pre-wrap max-sm:h-[210px]"
                  placeholder={t('systemInstructionPlaceholder')}
                  {...field}
                />
              </FormControl>
              <FormMessage className="absolute" />
            </FormItem>
          )}
        />
        <div className="mt-2 flex justify-between gap-2">
          <Button
            title={t('optimizePrompt')}
            variant="secondary"
            size="icon"
            type="button"
            onClick={() => optimizeAssistantPrompt()}
          >
            <Sparkles className="h-5 w-5" />
          </Button>
          <div className="flex gap-2">
            <Button className="max-sm:flex-1" type="reset" variant="outline" onClick={() => reset('clear')}>
              {t('cancel')}
            </Button>
            <Button className="max-sm:flex-1" type="submit">
              {editMode ? t('updateAssistant') : t('addAssistant')}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  )
}

export default memo(AssistantForm)
