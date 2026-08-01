import { eq } from 'drizzle-orm'
import { db } from '../db'
import { runs } from '../db/schema'

// No automatic mid-run resume. Any 'running' run at boot was interrupted by a
// restart; mark it 'failed' so the UI shows a real terminal state. 'queued'
// rows are left alone (crash-safe: the dispatcher picks them up).
export default defineNitroPlugin(() => {
  db.update(runs)
    .set({ status: 'failed', finishedAt: new Date() })
    .where(eq(runs.status, 'running'))
    .run()
})
