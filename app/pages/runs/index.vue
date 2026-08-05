<script setup lang="ts">
// Recent preview runs, newest first. Polls while any run is live.
const { data, refresh } = await useFetch('/api/runs')
const reqUrl = useRequestURL()

const hasLive = computed(() => (data.value ?? []).some(r => r.status === 'queued' || r.status === 'running'))
watch(hasLive, (live) => {
  if (live) {
    const t = setInterval(() => void refresh(), 3000)
    onUnmounted(() => clearInterval(t))
  }
}, { immediate: true })

// The full, shareable preview URL for a run (the slug is its host key).
function previewUrl(run: { id: number, slug: string | null }): string {
  return `${reqUrl.protocol}//${previewHostname(previewKey(run), reqUrl.host)}/`
}

function statusColor(status: string) {
  switch (status) {
    case 'success': return 'primary'
    case 'running': case 'queued': return 'orange'
    case 'failed': case 'cancelled': return 'error'
    default: return 'neutral'
  }
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-highlighted">
          Previews
        </h1>
        <p class="mt-1 text-sm text-muted">
          Recent preview runs
        </p>
      </div>
      <UButton
        to="/runs/new"
        color="primary"
        icon="i-lucide-rocket"
      >
        New preview
      </UButton>
    </div>

    <section class="k-card p-6">
      <div
        v-if="!data?.length"
        class="flex flex-col items-center gap-3 py-10 text-center"
      >
        <UIcon
          name="i-lucide-rocket"
          class="size-8 text-dimmed"
        />
        <p class="text-sm text-muted">
          No previews yet. Launch your first one.
        </p>
        <UButton
          to="/runs/new"
          color="primary"
          size="sm"
        >
          Create a preview instance
        </UButton>
      </div>

      <div
        v-else
        class="flex flex-col gap-2"
      >
        <NuxtLink
          v-for="run in data"
          :key="run.id"
          :to="`/runs/${run.id}`"
          class="flex items-center justify-between rounded-lg border border-default px-4 py-3 transition-colors hover:bg-(--surface-glass)"
        >
          <div class="flex items-center gap-3">
            <span
              class="size-2 flex-none rounded-full"
              :style="{ background: statusColor(run.status) }"
            />
            <div class="min-w-0">
              <div class="k-mono truncate text-sm text-highlighted">
                {{ previewUrl(run) }}
              </div>
              <div class="mt-0.5 flex items-center gap-1.5 text-2xs text-dimmed">
                <UIcon
                  name="i-simple-icons-github"
                  class="size-3 flex-none text-muted"
                />
                <span class="truncate font-medium text-toned">
                  {{ run.fullName }}
                </span>
                <span class="flex-none">{{ run.branch }} · #{{ run.id }}</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span
              v-if="run.previewReady"
              class="k-mono text-2xs text-primary"
            >
              preview live
            </span>
            <UBadge
              v-if="run.visibility !== 'private'"
              :color="run.visibility === 'public' ? 'success' : 'warning'"
              variant="subtle"
              size="sm"
            >
              {{ run.visibility }}
            </UBadge>
            <span class="k-mono text-2xs uppercase tracking-wider text-dimmed">
              {{ run.status }}
            </span>
          </div>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>
