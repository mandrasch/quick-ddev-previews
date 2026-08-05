// The .env textbox format (KEY=VALUE lines) shared by the launcher and the run
// page's .env editor. Values from the run GET are masked with a sentinel
// (server/utils/env-mask.ts); sending them back unchanged keeps the stored
// secret, so the editor never shows plaintext values.

export interface EnvEntry {
  key: string
  value: string
}

export function parseEnvText(text: string): EnvEntry[] {
  return text.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map((line) => {
      const eq = line.indexOf('=')
      if (eq === -1) return null
      return { key: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() }
    })
    .filter((x): x is EnvEntry => x !== null)
}

export function formatEnvText(envVars: EnvEntry[]): string {
  return envVars.map(e => `${e.key}=${e.value}`).join('\n')
}
