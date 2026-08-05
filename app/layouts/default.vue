<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { user, clear } = useUserSession()
const route = useRoute()

const NAV = [
  { label: 'Previews', icon: 'i-lucide-rocket', to: '/runs', match: ['/runs'] },
  { label: 'Settings', icon: 'i-lucide-settings-2', to: '/settings', match: ['/settings'] },
  { label: 'System', icon: 'i-lucide-server', to: '/system', match: ['/system'] },
]

const initials = computed(() => {
  const base = user.value?.name || user.value?.email || '?'
  return base.split(/[\s@.-]+/).map(s => s[0]).slice(0, 2).join('').toUpperCase()
})

async function logout() {
  await clear()
  await navigateTo('/login')
}

const userMenu: DropdownMenuItem[][] = [
  [
    { label: 'Logout', icon: 'i-lucide-log-out', onSelect: logout },
  ],
]
</script>

<template>
  <div class="relative flex h-screen overflow-hidden bg-(--surface-base) text-default">
    <KBgField />

    <aside
      class="relative z-20 flex h-full w-62 flex-none flex-col border-r border-default"
      style="background: color-mix(in oklab, var(--surface-elevated) 60%, transparent); backdrop-filter: blur(12px)"
    >
      <div class="flex items-center border-b border-muted px-5 pb-4.5 pt-5.5">
        <NuxtLink to="/settings">
          <KLogo :height="24" />
        </NuxtLink>
      </div>

      <nav class="flex flex-col gap-1 p-3">
        <div class="k-label px-3 pb-2 pt-1">
          Navigation
        </div>
        <NuxtLink
          v-for="item in NAV"
          :key="item.to"
          :to="item.to"
          class="group relative flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors"
          :class="item.match.some(m => route.path.startsWith(m))
            ? 'border-default bg-(--surface-glass) text-highlighted'
            : 'border-transparent text-muted hover:text-toned'"
          style="cursor: pointer"
        >
          <span
            v-if="item.match.some(m => route.path.startsWith(m))"
            class="absolute inset-y-2 -left-px w-0.5 rounded-sm bg-primary"
            style="box-shadow: 0 0 8px var(--primary)"
          />
          <UIcon
            :name="item.icon"
            class="size-4.5 flex-none"
            :class="item.match.some(m => route.path.startsWith(m)) ? 'text-primary' : 'text-dimmed'"
          />
          <span>{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <div class="mt-auto flex flex-col gap-3 p-4">
        <UDropdownMenu
          :items="userMenu"
          :content="{ side: 'top', align: 'start' }"
        >
          <button
            class="flex w-full items-center gap-2.5 rounded-md py-1 px-1 text-left transition-colors hover:bg-(--surface-glass)"
          >
            <span
              v-if="!user?.avatarUrl"
              class="grid size-7.5 flex-none place-items-center rounded-full border text-xs font-semibold text-primary"
              style="background: var(--on-primary); border-color: var(--primary-border); font-family: var(--font-mono)"
            >{{ initials }}</span>
            <UAvatar
              v-else
              :src="user.avatarUrl"
              :alt="user?.email"
              size="xs"
              class="flex-none"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-2sm leading-tight text-toned">
                {{ user?.name || user?.email }}
              </div>
              <div class="truncate text-2xs leading-snug text-dimmed">
                {{ user?.isOwner ? 'Owner' : 'Member' }}
              </div>
            </div>
            <UIcon
              name="i-lucide-settings-2"
              class="size-4 flex-none text-dimmed"
            />
          </button>
        </UDropdownMenu>
      </div>
    </aside>

    <main class="relative z-10 flex min-w-0 flex-1 flex-col">
      <div class="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div class="mx-auto max-w-480 px-8 py-7">
          <slot />
        </div>
      </div>
      <KFooter />
    </main>
  </div>
</template>
