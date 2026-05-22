import { zodResolver } from '@hookform/resolvers/zod'
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@renderer/components/ui/form'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import { trpc } from '@renderer/lib/trpc'
import { CLAUDE_MODELS } from '@shared/models'
import { type AppSettings, LOG_LEVELS, settingsSchema, THEMES } from '@shared/settings'
import { Eye, EyeOff, FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export function Settings() {
  const utils = trpc.useUtils()
  const settingsQuery = trpc.settings.get.useQuery()
  const [showKey, setShowKey] = useState(false)

  const form = useForm<AppSettings>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      apiKey: '',
      model: CLAUDE_MODELS[0].id,
      outputDir: '',
      theme: 'system',
      logLevel: 'info',
    },
  })

  useEffect(() => {
    if (settingsQuery.data) form.reset(settingsQuery.data)
  }, [settingsQuery.data, form])

  const saveMutation = trpc.settings.set.useMutation({
    onSuccess: (data) => {
      form.reset(data)
      void utils.settings.get.invalidate()
      toast.success('Settings saved')
    },
    onError: (error) => toast.error(error.message),
  })

  const resetMutation = trpc.settings.reset.useMutation({
    onSuccess: (data) => {
      form.reset(data)
      void utils.settings.get.invalidate()
      toast.success('Settings reset to defaults')
    },
    onError: (error) => toast.error(error.message),
  })

  const chooseDir = trpc.settings.chooseDirectory.useMutation({
    onSuccess: (result) => {
      if (result.path) {
        form.setValue('outputDir', result.path, { shouldDirty: true, shouldValidate: true })
      }
    },
    onError: (error) => toast.error(error.message),
  })

  const onSubmit = form.handleSubmit((values) => saveMutation.mutate(values))

  return (
    <div className="flex flex-col">
      <PageHeader title="Settings" description="API key, model, output folder, theme, logging." />
      <div className="max-w-2xl p-8">
        <Card>
          <CardContent>
            {settingsQuery.isLoading ? (
              <p className="py-8 text-center text-muted-foreground text-sm">Loading settings…</p>
            ) : (
              <Form {...form}>
                <form onSubmit={onSubmit} className="grid gap-6">
                  <FormField
                    control={form.control}
                    name="apiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Anthropic API key</FormLabel>
                        <div className="relative">
                          <FormControl>
                            <Input
                              type={showKey ? 'text' : 'password'}
                              placeholder="sk-ant-…"
                              autoComplete="off"
                              spellCheck={false}
                              className="pr-10"
                              {...field}
                            />
                          </FormControl>
                          <button
                            type="button"
                            onClick={() => setShowKey((v) => !v)}
                            className="-translate-y-1/2 absolute top-1/2 right-2 text-muted-foreground hover:text-foreground"
                            aria-label={showKey ? 'Hide API key' : 'Show API key'}
                          >
                            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </button>
                        </div>
                        <FormDescription>
                          Stored encrypted in app settings — never written to the database or logs.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="model"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default model</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select a model" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {CLAUDE_MODELS.map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                {model.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="outputDir"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Output folder</FormLabel>
                        <div className="flex gap-2">
                          <FormControl>
                            <Input readOnly placeholder="Choose a folder" {...field} />
                          </FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => chooseDir.mutate()}
                            disabled={chooseDir.isPending}
                          >
                            <FolderOpen className="size-4" />
                            Choose…
                          </Button>
                        </div>
                        <FormDescription>Generated `.md` files are saved here.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="theme"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Theme</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {THEMES.map((theme) => (
                                <SelectItem key={theme} value={theme}>
                                  {capitalize(theme)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="logLevel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Log level</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {LOG_LEVELS.map((level) => (
                                <SelectItem key={level} value={level}>
                                  {capitalize(level)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      type="submit"
                      disabled={saveMutation.isPending || !form.formState.isDirty}
                    >
                      {saveMutation.isPending ? 'Saving…' : 'Save'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => resetMutation.mutate()}
                      disabled={resetMutation.isPending}
                    >
                      Reset to defaults
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
