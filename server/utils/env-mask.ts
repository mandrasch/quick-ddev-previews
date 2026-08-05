// The .env editor masks stored values so secrets are never shown in plaintext.
// The run detail GET replaces every non-empty value with this sentinel; the
// editor's Save sends it back unchanged, and the server keeps the stored value
// for any sentinel it sees. Only values typed fresh (or cleared) reach the DB.
export const ENV_VALUE_MASK = '••••••••'

export interface EnvEntry {
  key: string
  value: string
}

export function maskEnvVars(envVars: EnvEntry[]): EnvEntry[] {
  return envVars.map(e => ({ key: e.key, value: e.value ? ENV_VALUE_MASK : '' }))
}

// Reconcile an edited set against the stored set: a sentinel value means "keep
// whatever was stored for this key", so unchanged secrets survive the round-trip.
export function unmaskEnvVars(stored: EnvEntry[], edited: EnvEntry[]): EnvEntry[] {
  const prev = new Map(stored.map(e => [e.key, e.value]))
  return edited.map(e => ({
    key: e.key,
    value: e.value === ENV_VALUE_MASK ? (prev.get(e.key) ?? '') : e.value,
  }))
}
