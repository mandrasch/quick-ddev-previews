<script setup lang="ts">
// Run detail page: status, live log, and the embedded preview browser once
// the env is up and the boot finished.
const route = useRoute()
const runId = computed(() => Number(route.params.id))
const toast = useToast()

const { data: run, refresh } = await useFetch(`/api/runs/${runId.value}`)

// Poll while the run is live.
const live = computed(() => run.value?.status === 'queued' || run.value?.status === 'running')
watch(live, (l) => {
  if (l) {
    const t = setInterval(() => void refresh(), 3000)
    onUnmounted(() => clearInterval(t))
  }
}, { immediate: true })

const previewOnline = computed(() =>
  run.value?.envState === 'up' && run.value.previewReady === true,
)

const canOpen = computed(() => previewOnline.value)
const isBooting = computed(() =>
  run.value?.status === 'running' && run.value.previewReady !== true,
)

async function deleteRun() {
  if (!confirm('Delete this preview? Its containers and volumes are removed.')) return
  await $fetch(`/api/runs/${runId.value}`, { method: 'DELETE' })
  await navigateTo('/runs')
}

function statusColor(status: string) {
  switch (status) {
    case 'success': return 'primary'
    case 'running': case 'queued': return 'orange'
    case 'failed': case 'cancelled': return 'error'
    default: return 'neutral'
  }
}

// ── Terminal modal (SSH into the running env) ────────────────────────────────
interface SshInfo {
  services: string[]
  sshCommands: Record<string, string> | null
}
const terminalOpen = ref(false)
const terminalService = ref('web')
const terminalServices = ref<string[]>([])
const sshCommands = ref<Record<string, string> | null>(null)
const openingTerminal = ref(false)
const canTerminal = computed(() => run.value?.envState === 'up')

async function openTerminal() {
  terminalService.value = 'web'
  terminalServices.value = []
  sshCommands.value = null
  openingTerminal.value = true
  try {
    const info = await $fetch<SshInfo>(`/api/runs/${runId.value}/ssh`)
    terminalServices.value = info.services
    sshCommands.value = info.sshCommands
  }
  catch {
    // Env down or an error: still open the modal with just 'web' and no command.
    terminalServices.value = ['web']
    sshCommands.value = null
  }
  finally {
    openingTerminal.value = false
  }
  terminalOpen.value = true
}

async function copySshCommand() {
  const command = sshCommands.value?.[terminalService.value]
  if (!command) return
  try {
    await copyText(command)
    toast.add({ title: 'Command copied', color: 'success' })
  }
  catch {
    toast.add({ title: 'Could not copy the command', color: 'error' })
  }
}
</script>

<template>
  <div>
    <div
      v-if="run"
      class="flex flex-col gap-8"
    >
      <div class="flex items-start justify-between">
        <div>
          <div class="flex items-center gap-3">
            <NuxtLink
              to="/runs"
              class="text-sm text-muted hover:text-toned"
            >
              ← Previews
            </NuxtLink>
            <h1 class="text-2xl font-bold text-highlighted">
              {{ run.fullName }}
            </h1>
          </div>
          <div class="mt-1 flex items-center gap-3 text-sm text-muted">
            <span class="font-mono">{{ run.branch }}</span>
            <span class="text-dimmed">#{{ run.id }}</span>
            <span
              class="flex items-center gap-1.5"
              :style="{ color: statusColor(run.status) }"
            >
              <span
                class="size-2 flex-none rounded-full"
                :style="{ background: statusColor(run.status) }"
              />
              {{ run.status }}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-square-terminal"
            :disabled="!canTerminal"
            :loading="openingTerminal"
            @click="openTerminal"
          >
            Terminal
          </UButton>
          <UButton
            color="error"
            variant="ghost"
            size="sm"
            icon="i-lucide-trash-2"
            @click="deleteRun"
          >
            Delete
          </UButton>
        </div>
      </div>

      <!-- The preview browser -->
      <KPreviewBrowser
        :run-id="run.id"
        :hosts="run.previewHosts"
        :online="canOpen"
        :booting="isBooting"
      />

      <section class="k-card p-6">
        <h2 class="text-lg font-semibold">
          Boot log
        </h2>
        <pre class="k-mono mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-default bg-(--surface-base) p-4 text-2xs text-dimmed">{{ run.log || 'Waiting for the run to start…' }}</pre>
      </section>

      <section
        v-if="run.envVars.length"
        class="k-card p-6"
      >
        <h2 class="text-lg font-semibold">
          Environment
        </h2>
        <div class="mt-3 flex flex-col gap-2">
          <div
            v-for="v in run.envVars"
            :key="v.key"
            class="flex items-center justify-between rounded-lg border border-default px-4 py-2"
          >
            <span class="k-mono text-2xs text-toned">{{ v.key }}</span>
            <span class="k-mono text-2xs text-dimmed">{{ v.value }}</span>
          </div>
        </div>
      </section>
    </div>

    <!-- ── Terminal modal ────────────────────────────────────────────────────── -->
    <UModal
      v-model:open="terminalOpen"
      title="Terminal"
      description="Choose a container and open a shell, or copy the SSH command for your own terminal."
    >
      <template #body>
        <div v-if="terminalServices.length > 1">
          <span class="k-label">Container</span>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="s in terminalServices"
              :key="s"
              type="button"
              class="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
              :class="terminalService === s
                ? 'border-default bg-(--surface-glass) text-highlighted'
                : 'border-transparent text-muted hover:text-toned'"
              @click="terminalService = s"
            >
              {{ s }}
            </button>
          </div>
        </div>

        <div class="mt-4">
          <KRunTerminal
            :key="terminalService"
            :run-id="runId"
            :service="terminalService"
          />
        </div>
      </template>

      <template #footer>
        <div class="flex w-full items-center justify-between gap-2">
          <span class="text-2xs text-dimmed">
            Prefer your own terminal?
          </span>
          <UButton
            color="neutral"
            variant="outline"
            size="xs"
            icon="i-lucide-copy"
            :disabled="!sshCommands?.[terminalService]"
            @click="copySshCommand"
          >
            Copy SSH command
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
