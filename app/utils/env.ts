// The .env textbox format (KEY=VALUE lines) used by the launcher to collect
// boot-time env vars. These are injected into the run's ddev environment and
// translated to preview origins at launch; the project's own `.env` file is
// edited later inside the run's integrated VS Code.

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
