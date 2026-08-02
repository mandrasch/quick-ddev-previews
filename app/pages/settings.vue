<script setup lang="ts">
import { z } from 'zod'

const { user } = useUserSession()
const isOwner = computed(() => user.value?.isOwner)
const route = useRoute()

// ── Users + invites ──────────────────────────────────────────────────────────
const { data, refresh } = await useFetch('/api/users')

const inviteModal = ref(false)
const inviteEmail = ref('')
const inviteUrl = ref<string | null>(null)
const inviteError = ref<string | null>(null)
const inviteLoading = ref(false)

const inviteSchema = z.object({ email: z.string().email('Valid email required') })

async function createInvite() {
  inviteError.value = null
  inviteUrl.value = null
  const parsed = inviteSchema.safeParse({ email: inviteEmail.value })
  if (!parsed.success) {
    inviteError.value = parsed.error.issues[0]?.message || 'Invalid email'
    return
  }

  inviteLoading.value = true
  try {
    const res = await $fetch<{ url: string }>('/api/users/invite', {
      method: 'POST',
      body: { email: inviteEmail.value },
    })
    inviteUrl.value = res.url
    await refresh()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    inviteError.value = e?.data?.statusMessage || 'Failed to create invite'
  }
  finally {
    inviteLoading.value = false
  }
}

async function deleteUser(id: number, email: string) {
  if (!confirm(`Remove user ${email}?`)) return
  await $fetch(`/api/users/${id}`, { method: 'DELETE' })
  await refresh()
}

async function revokeInvite(id: number) {
  await $fetch(`/api/invites/${id}`, { method: 'DELETE' })
  await refresh()
}

function closeInviteModal() {
  inviteModal.value = false
  inviteEmail.value = ''
  inviteUrl.value = null
  inviteError.value = null
}

// ── GitHub integration ───────────────────────────────────────────────────────
// Client-only: the manifest endpoint sets an httpOnly CSRF-state cookie which
// only reaches the browser on a real HTTP response.
const ghInfo = ref<{ appId: string, slug: string | null, htmlUrl: string | null, clientId: string } | null>(null)
const ghManifest = ref<{ state: string, manifest: Record<string, unknown> } | null>(null)
const ghConnecting = ref(false)
const ghError = ref<string | null>(null)

async function loadGhInfo() {
  if (!isOwner.value) return
  ghInfo.value = await $fetch('/api/setup/github/info')
}

async function startGhConnect() {
  ghError.value = null
  ghConnecting.value = true
  try {
    const res = await $fetch<{ configured: boolean, state?: string, manifest?: Record<string, unknown> }>(
      '/api/setup/github/manifest',
    )
    if (res.configured) {
      await loadGhInfo()
      return
    }
    ghManifest.value = { state: res.state!, manifest: res.manifest! }
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    ghError.value = e?.data?.statusMessage || 'Failed to start GitHub App setup'
  }
  finally {
    ghConnecting.value = false
  }
}

const ghActionUrl = computed(() =>
  ghManifest.value ? `https://github.com/settings/apps/new?state=${ghManifest.value.state}` : '',
)

async function disconnectGh() {
  if (!confirm('Disconnect GitHub App? Repo access will stop immediately.')) return
  await $fetch('/api/setup/github', { method: 'DELETE' })
  ghInfo.value = null
  ghManifest.value = null
}

onMounted(async () => {
  await loadGhInfo()
  if (route.query.error === 'state') ghError.value = 'Setup session expired, please try again.'
  else if (route.query.error === 'conversion') ghError.value = 'GitHub could not create the app. Please try again.'
  // Auto-fetch the manifest + CSRF state so the connect button is ready.
  if (!ghInfo.value) await startGhConnect()
})

// ── Remote access (SSH target) ───────────────────────────────────────────────
const { data: settingsData } = await useFetch<{ sshTarget: string | null, sshTargetDefault: string | null }>('/api/settings')
const sshTarget = ref('')
const sshTargetSaved = ref('')

watch(settingsData, (s) => {
  if (!s) return
  if (sshTarget.value === sshTargetSaved.value) {
    sshTarget.value = s.sshTarget ?? ''
    sshTargetSaved.value = s.sshTarget ?? ''
  }
}, { immediate: true })

// Debounced save: keep the field editable while typing, persist ~800ms after
// the last keystroke.
let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(sshTarget, (val) => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    if (val === sshTargetSaved.value) return
    try {
      await $fetch('/api/settings', {
        method: 'PATCH',
        body: { sshTarget: val || null },
      })
      sshTargetSaved.value = val
    }
    catch {
      // Keep the field as typed; the next keystroke retries.
    }
  }, 800)
})
</script>

<template>
  <div>
    <div class="flex flex-col gap-8">
      <div>
        <h1 class="text-2xl font-bold text-highlighted">
          Settings
        </h1>
        <p class="mt-1 text-sm text-muted">
          Manage your instance
        </p>
      </div>

      <!-- ── GitHub integration ───────────────────────────────────────────── -->
      <section
        v-if="isOwner"
        class="k-card p-6"
      >
        <div class="flex items-center gap-3">
          <UIcon
            name="i-simple-icons-github"
            class="size-5 text-toned"
          />
          <h2 class="text-lg font-semibold">
            GitHub Integration
          </h2>
        </div>

        <UAlert
          v-if="ghError"
          color="error"
          variant="subtle"
          class="mt-4"
          title="GitHub setup failed"
          :description="ghError"
        />

        <template v-if="ghInfo">
          <p class="mt-2 text-sm text-muted">
            Connected as <span class="text-toned font-medium">{{ ghInfo.slug || ghInfo.appId }}</span>.
            Repo access is active for selected repositories.
          </p>
          <div class="mt-4 flex gap-2">
            <UButton
              :to="ghInfo.htmlUrl ? `${ghInfo.htmlUrl}/installations` : undefined"
              external
              color="neutral"
              variant="outline"
              icon="i-lucide-external-link"
            >
              Manage on GitHub
            </UButton>
            <UButton
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              @click="disconnectGh"
            >
              Disconnect
            </UButton>
          </div>
        </template>

        <template v-else>
          <p class="mt-2 text-sm text-muted">
            Connect a GitHub App for repo access (cloning, pull requests, triggers).
            Created under your personal account, then install it on the repos to manage.
          </p>

          <!-- Rendered from first paint so the button never pops in: it sits
               in a loading state until the manifest + CSRF state load, then enables. -->
          <form
            :action="ghActionUrl"
            method="post"
            class="mt-4"
          >
            <input
              type="hidden"
              name="manifest"
              :value="ghManifest ? JSON.stringify(ghManifest.manifest) : ''"
            >
            <UButton
              type="submit"
              icon="i-simple-icons-github"
              color="neutral"
              :loading="ghConnecting"
              :disabled="!ghManifest"
            >
              Create GitHub App
            </UButton>
          </form>
        </template>
      </section>

      <!-- ── Remote access (SSH target, owner only) ────────────────────────── -->
      <section
        v-if="isOwner"
        class="k-card p-6"
      >
        <h2 class="text-lg font-semibold">
          Remote access
        </h2>
        <p class="mt-2 text-sm text-muted">
          How do you reach this server over SSH? The run page's terminal modal
          uses this address to build the copy-pasteable SSH command. The web
          terminal works without it.
        </p>
        <UInput
          v-model="sshTarget"
          type="text"
          placeholder=""
          class="mt-4 max-w-md"
          block
        />
        <p class="mt-2 text-2xs text-dimmed">
          Default: {{ settingsData?.sshTargetDefault ?? 'not set' }}
        </p>
      </section>

      <!-- ── User management (owner only) ──────────────────────────────────── -->
      <section
        v-if="isOwner"
        class="k-card p-6"
      >
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">
            Users
          </h2>
          <UButton
            color="primary"
            size="sm"
            icon="i-lucide-user-plus"
            @click="inviteModal = true"
          >
            Invite user
          </UButton>
        </div>

        <div class="mt-4 flex flex-col gap-2">
          <div
            v-for="u in data?.users"
            :key="u.id"
            class="flex items-center justify-between rounded-lg border border-default px-4 py-3"
          >
            <div class="flex items-center gap-3">
              <div
                class="flex size-8 items-center justify-center rounded-full border text-sm font-semibold text-primary"
                style="border-color: var(--primary-border); background: var(--on-primary)"
              >
                {{ u.email[0]?.toUpperCase() }}
              </div>
              <div>
                <div class="text-sm font-medium text-toned">
                  {{ u.name || u.email }}
                </div>
                <div class="text-2xs text-dimmed">
                  {{ u.email }}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UBadge
                v-if="u.isOwner"
                color="primary"
                variant="subtle"
                size="sm"
              >
                Owner
              </UBadge>
              <UButton
                v-if="!u.isOwner && u.email !== user?.email"
                color="error"
                variant="ghost"
                size="sm"
                icon="i-lucide-trash-2"
                @click="deleteUser(u.id, u.email)"
              />
            </div>
          </div>
        </div>

        <!-- Open invites -->
        <template v-if="data?.invites.length">
          <h3 class="k-label mt-6 mb-3">
            Open invites
          </h3>
          <div class="flex flex-col gap-2">
            <div
              v-for="inv in data.invites"
              :key="inv.id"
              class="flex items-center justify-between rounded-lg border border-default px-4 py-3"
            >
              <div>
                <div class="text-sm font-medium text-toned">
                  {{ inv.email }}
                </div>
                <div class="text-2xs text-dimmed">
                  Expires {{ new Date(inv.expiresAt).toLocaleDateString() }}
                </div>
              </div>
              <UButton
                color="error"
                variant="ghost"
                size="sm"
                icon="i-lucide-x"
                @click="revokeInvite(inv.id)"
              />
            </div>
          </div>
        </template>
      </section>
    </div>

    <!-- ── Invite modal (owner only) ──────────────────────────────────────────── -->
    <UModal
      v-model:open="inviteModal"
      title="Invite user"
      :description="inviteUrl ? 'Share this one-time link with them.' : 'Enter the email to invite.'"
      @close="closeInviteModal"
    >
      <template #body>
        <template v-if="inviteUrl">
          <UInput
            :model-value="inviteUrl"
            readonly
            size="lg"
            block
            icon="i-lucide-link"
          />
          <p class="mt-3 text-2sm text-muted">
            This link expires in 7 days. No email is sent; share it directly.
          </p>
        </template>
        <template v-else>
          <UFormField
            label="Email"
            name="email"
          >
            <UInput
              v-model="inviteEmail"
              type="email"
              placeholder="you@example.com"
              size="lg"
              block
              @keydown.enter.prevent="createInvite"
            />
          </UFormField>
          <UAlert
            v-if="inviteError"
            color="error"
            variant="subtle"
            class="mt-4"
            :description="inviteError"
          />
        </template>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            @click="closeInviteModal"
          >
            {{ inviteUrl ? 'Done' : 'Cancel' }}
          </UButton>
          <UButton
            v-if="!inviteUrl"
            color="primary"
            :loading="inviteLoading"
            @click="createInvite"
          >
            Create invite
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
