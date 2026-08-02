<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const route = useRoute()

// An unconfigured instance has nothing to sign in to, so land visitors on the
// setup page directly. Client-only: the fetch needs real HTTP cookies.
const { data: setupStatus } = await useFetch('/api/_setup/status', { server: false })
watch(setupStatus, (s) => {
  if (s && !s.configured) navigateTo('/setup', { replace: true })
}, { immediate: true })

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

const state = reactive({ email: '', password: '' })
const loading = ref(false)
const errorMsg = ref<string | null>(null)

if (route.query.error) {
  errorMsg.value = 'Invalid email or password'
}

async function onSubmit() {
  errorMsg.value = null
  const parsed = schema.safeParse(state)
  if (!parsed.success) {
    errorMsg.value = parsed.error.issues[0]?.message || 'Invalid input'
    return
  }

  loading.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { email: state.email, password: state.password },
    })
    await navigateTo('/')
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string }
    errorMsg.value = e?.data?.statusMessage || e?.statusMessage || 'Login failed'
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
      <p class="mt-4 text-2sm text-muted">
        Sign in to your instance
      </p>
    </div>

    <UAlert
      v-if="errorMsg"
      color="error"
      variant="subtle"
      class="mt-6"
      title="Login failed"
      :description="errorMsg"
    />

    <UForm
      :state="state"
      :schema="schema"
      class="mt-6 flex flex-col gap-4"
      @submit="onSubmit"
    >
      <UFormField
        label="Email"
        name="email"
        class="max-w-md"
      >
        <UInput
          v-model="state.email"
          type="email"
          placeholder="you@example.com"
          size="lg"
          class="w-full"
          block
          autocomplete="email"
        />
      </UFormField>

      <UFormField
        label="Password"
        name="password"
        class="max-w-md"
      >
        <UInput
          v-model="state.password"
          type="password"
          placeholder="********"
          size="lg"
          class="w-full"
          block
          autocomplete="current-password"
        />
      </UFormField>

      <UButton
        type="submit"
        color="primary"
        size="lg"
        block
        :loading="loading"
      >
        Sign in
      </UButton>
    </UForm>
  </div>
</template>
