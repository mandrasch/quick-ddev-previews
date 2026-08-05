<script setup lang="ts">
// Run detail page: status, live log, and the embedded preview browser once
// the env is up and the boot finished.
const route = useRoute()
const runId = computed(() => Number(route.params.id))
const toast = useToast()

const { data: run, refresh } = await useFetch(`/api/runs/${runId.value}`)

// Poll while the run is live (booting, or a git pull is re-applying the branch).
const live = computed(() =>
  run.value?.status === 'queued' || run.value?.status === 'running' || run.value?.pulling === true,
)
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

// ── Run controls (Retry / Reboot / Stop / Start / Cancel / Pull) ───────────
const { pending: actionPending, runAction } = useRunActions(() => void refresh())

const canCancel = computed(() => run.value?.status === 'queued' || run.value?.status === 'running')
const canRetry = computed(() => !!run.value && !canCancel.value)
const envUp = computed(() => run.value?.envState === 'up')
const envStopped = computed(() => run.value?.envState === 'stopped')
const canBootControls = computed(() => envUp.value || envStopped.value)

function cancelRun() {
  return runAction(runId.value, 'cancel', { success: 'Run cancelled' })
}

function retry() {
  return runAction(runId.value, 'retry', {
    confirm: 'Retry this preview? It boots again from the branch tip.',
    success: 'Run queued for a fresh boot',
  })
}

function stop() {
  return runAction(runId.value, 'stop', {
    confirm: 'Stop this preview environment? Containers are removed, its volumes and checkout are kept.',
    success: 'Environment stopped',
  })
}

function start() {
  return runAction(runId.value, 'start', { success: 'Environment started' })
}

function reboot() {
  return runAction(runId.value, 'reboot', {
    confirm: 'Reboot this preview environment? It blips briefly.',
    success: 'Environment rebooted',
  })
}

// Git pull: re-apply the branch's latest commits. The POST returns immediately
// and the background job streams progress to the boot log; run.pulling (polled
// above) drives the button's loading state.
const pullStatus = ref<'behind' | 'up-to-date' | 'unknown'>('unknown')
const checkingPull = ref(false)
const pullStatusText = computed(() => {
  if (checkingPull.value) return 'Checking…'
  if (pullStatus.value === 'behind') return 'New commits available'
  if (pullStatus.value === 'up-to-date') return 'Up to date'
  return ''
})

async function checkPullStatus() {
  const r = run.value
  if (!r || (r.envState !== 'up' && r.envState !== 'stopped')) {
    pullStatus.value = 'unknown'
    return
  }
  checkingPull.value = true
  try {
    const res = await $fetch<{ behind: boolean }>(`/api/runs/${runId.value}/pull-status`)
    pullStatus.value = res.behind ? 'behind' : 'up-to-date'
  }
  catch {
    pullStatus.value = 'unknown'
  }
  finally {
    checkingPull.value = false
  }
}

async function pull() {
  await runAction(runId.value, 'pull', { success: 'Pull started' })
  void checkPullStatus()
}

// A finished pull (pulling flips back to false) may have moved the branch:
// refresh the hint. Initial check happens in onMounted.
watch(() => run.value?.pulling, (p) => {
  if (p === false) void checkPullStatus()
})

onMounted(() => void checkPullStatus())

// ── Web IDE (openvscode-server) ──────────────────────────────────────────────
const openingVscode = ref(false)
async function openInVscode() {
  openingVscode.value = true
  // Open the tab synchronously: popup blockers kill windows opened after an
  // await. Navigate it once the server confirms the IDE is up.
  const tab = window.open('about:blank', '_blank')
  try {
    const { url } = await $fetch<{ url: string }>(`/api/runs/${runId.value}/ide`, { method: 'POST' })
    if (tab) tab.location.href = url
    else window.open(url, '_blank')
  }
  catch (err: unknown) {
    tab?.close()
    const e = err as { data?: { statusMessage?: string } }
    toast.add({ title: e?.data?.statusMessage || 'Could not open the IDE', color: 'error' })
  }
  finally {
    openingVscode.value = false
  }
}

// ── Init commands: the run's start command + its boot state + Retry ─────────
const initStateLabel = computed(() => run.value?.status ?? 'unknown')
const initStateBadgeColor = computed(() => {
  switch (run.value?.status) {
    case 'success': return 'success'
    case 'failed': case 'cancelled': return 'error'
    case 'running': case 'queued': return 'warning'
    default: return 'neutral'
  }
})

// ── Post-pull commands editor (run after a git pull) ─────────────────────────
const postPullText = ref('')
const postPullInitialized = ref(false)
const postPullSaving = ref(false)
const postPullSaved = ref(false)
const postPullError = ref<string | null>(null)

watch(run, (r) => {
  if (!r || postPullInitialized.value) return
  postPullText.value = (r.postPullCommands ?? []).join('\n')
  postPullInitialized.value = true
}, { immediate: true })

async function savePostPull() {
  postPullSaving.value = true
  postPullError.value = null
  postPullSaved.value = false
  try {
    const commands = postPullText.value.split('\n').map(c => c.trim()).filter(Boolean)
    await $fetch(`/api/runs/${runId.value}/post-pull-commands`, {
      method: 'PATCH',
      body: { commands },
    })
    postPullSaved.value = true
    await refresh()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    postPullError.value = e?.data?.statusMessage || 'Could not save post-pull commands'
  }
  finally {
    postPullSaving.value = false
  }
}

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
        <div class="flex flex-wrap items-center justify-end gap-2">
          <UButton
            v-if="canCancel"
            color="error"
            variant="ghost"
            size="sm"
            icon="i-lucide-circle-x"
            :loading="actionPending === 'cancel'"
            @click="cancelRun"
          >
            Cancel
          </UButton>
          <UButton
            v-if="envStopped"
            color="primary"
            variant="outline"
            size="sm"
            icon="i-lucide-play"
            :loading="actionPending === 'start'"
            @click="start"
          >
            Start
          </UButton>
          <UButton
            v-if="canBootControls"
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-refresh-cw"
            :loading="actionPending === 'reboot'"
            @click="reboot"
          >
            Reboot
          </UButton>
          <UButton
            v-if="envUp"
            color="warning"
            variant="ghost"
            size="sm"
            icon="i-lucide-square"
            :loading="actionPending === 'stop'"
            @click="stop"
          >
            Stop
          </UButton>
          <div
            v-if="canBootControls"
            class="flex items-center gap-2"
          >
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-git-pull-request"
              :loading="actionPending === 'pull' || run?.pulling"
              @click="pull"
            >
              Pull latest
            </UButton>
            <span
              v-if="pullStatusText"
              class="text-2xs text-dimmed"
            >
              {{ pullStatusText }}
            </span>
          </div>
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
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-code"
            :disabled="!canTerminal"
            :loading="openingVscode"
            @click="openInVscode"
          >
            Code
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
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold">
              Init commands
            </h2>
            <p class="mt-1 text-2xs text-dimmed">
              Run once when the preview boots, inside the web container. Retry boots the preview again from the branch tip.
            </p>
          </div>
          <div class="flex flex-none items-center gap-2">
            <UBadge
              :color="initStateBadgeColor"
              variant="subtle"
              size="sm"
            >
              {{ initStateLabel }}
            </UBadge>
            <UButton
              v-if="canRetry"
              color="primary"
              variant="outline"
              size="sm"
              icon="i-lucide-rotate-ccw"
              :loading="actionPending === 'retry'"
              @click="retry"
            >
              Retry
            </UButton>
          </div>
        </div>
        <pre class="k-mono mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-default bg-(--surface-base) p-4 text-2xs text-dimmed">{{ run.startCommand || 'No init command set (ddev start only).' }}</pre>
      </section>

      <section class="k-card p-6">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">
            Post-pull commands
          </h2>
          <UButton
            color="primary"
            variant="outline"
            size="xs"
            icon="i-lucide-save"
            :loading="postPullSaving"
            @click="savePostPull"
          >
            Save
          </UButton>
        </div>
        <p class="mt-1 text-2xs text-dimmed">
          Run after a git pull, inside the web container, after the init command. One command per line, executed in order.
        </p>
        <UTextarea
          v-model="postPullText"
          placeholder="npm run build&#10;php bin/console cache:clear"
          :rows="4"
          class="k-mono mt-3"
          block
        />
        <div class="mt-2 flex flex-col gap-2">
          <UAlert
            v-if="postPullError"
            color="error"
            variant="subtle"
            :description="postPullError"
          />
          <span
            v-if="postPullSaved"
            class="text-xs text-emerald-400"
          >
            Saved
          </span>
        </div>
      </section>

      <section class="k-card p-6">
        <h2 class="text-lg font-semibold">
          Boot log
        </h2>
        <pre class="k-mono mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-default bg-(--surface-base) p-4 text-2xs text-dimmed">{{ run.log || 'Waiting for the run to start…' }}</pre>
      </section>

      <section class="k-card p-6">
        <h2 class="text-lg font-semibold">
          Environment
        </h2>
        <p class="mt-1 text-2xs text-dimmed">
          Boot-time environment variables were set at launch and are applied when the environment boots or reboots.
        </p>
        <p class="mt-2 text-2xs text-dimmed">
          To change the project's <span class="k-mono">.env</span> file, open the integrated VS Code and edit it there. The file is the real, mounted checkout, so changes take effect immediately for the app.
        </p>
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
