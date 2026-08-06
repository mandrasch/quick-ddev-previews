import { IDE_LABEL, parsePreviewHost } from '../../shared/utils/preview-host'
import { proxyRunIde } from '../utils/ide-proxy'
import { proxyRunPreview } from '../utils/preview-proxy'

// Requests to a preview host (shared/utils/preview-host.ts) are served
// entirely from that run's isolated ddev environment (see preview-proxy.ts),
// except the reserved `ide` label, which serves the run's web IDE instead
// (utils/ide-proxy.ts). Everything else falls through to the normal app.
export default defineEventHandler((event) => {
  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  const ref = parsePreviewHost(host)
  if (!ref) return

  if (ref.label === IDE_LABEL) {
    return proxyRunIde(event, ref.slug)
  }
  return proxyRunPreview(event, ref)
})
