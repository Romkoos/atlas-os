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
import { cn } from '@renderer/lib/utils'
import { CLAUDE_MODELS } from '@shared/models'
import { type AppSettings, LOG_LEVELS, settingsSchema, THEMES } from '@shared/settings'
import { Check, FolderOpen, ShieldCheck } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

// Pick which projects the Productivity tracker counts. Empty selection = all.
function TrackedProjectsCard() {
  const utils = trpc.useUtils()
  const discover = trpc.productivity.discoverProjects.useQuery()
  const setTracked = trpc.settings.set.useMutation({
    onSuccess: () => {
      void utils.settings.get.invalidate()
      void utils.productivity.invalidate()
    },
    onError: (error) => toast.error(error.message),
  })

  const projects = discover.data ?? []
  const allPaths = projects.map((p) => p.projectPath)
  const allTracked = projects.length > 0 && projects.every((p) => p.tracked)

  const toggle = (path: string) => {
    const next = new Set(projects.filter((p) => p.tracked).map((p) => p.projectPath))
    if (next.has(path)) next.delete(path)
    else next.add(path)
    const arr = [...next]
    // [] means "track all" — collapse a full or empty selection to that default.
    const value = arr.length === 0 || arr.length === allPaths.length ? [] : arr
    setTracked.mutate({ trackedProjects: value })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium text-sm">Tracked projects</h2>
          <p className="text-muted-foreground text-xs">
            Productivity only counts these projects. None selected = all tracked.
          </p>
        </div>

        {discover.isLoading ? (
          <p className="py-4 text-muted-foreground text-sm">Loading projects…</p>
        ) : projects.length === 0 ? (
          <p className="py-4 text-muted-foreground text-sm">
            No projects yet. Run Refresh on the Productivity page first.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {projects.map((p) => (
                <button
                  key={p.projectPath}
                  type="button"
                  aria-pressed={p.tracked}
                  onClick={() => toggle(p.projectPath)}
                  disabled={setTracked.isPending}
                  title={p.projectPath}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors disabled:opacity-50',
                    p.tracked
                      ? 'border-transparent bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {p.tracked ? <Check className="size-3.5" /> : null}
                  {p.project}
                </button>
              ))}
            </div>
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={allTracked || setTracked.isPending}
                onClick={() => setTracked.mutate({ trackedProjects: [] })}
              >
                Track all
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function Settings() {
  const utils = trpc.useUtils()
  const settingsQuery = trpc.settings.get.useQuery()

  const form = useForm<AppSettings>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      model: CLAUDE_MODELS[0].id,
      outputDir: '',
      theme: 'system',
      logLevel: 'info',
      trackedProjects: [],
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
      <PageHeader title="Settings" description="Model, output folder, theme, logging." />
      <div className="flex max-w-2xl flex-col gap-4 p-8">
        <div className="flex items-start gap-3 rounded-md border bg-muted/40 px-4 py-3 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          <div className="text-muted-foreground">
            Atlas OS uses your{' '}
            <span className="font-medium text-foreground">Claude subscription</span> via Claude Code
            — no API key needed. If a run fails with an auth error, run{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">claude login</code> in a
            terminal.
          </div>
        </div>

        <Card>
          <CardContent>
            {settingsQuery.isLoading ? (
              <p className="py-8 text-center text-muted-foreground text-sm">Loading settings…</p>
            ) : (
              <Form {...form}>
                <form onSubmit={onSubmit} className="grid gap-6">
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

        <TrackedProjectsCard />
      </div>
    </div>
  )
}
