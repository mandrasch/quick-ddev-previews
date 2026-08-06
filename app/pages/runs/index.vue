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

// Quick actions + environment state on the list rows.
const { pending, runAction } = useRunActions(() => void refresh())

function canCancel(run: { status: string }) {
  return run.status === 'queued' || run.status === 'running'
}

function cancel(run: { id: number }) {
  return runAction(run.id, 'cancel', { success: 'Run cancelled' })
}

function retry(run: { id: number, fullName: string }) {
  return runAction(run.id, 'retry', {
    confirm: `Retry ${run.fullName}? It boots again from the branch tip.`,
    success: 'Run queued for a fresh boot',
  })
}

function stop(run: { id: number }) {
  return runAction(run.id, 'stop', {
    confirm: 'Stop this preview environment? Containers are removed, its volumes and checkout are kept.',
    success: 'Environment stopped',
  })
}

function start(run: { id: number }) {
  return runAction(run.id, 'start', { success: 'Environment started' })
}

function envStateColor(state: string) {
  switch (state) {
    case 'up': return 'text-emerald-400'
    case 'stopped': return 'text-amber-400'
    default: return 'text-dimmed'
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
        <div
          v-for="run in data"
          :key="run.id"
          class="flex items-center justify-between rounded-lg border border-default px-4 py-3 transition-colors hover:bg-(--surface-glass)"
        >
          <NuxtLink
            :to="`/runs/${run.id}`"
            class="flex min-w-0 flex-1 items-center gap-3"
          >
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
          </NuxtLink>
          <div class="flex flex-none items-center gap-3 pl-4">
            <span
              v-if="run.previewReady && run.envState === 'up'"
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
            <div class="flex items-center gap-1">
              <UButton
                v-if="canCancel(run)"
                color="error"
                variant="ghost"
                size="xs"
                icon="i-lucide-circle-x"
                aria-label="Cancel run"
                :loading="pending === 'cancel'"
                @click="cancel(run)"
              />
              <UButton
                v-else
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-rotate-ccw"
                aria-label="Retry run"
                :loading="pending === 'retry'"
                @click="retry(run)"
              />
              <UButton
                v-if="run.envState === 'up'"
                color="warning"
                variant="ghost"
                size="xs"
                icon="i-lucide-square"
                aria-label="Stop environment"
                :loading="pending === 'stop'"
                @click="stop(run)"
              />
              <UButton
                v-else-if="run.envState === 'stopped'"
                color="primary"
                variant="ghost"
                size="xs"
                icon="i-lucide-play"
                aria-label="Start environment"
                :loading="pending === 'start'"
                @click="start(run)"
              />
            </div>
            <div class="flex flex-col items-end gap-0.5">
              <span
                class="k-mono text-2xs uppercase tracking-wider"
                :class="envStateColor(run.envState)"
              >
                {{ run.envState }}
              </span>
              <span class="k-mono text-2xs uppercase tracking-wider text-dimmed">
                {{ run.status }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
