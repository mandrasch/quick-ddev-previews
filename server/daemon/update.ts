import { execa } from 'execa'
import { RELEASE_TAG_RE } from '../utils/version'

const IMAGE = 'ghcr.io/mandrasch/quick-ddev-previews'

// Self-update, Coolify-style: a container can't recreate itself, so a
// short-lived SIBLING container on the host daemon does it. The sibling runs
// the NEW release image (which ships git + docker CLI + compose, see the
// Dockerfile tooling stage), advances the /opt/quickddevpreviews checkout and
// the pinned QUICKDDEVPREVIEWS_VERSION in .env, then `docker compose up -d`
// recreates the app. Because the sibling lives on the host daemon it survives
// that recreate and finishes cleanly; --rm cleans it up afterwards.
//
// Fire and forget: `docker run -d` first pulls the new image (can take a
// minute), so the caller must not hang a request on it. Failures land in the
// server log; progress is observable via `docker logs quickddevpreviews-updater`.
export async function startUpdate(tag: string): Promise<void> {
  if (!RELEASE_TAG_RE.test(tag)) throw new Error(`Not a release tag: ${tag}`)
  const dir = process.env.QUICKDDEVPREVIEWS_INSTALL_DIR || '/opt/quickddevpreviews'

  const script = [
    'set -e',
    `git config --global --add safe.directory ${dir}`,
    'git fetch --tags origin',
    `git checkout -f ${tag}`,
    `sed -i 's/^QUICKDDEVPREVIEWS_VERSION=.*/QUICKDDEVPREVIEWS_VERSION=${tag}/' .env`,
    'docker compose pull -q',
    'docker compose up -d',
  ].join(' && ')

  // A wedged previous attempt must not block retries.
  await execa('docker', ['rm', '-f', 'quickddevpreviews-updater']).catch(() => {})

  execa('docker', [
    'run', '-d', '--rm', '--name', 'quickddevpreviews-updater',
    // Root inside the sibling: it edits the root-owned checkout and talks to
    // the socket without needing the group_add dance of the long-lived app.
    '-u', '0',
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', `${dir}:${dir}`, '-w', dir,
    `${IMAGE}:${tag}`, 'sh', '-c', script,
  ]).catch(err => console.error('[update] failed to start updater:', err))
}
