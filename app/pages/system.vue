<script setup lang="ts">
interface SystemInfo {
  dockerVersion: string
  ddevVersion: string | null
  hostContainers: string[]
  version: { current: string, latest: string | null, updateAvailable: boolean }
}

interface ReleaseRow {
  tag: string
  notes: string
  publishedAt: string | null
  isNew: boolean
}

const { user } = useUserSession()
const isOwner = computed(() => user.value?.isOwner)
const host = useRequestURL().host

// The version comes from the baked QUICKDDEVPREVIEWS_VERSION (server-side env);
// dev/local builds report 'dev'.
const { data, status, error, refresh } = await useFetch<SystemInfo>('/api/system', { lazy: true })

// The changelog: published releases with their commit-list notes. Lazy and
// separate from /api/system so the instance probe stays light. Only versions
// the instance would gain by updating are shown; the full history lives on
// GitHub (linked below).
const { data: changelog, status: changelogStatus } = useFetch<{ current: string, releases: ReleaseRow[] }>(
  '/api/system/releases',
  { lazy: true },
)
const newReleases = computed(() => changelog.value?.releases.filter(r => r.isNew) ?? [])
const FULL_CHANGELOG_URL = 'https://github.com/mandrasch/quick-ddev-previews/releases'

// Collapsed by default: with several pending versions the notes would pile up
// into a wall; a row per version stays scannable.
const expanded = ref<Record<string, boolean>>({})
function toggleRelease(tag: string) {
  expanded.value[tag] = !expanded.value[tag]
}

function changeCount(notes: string): string {
  const n = notes.split('\n').filter(line => line.trim()).length
  return n === 1 ? '1 change' : `${n} changes`
}

// Release bodies are plain "- subject" lines grouped under "Breaking:/New:/
// Fixed:" lines (see release.yml and scripts/changelog-preview.sh); the group
// lines render as headings, everything else as list items, not markdown.
// Releases published before that convention carry --generate-notes markdown,
// so boilerplate (headings, "Full Changelog" compare links, ** emphasis) is
// stripped rather than shown raw.
function notesLines(notes: string): { text: string, heading: boolean }[] {
  return notes
    .split('\n')
    .map(line => line.trim().replace(/^[-*]\s+/, '').replaceAll('**', ''))
    .filter(line => line && !line.startsWith('#') && !/^full changelog/i.test(line))
    .map(line => ({ text: line, heading: /^(Breaking|New|Fixed):$/.test(line) }))
}

// Self-update: kick off the updater, then poll until the recreated container
// answers with the target version (fetches fail while it restarts; that's
// expected) and reload into the new build.
const updating = ref(false)
const updateError = ref('')
const updateStale = ref(false)

async function runUpdate() {
  const target = data.value?.version.latest
  if (!target || updating.value) return
  updating.value = true
  updateError.value = ''
  try {
    await $fetch('/api/system/update', { method: 'POST' })
  }
  catch (err) {
    updating.value = false
    updateError.value = (err as { data?: { statusMessage?: string } }).data?.statusMessage || 'Update failed to start.'
    return
  }
  const startedAt = Date.now()
  const poll = setInterval(async () => {
    try {
      const info = await $fetch<{ version: { current: string } }>('/api/system')
      if (info.version.current === target) {
        clearInterval(poll)
        location.reload()
      }
    }
    catch { /* container is restarting */ }
    if (Date.now() - startedAt > 2 * 60 * 1000) updateStale.value = true
  }, 5000)
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <div>
      <h1 class="text-2xl font-bold text-highlighted">
        System
      </h1>
      <p class="mt-1 text-sm text-muted">
        Instance information
      </p>
    </div>

    <section class="k-card p-6">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">
          Instance
        </h2>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="status === 'pending'"
          @click="refresh()"
        />
      </div>

      <div
        v-if="status === 'pending'"
        class="mt-4 text-sm text-dimmed"
      >
        Loading system info...
      </div>
      <div
        v-else-if="error"
        class="mt-4 text-sm text-error"
      >
        {{ error.message }}
      </div>
      <div
        v-else-if="data"
        class="mt-4 flex flex-col gap-3"
      >
        <div class="flex items-center justify-between border-b border-muted pb-3">
          <span class="text-sm text-muted">Version</span>
          <span class="k-mono text-sm text-toned">{{ data.version.current }}</span>
        </div>
        <div class="flex items-center justify-between border-b border-muted pb-3">
          <span class="text-sm text-muted">Host</span>
          <span class="k-mono text-sm text-toned">{{ host }}</span>
        </div>
        <div class="flex items-center justify-between border-b border-muted pb-3">
          <span class="text-sm text-muted">Docker</span>
          <span
            class="k-mono text-sm"
            :class="data.dockerVersion === 'not available' ? 'text-error' : 'text-toned'"
          >{{ data.dockerVersion }}</span>
        </div>
        <div class="flex items-center justify-between border-b border-muted pb-3">
          <span class="text-sm text-muted">ddev</span>
          <span
            class="k-mono text-sm"
            :class="data.ddevVersion ? 'text-toned' : 'text-error'"
          >{{ data.ddevVersion ?? 'missing' }}</span>
        </div>
      </div>
    </section>

    <section class="k-card p-6">
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 class="text-lg font-semibold">
          What's new
        </h2>
        <div class="flex items-center gap-4">
          <a
            :href="FULL_CHANGELOG_URL"
            target="_blank"
            rel="noopener"
            class="k-mono flex items-center gap-1 text-2xs text-dimmed transition-colors hover:text-toned"
          >
            Full changelog
            <UIcon
              name="i-lucide-arrow-up-right"
              class="size-3"
            />
          </a>
          <UButton
            v-if="data?.version.updateAvailable && isOwner"
            color="primary"
            icon="i-lucide-arrow-up-circle"
            :loading="updating"
            @click="runUpdate()"
          >
            {{ updating ? `Updating to ${data.version.latest}...` : `Update to ${data.version.latest}` }}
          </UButton>
        </div>
      </div>

      <p
        v-if="updateError"
        class="k-mono mt-2 block text-2xs text-error"
      >
        {{ updateError }}
      </p>
      <p
        v-if="updateStale"
        class="k-mono mt-2 block text-2xs text-dimmed"
      >
        Still updating. Check `docker logs quickddevpreviews-updater` on the server.
      </p>

      <div
        v-if="changelogStatus === 'pending'"
        class="k-mono mt-3 text-xs text-dimmed"
      >
        Loading changelog...
      </div>
      <div
        v-else-if="!newReleases.length"
        class="k-mono mt-3 text-xs text-dimmed"
      >
        Up to date. Nothing to install.
      </div>
      <div
        v-else
        class="mt-2 flex flex-col"
      >
        <div
          v-for="rel in newReleases"
          :key="rel.tag"
          class="border-b border-muted last:border-0"
        >
          <button
            type="button"
            class="group/row flex w-full cursor-pointer items-center gap-2.5 py-2.5 text-left"
            @click="toggleRelease(rel.tag)"
          >
            <UIcon
              name="i-lucide-chevron-right"
              class="size-3.5 flex-none text-dimmed transition-[transform,color] group-hover/row:text-primary"
              :class="expanded[rel.tag] && 'rotate-90'"
            />
            <span class="k-mono text-xs text-toned transition-colors group-hover/row:text-highlighted">{{ rel.tag }}</span>
            <span class="k-mono text-2xs text-dimmed">{{ rel.publishedAt ? new Date(rel.publishedAt).toLocaleDateString() : '' }}</span>
            <span class="k-mono ml-auto text-2xs text-dimmed">{{ changeCount(rel.notes) }}</span>
          </button>
          <ul
            v-if="expanded[rel.tag]"
            class="flex flex-col gap-1.5 pb-3 pl-6"
          >
            <li
              v-for="(line, i) in notesLines(rel.notes)"
              :key="i"
              class="k-mono flex gap-2 text-2xs leading-normal"
              :class="line.heading ? 'mt-1 font-medium text-toned first:mt-0' : 'text-muted'"
            >
              <span
                v-if="!line.heading"
                class="flex-none text-dimmed"
              >·</span>
              <span class="min-w-0 break-words">{{ line.text }}</span>
            </li>
            <li
              v-if="!notesLines(rel.notes).length"
              class="k-mono text-2xs text-dimmed"
            >
              No notes.
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section class="k-card p-6">
      <h2 class="text-lg font-semibold">
        Password reset
      </h2>
      <p class="mt-2 text-sm text-muted">
        If you lose access, an admin can reset your password from the server:
      </p>
      <pre class="k-mono mt-3 rounded-lg border border-default bg-(--surface-base) p-4 text-2xs text-dimmed overflow-x-auto">docker compose exec quickddevpreviews npm run reset-password &lt;email&gt;</pre>
    </section>
  </div>
</template>
