<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const route = useRoute()

// Client-only: the fetch needs real HTTP cookies.
const { data: status } = await useFetch('/api/_setup/status', {
  server: false,
  query: computed(() => ({ invite: route.query.invite })),
})

const isInvite = computed(() => !!status.value?.invite)
const isConfigured = computed(() => !!status.value?.configured)

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  confirm: z.string(),
  name: z.string().optional(),
}).refine(d => d.password === d.confirm, {
  message: 'Passwords do not match',
  path: ['confirm'],
})

const state = reactive({
  email: '',
  password: '',
  confirm: '',
  name: '',
})

// Pre-fill email from invite
watchEffect(() => {
  if (status.value?.invite?.email) {
    state.email = status.value.invite.email
  }
})

const loading = ref(false)
const errorMsg = ref<string | null>(null)

const heading = computed(() => isInvite.value ? 'Accept your invite' : 'Create admin account')
const subtext = computed(() => isInvite.value
  ? 'Set your password to join this instance.'
  : 'This is the one-time setup. Create your admin account to claim this instance.')

async function onSubmit() {
  errorMsg.value = null
  const parsed = schema.safeParse(state)
  if (!parsed.success) {
    errorMsg.value = parsed.error.issues[0]?.message || 'Invalid input'
    return
  }

  loading.value = true
  try {
    await $fetch('/api/_setup/register', {
      method: 'POST',
      body: {
        email: state.email,
        password: state.password,
        name: state.name || undefined,
        invite: route.query.invite || undefined,
      },
    })
    await navigateTo('/')
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string }
    errorMsg.value = e?.data?.statusMessage || e?.statusMessage || 'Registration failed'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="k-card overflow-hidden p-8">
    <div class="flex flex-col items-center text-center">
      <KLogo :height="40" />
    </div>

    <template v-if="isConfigured && !isInvite">
      <UAlert
        color="success"
        variant="subtle"
        class="mt-6"
        title="Already set up"
        description="This instance already has an admin account."
      />
      <UButton
        to="/login"
        color="neutral"
        size="lg"
        block
        class="mt-6"
      >
        Go to login
      </UButton>
    </template>

    <template v-else>
      <div class="mt-6 text-center">
        <h2 class="text-lg font-semibold text-highlighted">
          {{ heading }}
        </h2>
        <p class="mt-2 text-2sm leading-relaxed text-muted">
          {{ subtext }}
        </p>
      </div>

      <UAlert
        v-if="errorMsg"
        color="error"
        variant="subtle"
        class="mt-6"
        title="Setup failed"
        :description="errorMsg"
      />

      <UForm
        :state="state"
        :schema="schema"
        class="mt-6 flex flex-col gap-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Name (optional)"
          name="name"
        >
          <UInput
            v-model="state.name"
            placeholder="Your name"
            size="lg"
            block
          />
        </UFormField>

        <UFormField
          label="Email"
          name="email"
        >
          <UInput
            v-model="state.email"
            type="email"
            placeholder="you@example.com"
            size="lg"
            block
            :disabled="isInvite"
            autocomplete="email"
          />
        </UFormField>

        <UFormField
          label="Password"
          name="password"
        >
          <UInput
            v-model="state.password"
            type="password"
            placeholder="At least 12 characters"
            size="lg"
            block
            autocomplete="new-password"
          />
        </UFormField>

        <UFormField
          label="Confirm password"
          name="confirm"
        >
          <UInput
            v-model="state.confirm"
            type="password"
            placeholder="********"
            size="lg"
            block
            autocomplete="new-password"
          />
        </UFormField>

        <UButton
          type="submit"
          color="primary"
          size="lg"
          block
          :loading="loading"
        >
          {{ isInvite ? 'Join instance' : 'Create account' }}
        </UButton>
      </UForm>
    </template>
  </div>
</template>
