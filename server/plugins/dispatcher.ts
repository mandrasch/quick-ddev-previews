import { dispatchRuns } from '../daemon/runner'

// Safety net: dispatch queued runs every 10s. Enqueue points poke dispatchRuns
// directly for instant starts; this interval only catches what a poke missed
// (queued rows from a restart, a poke lost to a crash).
export default defineNitroPlugin(() => {
  setInterval(() => {
    void dispatchRuns()
  }, 10_000)
})
