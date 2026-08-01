<script setup lang="ts">
const version = 'dev'
const host = useRequestURL().host
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
      <h2 class="text-lg font-semibold">
        Instance
      </h2>
      <div class="mt-4 flex flex-col gap-3">
        <div class="flex items-center justify-between border-b border-muted pb-3">
          <span class="text-sm text-muted">Version</span>
          <span class="k-mono text-sm text-toned">{{ version }}</span>
        </div>
        <div class="flex items-center justify-between border-b border-muted pb-3">
          <span class="text-sm text-muted">Host</span>
          <span class="k-mono text-sm text-toned">{{ host }}</span>
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
