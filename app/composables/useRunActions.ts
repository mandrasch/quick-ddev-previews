// Shared helpers for the run control buttons (Retry / Reboot / Stop / Start /
// Cancel / Pull) used by the run detail page and the /runs list. `onDone` runs
// after a successful action so the page can refresh its data. Pull returns
// immediately (the work runs in the background); the detail page polls
// run.pulling for completion.

interface RunActionOptions {
  confirm?: string
  success: string
}

export function useRunActions(onDone?: () => void) {
  const toast = useToast()
  // The action currently running (blocks double-clicks across buttons).
  const pending = ref<string | null>(null)

  async function runAction(runId: number, action: string, opts: RunActionOptions) {
    if (pending.value) return
    if (opts.confirm && !confirm(opts.confirm)) return
    pending.value = action
    try {
      await $fetch(`/api/runs/${runId}/${action}`, { method: 'POST' })
      toast.add({ title: opts.success, color: 'success' })
      onDone?.()
    }
    catch (err) {
      const e = err as { data?: { statusMessage?: string } }
      toast.add({ title: e?.data?.statusMessage || 'Action failed', color: 'error' })
    }
    finally {
      pending.value = null
    }
  }

  return { pending, runAction }
}
