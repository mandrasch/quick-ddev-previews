<script setup lang="ts">
// Run detail page: status, live log, and the embedded preview browser once
// the env is up and the boot finished.
const route = useRoute()
const runId = computed(() => Number(route.params.id))

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
</script>

<template>
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
</template>
