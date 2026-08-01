import { randomBytes } from 'node:crypto'
import { eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { invites, users, type Invite, type User } from '../db/schema'

// The user store. Email normalization (lowercasing + trimming) lives here: the
// one place that touches the table. First-run setup claims the owner; the
// owner can then invite more users via /settings/users.

const norm = (email: string) => email.trim().toLowerCase()

export interface SessionUser {
  email: string
  name: string | null
  avatarUrl: string | null
  isOwner: boolean
}

export function listUsers(): User[] {
  return db.select().from(users).all()
}

export function getUserByEmail(email: string): User | undefined {
  return db.select().from(users).where(eq(users.email, norm(email))).get()
}

export function getUserById(id: number): User | undefined {
  return db.select().from(users).where(eq(users.id, id)).get()
}

export function userCount(): number {
  return db.select().from(users).all().length
}

export function hasOwner(): boolean {
  return db.select().from(users).where(eq(users.isOwner, true)).get() !== undefined
}

export function createUser(input: {
  email: string
  passwordHash: string
  name?: string | null
  avatarUrl?: string | null
  isOwner?: boolean
  invitedBy?: string | null
}): User {
  return db.insert(users)
    .values({
      email: norm(input.email),
      passwordHash: input.passwordHash,
      name: input.name ?? null,
      avatarUrl: input.avatarUrl ?? null,
      isOwner: input.isOwner ?? false,
      invitedBy: input.invitedBy ?? null,
    })
    .returning()
    .get()
}

export function touchProfile(email: string, name: string | null, avatarUrl: string | null): void {
  db.update(users)
    .set({ name, avatarUrl, updatedAt: new Date() })
    .where(eq(users.email, norm(email)))
    .run()
}

export function deleteUser(id: number): void {
  db.delete(users).where(eq(users.id, id)).run()
}

export function toSessionUser(user: User): SessionUser {
  return {
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isOwner: user.isOwner,
  }
}

// ── Invites ──────────────────────────────────────────────────────────────────

export function createInvite(email: string, createdBy: string): { id: number, token: string } {
  const token = randomBytes(32).toString('hex')
  const row = db.insert(invites)
    .values({
      email: norm(email),
      token,
      createdBy: norm(createdBy),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning()
    .get()
  return { id: row.id, token }
}

export function getInviteByToken(token: string): Invite | undefined {
  return db.select().from(invites).where(eq(invites.token, token)).get()
}

export function listOpenInvites(): Invite[] {
  return db.select().from(invites).where(isNull(invites.consumedAt)).all()
}

export function consumeInvite(id: number): void {
  db.update(invites)
    .set({ consumedAt: new Date() })
    .where(eq(invites.id, id))
    .run()
}

export function deleteInvite(id: number): void {
  db.delete(invites).where(eq(invites.id, id)).run()
}

export function isInviteOpen(invite: Invite): boolean {
  return !invite.consumedAt && invite.expiresAt > new Date()
}
