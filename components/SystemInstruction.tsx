'use client'
import { useState, useEffect, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { X, SquarePen, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import Magicdown from '@/components/Magicdown'
import Button from '@/components/Button'
import { useMessageStore } from '@/store/chat'
import { useSettingStore } from '@/store/setting'
import { GEMINI_API_BASE_URL } from '@/constant/urls'
import { encodeToken } from '@/utils/signature'
import optimizePrompt, { type RequestProps } from '@/utils/optimizePrompt'
import { cn } from '@/utils'

type Props = {
  className?: string
  maxHeight?: string
  closeable?: boolean
}

const formSchema = z.object({
  content: z.string(),
})

function SystemInstruction({ className = '', maxHeight = '140px', closeable = true }: Props) {
  const { t } = useTranslation()
  const { instruction, setSystemInstructionEditMode } = useMessageStore()
  const systemInstruction = useMessageStore((state) => state.systemInstruction)
  const systemInstructionEditMode = useMessageStore((state) => state.systemInstructionEditMode)
  const [html, setHtml] = useState<string>('')

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      content: systemInstruction,
    },
  })

  const handleSave = useCallback(() => {
    const { content } = form.getValues()
    instruction(content)
    setSystemInstructionEditMode(false)
  }, [form, instruction, setSystemInstructionEditMode])

  const handleClear = useCallback(() => {
    instruction('')
    setSystemInstructionEditMode(false)
  }, [instruction, setSystemInstructionEditMode])

  const optimizeAssistantPrompt = useCallback(async () => {
    const { content } = form.getValues()
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
    let newContent = ''
    const reader = readableStream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      newContent += new TextDecoder().decode(value)
      form.setValue('content', newContent)
    }
  }, [form])

  useEffect(() => {
    setHtml(systemInstruction)
    form.setValue('content', systemInstruction)
    return () => {
      setHtml('')
    }
  }, [form, systemInstruction])

  return (
    <Card className={cn('dark:border-slate-500', className)}>
      <CardHeader className="flex flex-row justify-between space-y-0 px-4 pb-1 pt-3">
        <CardTitle className="inline-flex text-lg font-medium">
          {t('assistantSetting')}{' '}
          {systemInstructionEditMode ? (
            <Button
              className="ml-2 h-7 w-7"
              size="icon"
              variant="ghost"
              title={t('optimizePrompt')}
              onClick={() => optimizeAssistantPrompt()}
            >
              <Sparkles />
            </Button>
          ) : (
            <Button
              className="ml-2 h-7 w-7"
              size="icon"
              variant="ghost"
              title={t('editAssistantSettings')}
              onClick={() => setSystemInstructionEditMode(true)}
            >
              <SquarePen />
            </Button>
          )}
        </CardTitle>
        {systemInstructionEditMode ? (
          <div className="inline-flex gap-2">
            <Button className="h-7" size="sm" variant="outline" onClick={() => setSystemInstructionEditMode(false)}>
              {t('cancel')}
            </Button>
            <Button className="h-7" size="sm" type="submit" onClick={() => handleSave()}>
              {t('save')}
            </Button>
          </div>
        ) : (
          <X
            className={cn('h-7 w-7 cursor-pointer rounded-full p-1 text-muted-foreground hover:bg-secondary/80', {
              hidden: !closeable,
            })}
            onClick={() => handleClear()}
          />
        )}
      </CardHeader>
      <div className="overflow-auto" style={{ maxHeight }}>
        <CardContent className="p-4 pt-0">
          {systemInstructionEditMode ? (
            <Form {...form}>
              <form>
                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea rows={5} placeholder={t('systemInstructionPlaceholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          ) : (
            <Magicdown className="small">{html}</Magicdown>
          )}
        </CardContent>
      </div>
    </Card>
  )
}

export default memo(SystemInstruction)
