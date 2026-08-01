<script setup lang="ts">
import { z } from 'zod'

const { user } = useUserSession()
const isOwner = computed(() => user.value?.isOwner)

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

      <!-- ── GitHub integration stub ───────────────────────────────────────── -->
      <section class="k-card p-6">
        <div class="flex items-center gap-3">
          <UIcon
            name="i-simple-icons-github"
            class="size-5 text-toned"
          />
          <h2 class="text-lg font-semibold">
            GitHub Integration
          </h2>
        </div>
        <p class="mt-2 text-sm text-muted">
          Connect a GitHub App for repo access (cloning, pull requests, triggers).
          Available in Phase 2.
        </p>
        <UButton
          disabled
          color="neutral"
          variant="outline"
          class="mt-4"
          icon="i-simple-icons-github"
        >
          Connect GitHub (coming soon)
        </UButton>
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
