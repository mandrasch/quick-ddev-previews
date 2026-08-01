<script setup lang="ts">
// Browser chrome around the live preview iframe: back/forward/reload, an
// editable address bar, and open-in-new-tab. The frame is cross-origin, so
// navigation state comes from the bridge script the preview proxy injects
// into every HTML response (server/utils/preview-proxy.ts): the frame posts
// `nav` messages up, the chrome posts `cmd` messages down.

const props = withDefaults(defineProps<{
  runId: number
  /** All ddev hostnames the run serves, primary first (run.previewHosts). */
  hosts?: string[]
  /** The preview is browsable: the env is up AND the boot finished. */
  online?: boolean
  /** The boot is still in progress; shows the starting state. */
  booting?: boolean
}>(), {
  hosts: () => [],
  online: false,
  booting: false,
})

const reqUrl = useRequestURL()
const primaryHost = computed(() => props.hosts[0] ?? null)
const live = computed(() => props.online)

// The per-run preview origin for one of the project's ddev hostnames.
function originFor(host: string | null): string {
  const label = host && host !== primaryHost.value ? previewLabel(host) : undefined
  return `${reqUrl.protocol}//${previewHostname(props.runId, reqUrl.host, label)}`
}

const homeUrl = `${originFor(null)}/`

// ── Navigation state, fed by the bridge ────────────────────────────────────
const frame = ref<HTMLIFrameElement>()
const frameSrc = ref(homeUrl)
const frameKey = ref(0)
const currentUrl = ref(homeUrl)
const bridged = ref(false)
const stack = ref<string[]>([])
const pos = ref(-1)

const canBack = computed(() => pos.value > 0)
const canForward = computed(() => pos.value < stack.value.length - 1)

function onMessage(e: MessageEvent) {
  const data = e.data as { knecht?: string, href?: string } | null
  if (data?.knecht !== 'nav' || typeof data.href !== 'string') return
  if (e.source !== frame.value?.contentWindow) return
  if (parsePreviewHost(new URL(e.origin).host)?.runId !== props.runId) return

  bridged.value = true
  currentUrl.value = data.href
  if (stack.value[pos.value] === data.href) return // reload
  if (stack.value[pos.value - 1] === data.href) pos.value--
  else if (stack.value[pos.value + 1] === data.href) pos.value++
  else {
    stack.value = [...stack.value.slice(0, pos.value + 1), data.href]
    pos.value++
  }
}
onMounted(() => window.addEventListener('message', onMessage))
onUnmounted(() => window.removeEventListener('message', onMessage))

function post(action: string) {
  frame.value?.contentWindow?.postMessage({ knecht: 'cmd', action }, '*')
}

function go(url: string) {
  if (frameSrc.value === url) frameKey.value++
  else frameSrc.value = url
  bridged.value = false
  currentUrl.value = url
}

function reload() {
  if (bridged.value) post('reload')
  else frameKey.value++
}

// ── Address bar ────────────────────────────────────────────────────────────
const address = ref(displayUrl(homeUrl))
const editing = ref(false)

function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    const target = parsePreviewHost(u.host)
    if (target?.runId === props.runId && props.hosts.length) {
      const host = target.label
        ? props.hosts.find(h => previewLabel(h) === target.label)
        : primaryHost.value
      if (host) return host + u.pathname + u.search + u.hash
    }
  }
  catch { /* not a URL, show as-is */ }
  return url.replace(/^https?:\/\//, '')
}

watch(currentUrl, (url) => {
  if (!editing.value) address.value = displayUrl(url)
})

function submitAddress() {
  editing.value = false
  const input = address.value.trim()
  if (!input) return resetAddress()
  go(resolveAddress(input))
}

function resolveAddress(input: string): string {
  const currentOrigin = (() => {
    try {
      return new URL(currentUrl.value).origin
    }
    catch {
      return originFor(null)
    }
  })()

  if (input.startsWith('/')) return currentOrigin + input
  if (!/^https?:\/\//.test(input) && !input.includes('.')) return `${currentOrigin}/${input}`

  try {
    const url = new URL(/^https?:\/\//.test(input) ? input : `${reqUrl.protocol}//${input}`)
    const ddevHost = props.hosts.find(h => h === url.hostname)
    if (ddevHost) return originFor(ddevHost) + url.pathname + url.search + url.hash
    return url.href
  }
  catch {
    return `${currentOrigin}/${input.replace(/^\/+/, '')}`
  }
}

function resetAddress() {
  editing.value = false
  address.value = displayUrl(currentUrl.value)
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-default bg-(--surface-muted)">
    <div class="flex items-center gap-3 border-b border-default bg-(--surface-elevated) px-4 py-2.5">
      <div class="flex flex-none items-center gap-0.5">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Back"
          :disabled="!live || !canBack"
          @click="post('back')"
        />
        <UButton
          icon="i-lucide-arrow-right"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Forward"
          :disabled="!live || !canForward"
          @click="post('forward')"
        />
        <UButton
          icon="i-lucide-rotate-cw"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Reload"
          :disabled="!live"
          @click="reload"
        />
      </div>

      <div class="flex min-w-0 flex-1 items-center">
        <div class="flex min-w-0 flex-1 items-center gap-2 rounded-sm bg-(--surface-base) px-3 py-1">
          <UIcon
            name="i-lucide-lock"
            class="size-3 flex-none text-muted"
          />
          <input
            v-if="live"
            v-model="address"
            type="text"
            spellcheck="false"
            autocomplete="off"
            aria-label="Preview address"
            class="k-mono min-w-0 flex-1 bg-transparent text-xs text-muted outline-none focus:text-default"
            @focus="editing = true; ($event.target as HTMLInputElement).select()"
            @blur="resetAddress"
            @keydown.enter="submitAddress(); ($event.target as HTMLInputElement).blur()"
            @keydown.esc="resetAddress(); ($event.target as HTMLInputElement).blur()"
          >
          <span
            v-else
            class="k-mono flex-1 truncate text-xs text-dimmed"
          >{{ booting ? 'Preparing the preview…' : 'no live preview' }}</span>
        </div>
      </div>

      <span class="k-mono flex flex-none items-center gap-1.5 text-xs text-dimmed">
        {{ live ? 'live' : booting ? 'starting' : 'offline' }}
      </span>
      <UButton
        icon="i-lucide-external-link"
        color="neutral"
        variant="ghost"
        size="xs"
        aria-label="Open preview in a new tab"
        :disabled="!live"
        :to="live ? currentUrl : undefined"
        target="_blank"
      />
    </div>

    <div class="relative aspect-video w-full bg-(--surface-base)">
      <iframe
        v-if="live"
        :key="frameKey"
        ref="frame"
        :src="frameSrc"
        class="absolute inset-0 size-full"
      />
      <div
        v-else-if="booting"
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-4 animate-spin text-dimmed"
        />
        <p class="text-2sm text-muted">
          Booting the project. The preview appears here as soon as it's ready.
        </p>
      </div>
      <div
        v-else
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
      >
        <slot />
      </div>
    </div>
  </div>
</template>
