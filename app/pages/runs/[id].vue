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

// ── Share + preview access (Phase 8) ─────────────────────────────────────────
const reqUrl = useRequestURL()
const previewUrl = computed(() => {
  const r = run.value
  if (!r) return null
  return `${reqUrl.protocol}//${previewHostname(previewKey(r), reqUrl.host)}/`
})

type Visibility = 'private' | 'password' | 'public'
const visibility = ref<Visibility>('private')
const previewPassword = ref('')
const visibilitySaving = ref(false)
const visibilitySaved = ref(false)
const visibilityError = ref<string | null>(null)

watch(run, (r) => {
  if (!r) return
  visibility.value = r.visibility as Visibility
}, { immediate: true })

const passwordInvalid = computed(() =>
  visibility.value === 'password' && !previewPassword.value && !run.value?.previewPasswordSet,
)

const shareHint = computed(() => {
  const r = run.value
  if (!r) return ''
  if (r.visibility === 'password') return 'Anyone with this URL and the preview password can open it.'
  if (r.visibility === 'public') {
    return 'Anyone with this URL can open it. For a random slug, the URL itself is the secret: treat it like a password.'
  }
  return 'Anyone logged into this dashboard can open it.'
})

async function saveVisibility() {
  visibilitySaving.value = true
  visibilityError.value = null
  visibilitySaved.value = false
  try {
    await $fetch(`/api/runs/${runId.value}`, {
      method: 'PATCH',
      body: {
        visibility: visibility.value,
        previewPassword: visibility.value === 'password' && previewPassword.value ? previewPassword.value : undefined,
      },
    })
    previewPassword.value = ''
    visibilitySaved.value = true
    await refresh()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    visibilityError.value = e?.data?.statusMessage || 'Could not update preview access'
  }
  finally {
    visibilitySaving.value = false
  }
}

async function copyPreviewUrl() {
  if (!previewUrl.value) return
  try {
    await copyText(previewUrl.value)
    toast.add({ title: 'Preview URL copied', color: 'success' })
  }
  catch {
    toast.add({ title: 'Could not copy the URL', color: 'error' })
  }
}

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
            <UBadge
              v-if="run.visibility === 'public'"
              color="success"
              variant="subtle"
              size="sm"
            >
              public
            </UBadge>
            <UBadge
              v-else-if="run.visibility === 'password'"
              color="warning"
              variant="subtle"
              size="sm"
            >
              password
            </UBadge>
            <UBadge
              v-else
              color="neutral"
              variant="subtle"
              size="sm"
            >
              private
            </UBadge>
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
        :slug="previewKey(run)"
        :hosts="run.previewHosts"
        :online="canOpen"
        :booting="isBooting"
      />

      <!-- Share + preview access -->
      <section class="k-card p-6">
        <h2 class="text-lg font-semibold">
          Share
        </h2>
        <div class="mt-3 flex items-center gap-2">
          <UInput
            :model-value="previewUrl ?? ''"
            readonly
            class="k-mono flex-1"
            block
          />
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-copy"
            :disabled="!previewUrl"
            @click="copyPreviewUrl"
          >
            Copy
          </UButton>
        </div>
        <p class="mt-2 text-2xs text-dimmed">
          {{ shareHint }}
        </p>

        <div class="mt-6 flex flex-col gap-4 border-t border-default pt-5">
          <UFormField
            label="Who can view this preview?"
            class="max-w-md"
          >
            <URadioGroup
              v-model="visibility"
              orientation="horizontal"
              :items="[
                { label: 'Private', value: 'private' },
                { label: 'Password', value: 'password' },
                { label: 'Public', value: 'public' },
              ]"
            />
          </UFormField>

          <UFormField
            v-if="visibility === 'password'"
            label="Preview password"
            class="max-w-md"
          >
            <UInput
              v-model="previewPassword"
              type="password"
              :placeholder="run.previewPasswordSet ? 'Leave blank to keep the current password' : 'Set a preview password'"
              size="lg"
              block
            />
            <template #hint>
              Changing it instantly revokes all previously shared URLs.
            </template>
          </UFormField>

          <UAlert
            v-if="visibilityError"
            color="error"
            variant="subtle"
            :description="visibilityError"
          />

          <div class="flex items-center gap-3">
            <UButton
              color="primary"
              size="sm"
              :loading="visibilitySaving"
              :disabled="passwordInvalid"
              @click="saveVisibility"
            >
              Save access
            </UButton>
            <span
              v-if="visibilitySaved"
              class="text-xs text-emerald-400"
            >
              Saved
            </span>
          </div>
        </div>
      </section>

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
