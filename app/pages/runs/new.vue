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

// ── Preview access (Phase 8) ───────────────────────────────────────────────
type Visibility = 'private' | 'password' | 'public'
const visibility = ref<Visibility>('private')
const previewPassword = ref('')

// Subdomain: every run gets a slug, always. The owner picks between an
// auto-generated random slug (the URL itself is the secret for `public`
// previews) and a custom human-readable slug. There is no `<runId>.preview`
// form anymore.
const slug = ref('')
const slugMode = ref<'random' | 'custom'>('random')
const slugStatus = ref<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')

// Ambiguous characters omitted so a typed random link is easy to read out.
const SLUG_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'

function randomSlug(len = 8): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) {
    const b = bytes[i] ?? 0
    out += SLUG_CHARS[b % SLUG_CHARS.length]
  }
  return out
}

async function slugAvailable(s: string): Promise<boolean> {
  if (!isValidSlug(s)) return false
  try {
    const res = await $fetch<{ available: boolean, valid: boolean }>('/api/runs/slug-available', { query: { slug: s } })
    return res.valid && res.available
  }
  catch {
    return false
  }
}

async function regenerateSlug() {
  for (let i = 0; i < 20; i++) {
    const s = randomSlug()
    if (await slugAvailable(s)) {
      slug.value = s
      slugStatus.value = 'available'
      return
    }
  }
  slug.value = randomSlug()
  slugStatus.value = 'idle'
}

// A slug is never optional: suggest a random one from the start.
onMounted(() => void regenerateSlug())

// Live availability check for the custom slug field (debounced).
let slugTimer: ReturnType<typeof setTimeout> | undefined
watch(slug, (val) => {
  clearTimeout(slugTimer)
  if (slugMode.value !== 'custom') return
  const s = val.trim().toLowerCase()
  if (!s) {
    slugStatus.value = 'idle'
    return
  }
  if (!isValidSlug(s)) {
    slugStatus.value = 'invalid'
    return
  }
  slugStatus.value = 'checking'
  slugTimer = setTimeout(async () => {
    slugStatus.value = (await slugAvailable(s)) ? 'available' : 'taken'
  }, 350)
})

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
  if (visibility.value === 'password' && !previewPassword.value) {
    launchError.value = 'Set a preview password'
    return
  }

  const finalSlug = slug.value.trim().toLowerCase()
  if (!finalSlug) {
    launchError.value = 'A preview URL slug is required'
    return
  }
  if (!isValidSlug(finalSlug)) {
    launchError.value = 'Invalid slug: lowercase letters, digits and dashes only; no leading/trailing dash, no double dash.'
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
        envVars: parseEnvText(envText.value),
        slug: finalSlug,
        visibility: visibility.value,
        previewPassword: visibility.value === 'password' ? previewPassword.value : undefined,
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

        <!-- 4. Boot environment variables -->
        <UFormField label="Boot environment variables">
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
          <small>Injected at launch and translated to preview URLs. The project's own .env file can be edited later in the run's integrated VS Code.</small>
        </UFormField>

        <!-- 5. Preview access -->
        <section class="flex flex-col gap-5 border-t border-default pt-5">
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
          <small class="-mt-3 text-muted">
            Private: logged-in admins only. Password: anyone with the URL plus the password.
            Public: anyone with the URL.
          </small>

          <UFormField
            v-if="visibility === 'password'"
            label="Preview password"
            required
            class="max-w-md"
          >
            <UInput
              v-model="previewPassword"
              type="password"
              placeholder="Shared with your testers"
              size="lg"
              block
            />
          </UFormField>

          <UFormField
            label="Slug strategy"
            class="max-w-md"
          >
            <URadioGroup
              v-model="slugMode"
              orientation="horizontal"
              :items="[
                { label: 'Random link', value: 'random' },
                { label: 'Custom slug', value: 'custom' },
              ]"
            />
          </UFormField>
          <small
            v-if="slugMode === 'random'"
            class="-mt-3 text-muted"
          >
            A random, unguessable URL. For public previews the URL itself is the secret.
          </small>

          <UFormField
            label="Preview URL slug"
            class="max-w-md"
          >
            <div class="flex gap-2">
              <UInput
                v-model="slug"
                :readonly="slugMode === 'random'"
                :placeholder="slugMode === 'random' ? 'generating…' : 'e.g. my-feature'"
                size="lg"
                class="flex-1"
                block
              />
              <UButton
                v-if="slugMode === 'random'"
                color="neutral"
                variant="outline"
                size="lg"
                icon="i-lucide-refresh-cw"
                aria-label="Generate a new random slug"
                @click="regenerateSlug"
              />
            </div>
            <div class="mt-1 flex items-center gap-1.5 text-xs">
              <span
                v-if="slugStatus === 'checking'"
                class="text-muted"
              >Checking…</span>
              <span
                v-else-if="slugStatus === 'available'"
                class="text-emerald-400"
              >Slug available</span>
              <span
                v-else-if="slugStatus === 'taken'"
                class="text-red-400"
              >Slug already in use</span>
              <span
                v-else-if="slugStatus === 'invalid'"
                class="text-red-400"
              >
                Lowercase letters, digits and dashes; no leading/trailing dash, no double dash.
              </span>
              <span
                v-else
                class="text-muted"
              >Preview URL: {{ slug || '…' }}.preview.&lt;base&gt;</span>
            </div>
          </UFormField>
        </section>

        <!-- 6. Upload placeholders (no function yet) -->
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

        <!-- 7. Launch -->
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
