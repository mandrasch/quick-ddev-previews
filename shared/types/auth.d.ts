// Types the auth session everywhere. `user` is what we set in the login and
// register endpoints: identity only. Phase 2's GitHub credentials live in
// the DB, not the session.
declare module '#auth-utils' {
  interface User {
    email: string
    name: string | null
    avatarUrl: string | null
    isOwner: boolean
  }
}

export {}
