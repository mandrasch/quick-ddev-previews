import { parsePreviewHost } from '../../shared/utils/preview-host'
import { proxyRunPreview } from '../utils/preview-proxy'

// Requests to a preview host (shared/utils/preview-host.ts) are served
// entirely from that run's isolated ddev environment (see preview-proxy.ts).
// Everything else falls through to the normal app.
export default defineEventHandler(async (event) => {
  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  const ref = parsePreviewHost(host)
  if (!ref) return

  await proxyRunPreview(event, ref.runId, ref.label)
})
