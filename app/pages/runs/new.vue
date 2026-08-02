<script setup lang="ts">
// The preview launcher. Create a preview instance:
//   1. pick a GitHub project (from the connected App's installations)
//   2. pick a branch
//   3. customize the start command (default: `ddev start`)
//   4. set .env values (with a "Copy .env.example" button)
//   5. (placeholders, no function yet) upload db dump + uploaded files
//   6. Launch preview

interface RepoOption {
  githubId: number
  owner: string
  name: string
  fullName: string
  defaultBranch: string
  private: boolean
  cloneUrl: string
}

const { data: reposData } = await useFetch<{ configured: boolean, repos: RepoOption[] }>('/api/github/repos')
const repos = computed(() => reposData.value?.configured ? reposData.value.repos : [])
const ghNotConfigured = computed(() => reposData.value ? !reposData.value.configured : false)

const repo = ref<RepoOption | undefined>(undefined)
const branches = ref<string[]>([])
const branch = ref<string>('')
const startCommand = ref('composer install')
const envText = ref('')
const launching = ref(false)
const launchError = ref<string | null>(null)

// The branch picker loads branches for the selected repo.
watch(repo, async (r) => {
  branch.value = ''
  branches.value = []
  if (!r) return
  try {
    const res = await $fetch<string[]>(`/api/github/repos/${r.owner}/${r.name}/branches`)
    branches.value = res
    if (res.includes(r.defaultBranch)) branch.value = r.defaultBranch
    else if (res[0]) branch.value = res[0]
  }
  catch {
    branches.value = [r.defaultBranch]
    branch.value = r.defaultBranch
  }
})

// "Copy .env.example" button: fetch the repo's .env.example and put it in the
// textbox.
async function copyEnvExample() {
  const r = repo.value
  if (!r) return
  const res = await $fetch<{ content: string | null }>(
    `/api/github/repos/${r.owner}/${r.name}/env-example`,
    { query: { ref: branch.value || undefined } },
  )
  if (res.content) envText.value = res.content
}

// Parse the .env textbox into { key, value }[].
function parseEnv(text: string): { key: string, value: string }[] {
  return text.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map((line) => {
      const eq = line.indexOf('=')
      if (eq === -1) return null
      return { key: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() }
    })
    .filter((x): x is { key: string, value: string } => x !== null)
}

async function launch() {
  launchError.value = null
  if (!repo.value) {
    launchError.value = 'Select a project'
    return
  }
  if (!branch.value) {
    launchError.value = 'Select a branch'
    return
  }

  launching.value = true
  try {
    const res = await $fetch<{ runId: number }>('/api/runs/launch', {
      method: 'POST',
      body: {
        repo: repo.value,
        branch: branch.value,
        startCommand: startCommand.value.trim(),
        envVars: parseEnv(envText.value),
      },
    })
    await navigateTo(`/runs/${res.runId}`)
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    launchError.value = e?.data?.statusMessage || 'Failed to launch preview'
  }
  finally {
    launching.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <div>
      <h1 class="text-2xl font-bold text-highlighted">
        Create a preview instance
      </h1>
      <p class="mt-1 text-sm text-muted">
        Pick a project, a branch, and launch a live DDEV preview.
      </p>
    </div>

    <UAlert
      v-if="ghNotConfigured"
      color="error"
      variant="subtle"
      title="GitHub not connected"
      description="Connect a GitHub App first (Settings), then pick a project."
    />

    <section class="k-card p-6">
      <div class="flex flex-col gap-5 w-full">
        <!-- 1. Select a GitHub project -->
        <UFormField
          label="GitHub project"
          required
          class="max-w-md"
        >
          <USelectMenu
            v-model="repo"
            :items="repos"
            label-key="fullName"
            placeholder="Select a project…"
            size="lg"
            class="w-full"
            block
          />
        </UFormField>

        <!-- 2. Select a branch -->
        <UFormField
          label="Branch"
          required
          class="max-w-md"
        >
          <USelectMenu
            v-model="branch"
            :items="branches"
            placeholder="Select a branch…"
            size="lg"
            class="w-full"
            block
          />
        </UFormField>

        <!-- 3. Custom start command -->
        <UFormField
          label="Post start command"
          class="max-w-md"
        >
          <UInput
            v-model="startCommand"
            placeholder="composer install"
            size="lg"
            class="max-w-md"
            block
          />
        </UFormField>
        <!-- TODO: use better positioning -->
        <small>Runs inside the web container after ddev start (which happens automatically)</small>

        <!-- 4. .env values -->
        <UFormField label=".env values">
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-end">
              <UButton
                color="neutral"
                variant="outline"
                size="xs"
                icon="i-lucide-copy"
                :disabled="!repo"
                @click="copyEnvExample"
              >
                Copy .env.example
              </UButton>
            </div>
            <UTextarea
              v-model="envText"
              placeholder="APP_URL=http://example.com&#10;DB_HOST=db"
              :rows="8"
              class="font-mono"
              block
            />
          </div>
        </UFormField>

        <!-- 5. Upload placeholders (no function yet) -->
        <UFormField label="Optional uploads">
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="flex items-center justify-between rounded-lg border border-dashed border-default px-4 py-3">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-database"
                  class="size-4 text-dimmed"
                />
                <span class="text-sm text-muted">DB dump</span>
              </div>
              <UBadge
                variant="subtle"
                size="sm"
              >
                soon
              </UBadge>
            </div>
            <div class="flex items-center justify-between rounded-lg border border-dashed border-default px-4 py-3">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-folder-open"
                  class="size-4 text-dimmed"
                />
                <span class="text-sm text-muted">Uploaded files (e.g. fileadmin/)</span>
              </div>
              <UBadge
                variant="subtle"
                size="sm"
              >
                soon
              </UBadge>
            </div>
          </div>
        </UFormField>

        <UAlert
          v-if="launchError"
          color="error"
          variant="subtle"
          :description="launchError"
        />

        <!-- 6. Launch -->
        <UButton
          color="primary"
          size="lg"
          icon="i-lucide-rocket"
          block
          :loading="launching"
          :disabled="!repo || !branch"
          @click="launch"
        >
          Launch preview
        </UButton>
      </div>
    </section>
  </div>
</template>
