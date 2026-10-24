// Records the Unfold Stage 2 demo video from the real UI in mock mode.
// Usage (from the repository root): node demo/record-demo.mjs
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(repoRoot, 'apps/web/package.json'))
const { chromium, expect } = require('@playwright/test')

const PROMPT = 'I want to start a neighborhood bakery for busy families.'
const DEMO_DB = 'unfold_demo'
const DATABASE_URL = `mysql://unfold:unfold@localhost:${process.env.MYSQL_PORT ?? '3306'}/${DEMO_DB}`
const SERVER_URL = 'http://127.0.0.1:3001'
const WEB_URL = 'http://127.0.0.1:5173'
const VIEWPORT = { width: 1440, height: 750 }
const SCALE = 4 / 3
const FRAME = { width: 1920, height: 1000 }
const CAPTION_HEIGHT = 80
const FPS = 30
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
const output = resolve(
  repoRoot,
  process.env.DEMO_OUTPUT ?? 'demo/unfold-stage2-demo.mp4',
)

const work = mkdtempSync(join(tmpdir(), 'unfold-demo-'))
const framesDir = join(work, 'frames')
mkdirSync(framesDir)
const children = []

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`)
  }
}

function startService(name, args, env) {
  const child = spawn('pnpm', args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (chunk) => (log += chunk))
  child.stderr.on('data', (chunk) => (log += chunk))
  children.push({ name, child, log: () => log })
}

async function waitFor(url, check = () => true) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok && check(await response.text())) return
    } catch {
      // Service is still starting.
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function stopServices() {
  for (const { child } of children) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // Already exited.
    }
  }
}

async function prepareServices() {
  run('docker', [
    'compose',
    'exec',
    '-T',
    'mysql',
    'mysql',
    '-uroot',
    '-punfold-root',
    '-e',
    `DROP DATABASE IF EXISTS ${DEMO_DB}; CREATE DATABASE ${DEMO_DB}; GRANT ALL PRIVILEGES ON ${DEMO_DB}.* TO 'unfold'@'%';`,
  ])
  const serverEnv = {
    MODEL_MODE: 'mock',
    MODEL_API_KEY: '',
    NODE_ENV: 'development',
    PORT: '3001',
    DATABASE_URL,
  }
  run(
    'pnpm',
    ['--filter', '@unfold/server', 'exec', 'tsx', 'src/db/migrate.ts'],
    serverEnv,
  )
  startService(
    'server',
    ['--filter', '@unfold/server', 'exec', 'tsx', 'src/index.ts'],
    serverEnv,
  )
  startService('web', [
    '--filter',
    '@unfold/web',
    'exec',
    'vite',
    '--strictPort',
    '--host',
    '127.0.0.1',
  ])
  await waitFor(`${SERVER_URL}/health`, (body) => {
    const health = JSON.parse(body)
    if (health.modelMode !== 'mock')
      throw new Error('Server is not in mock mode')
    return true
  })
  await waitFor(WEB_URL)
}

const captions = []
function caption(text) {
  const at = Date.now() / 1000
  const previous = captions.at(-1)
  if (previous) previous.end = at
  captions.push({ text, start: at, end: null })
}

async function record() {
  const browser = await chromium.launch()
  try {
    return await recordWith(browser)
  } finally {
    await browser.close()
  }
}

async function recordWith(browser) {
  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
  })
  const browserErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto(WEB_URL)
  await page.getByRole('textbox', { name: 'Your prompt' }).waitFor()
  await page.getByTestId('mock-model-badge').waitFor()
  await page.waitForTimeout(800)

  const frames = []
  const pendingWrites = []
  const cdp = await page.context().newCDPSession(page)
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(
      framesDir,
      `${String(frames.length).padStart(5, '0')}.png`,
    )
    frames.push({ file, timestamp: metadata.timestamp })
    pendingWrites.push(
      Promise.resolve().then(() => writeFileSync(file, data, 'base64')),
    )
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', {
    format: 'png',
    maxWidth: FRAME.width,
    maxHeight: FRAME.height,
    everyNthFrame: 1,
  })

  const pause = (ms) => page.waitForTimeout(ms)
  const ideas = page.getByTestId('graph-node-idea')
  const inspector = page.getByTestId('inspector-panel')
  const idea = (title, label) =>
    ideas.filter({ hasText: title }).filter({ hasText: label })

  async function scrollInspectorTo(locator) {
    const panel = await inspector.boundingBox()
    await page.mouse.move(panel.x + panel.width / 2, panel.y + panel.height / 2)
    const header = await inspector.locator('.inspector-header').boundingBox()
    const target = await locator.boundingBox()
    const distance = target.y - (header.y + header.height + 12)
    const steps = Math.max(1, Math.round(Math.abs(distance) / 30))
    for (let step = 0; step < steps; step += 1) {
      await page.mouse.wheel(0, distance / steps)
      await pause(16)
    }
    await pause(300)
  }
  const section = (heading) =>
    inspector.locator('.inspector-section').filter({ hasText: heading }).first()

  async function openIdea(locator) {
    await locator.hover()
    await pause(450)
    await locator.click()
    await inspector.waitFor()
    await pause(500)
  }

  async function closeInspector() {
    const graph = page.locator('.workspace-graph')
    const narrowWidth = (await graph.boundingBox()).width
    await page.getByRole('button', { name: 'Close inspector' }).click()
    await inspector.waitFor({ state: 'detached' })
    await expect
      .poll(async () => (await graph.boundingBox()).width)
      .toBeGreaterThan(narrowWidth + 100)
    await pause(300)
    await page.getByRole('button', { name: /fit view/i }).click()
    await pause(500)
  }

  async function expand(operator) {
    const button = page.getByRole('button', {
      name: new RegExp(`^${operator}`),
    })
    await scrollInspectorTo(button)
    await button.hover()
    await pause(500)
    await button.click()
    await page.getByText('New directions added').waitFor()
  }

  // 1. Fixed prompt
  caption('A fixed, underspecified prompt')
  await pause(900)
  const promptBox = page.getByRole('textbox', { name: 'Your prompt' })
  await promptBox.click()
  await promptBox.pressSequentially(PROMPT, { delay: 32 })
  await pause(1200)

  // 2. Initial directions
  await page.getByRole('button', { name: 'Unfold' }).hover()
  await pause(400)
  await page.getByRole('button', { name: 'Unfold' }).click()
  await page.getByTestId('graph-node-root').waitFor()
  await ideas.first().waitFor()
  caption('The original prompt becomes the root, with four initial directions')
  await pause(3600)

  // 3. Inspect a direction
  const direction = idea(
    'Test a low-cost version of a neighborhood bakery',
    'Direction',
  )
  await openIdea(direction)
  caption('Each direction states its preserved intent, assumptions, and fit')
  await pause(4200)
  caption('...its strongest objection and a concrete first test')
  await scrollInspectorTo(section('Strongest objection'))
  await pause(3600)
  caption('...and the hypothesis it rests on, labeled as not confirmed intent')
  await scrollInspectorTo(section('Hypothesis'))
  await pause(3400)

  // 4. Pin
  caption('Pin the direction to keep it')
  const pin = page.getByRole('button', { name: 'Pin', exact: true })
  await scrollInspectorTo(pin)
  await pin.hover()
  await pause(500)
  await pin.click()
  await page.getByRole('button', { name: 'Unpin' }).waitFor()
  await pause(1400)

  // 5. GROUND
  caption('GROUND makes it more concrete and testable')
  await expand('Ground')
  await pause(1200)
  await closeInspector()
  caption('GROUND children are persisted under the pinned direction')
  await pause(3200)

  // 6. LEAP
  const grounded = ideas.filter({ hasText: 'GROUND ·' }).first()
  await openIdea(grounded)
  caption('LEAP explores a more distant jump from a grounded direction')
  await pause(1500)
  await expand('Leap')
  await pause(1000)
  await closeInspector()
  const leap = ideas.filter({ hasText: 'LEAP · leap' }).first()
  await openIdea(leap)
  caption(
    "LEAP children are marked 'leap' distance and keep the parent's preserved intent",
  )
  await scrollInspectorTo(section('Preserved intent'))
  await pause(4200)
  await closeInspector()

  // 7. Expanded graph
  caption('Prompt → directions → GROUND children → LEAP branch')
  await pause(3800)

  // 8. Reload
  caption('Reloading the app...')
  await page.reload()
  await page.getByTestId('graph-node-root').waitFor()
  await ideas.first().waitFor()
  caption('After reload, the graph, pin, and branches are restored from MySQL')
  await pause(3600)

  // 9. Final view
  caption('Unfold - deterministic mock data, not live-model output')
  await pause(3000)

  const ideaCount = await ideas.count()
  const pinned = await idea(
    'Test a low-cost version of a neighborhood bakery',
    'Pinned',
  ).count()
  const groundCount = await ideas.filter({ hasText: 'GROUND · near' }).count()
  const leapCount = await ideas.filter({ hasText: 'LEAP · leap' }).count()
  const mockBadge = await page.getByTestId('mock-model-badge').isVisible()

  await cdp.send('Page.stopScreencast')
  await Promise.all(pendingWrites)
  captions.at(-1).end = Date.now() / 1000

  const summary = { ideaCount, pinned, groundCount, leapCount, mockBadge }
  console.log('Persisted graph after reload:', JSON.stringify(summary))
  if (!mockBadge || pinned !== 1 || groundCount < 1 || leapCount < 1) {
    throw new Error('Reloaded graph does not show the expected persisted state')
  }
  if (browserErrors.length) {
    throw new Error(`Browser errors:\n${browserErrors.join('\n')}`)
  }
  return frames
}

function encode(frames) {
  // Screencast timestamps and caption times both use wall-clock seconds.
  const first = frames[0].timestamp
  const end = captions.at(-1).end - first
  if (Math.abs(captions[0].start - first) > 60) {
    throw new Error('Screencast timestamps are not wall-clock seconds')
  }
  const lines = []
  frames.forEach((frame, index) => {
    const next = frames[index + 1]?.timestamp ?? first + end
    const duration = Math.max(0.001, next - frame.timestamp)
    lines.push(`file '${frame.file}'`, `duration ${duration.toFixed(4)}`)
  })
  lines.push(`file '${frames.at(-1).file}'`)
  const list = join(work, 'frames.txt')
  writeFileSync(list, `${lines.join('\n')}\n`)

  const filters = [
    `fps=${FPS}`,
    `scale=${FRAME.width}:${FRAME.height}:flags=lanczos`,
    `pad=${FRAME.width}:${FRAME.height + CAPTION_HEIGHT}:0:0:color=0x2c2a25`,
  ]
  console.log(
    captions
      .map((c) => `${(c.start - first).toFixed(1)}s ${c.text}`)
      .join('\n'),
  )
  captions.forEach((entry, index) => {
    const textFile = join(work, `caption-${index}.txt`)
    writeFileSync(textFile, entry.text)
    const start = Math.max(0, entry.start - first).toFixed(3)
    const stop = (entry.end - first).toFixed(3)
    filters.push(
      `drawtext=fontfile=${FONT}:textfile=${textFile}:fontsize=32:fontcolor=0xf5f3ee:` +
        `x=(w-text_w)/2:y=${FRAME.height}+(${CAPTION_HEIGHT}-text_h)/2:` +
        `enable='between(t,${start},${stop})'`,
    )
  })
  filters.push('format=yuv420p')

  mkdirSync(dirname(output), { recursive: true })
  run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-tune',
    'stillimage',
    '-movflags',
    '+faststart',
    '-an',
    output,
  ])
  console.log(`Wrote ${output} (${end.toFixed(1)}s, ${frames.length} frames)`)
}

try {
  await prepareServices()
  encode(await record())
} catch (error) {
  for (const { name, log } of children) {
    console.error(`--- ${name} log ---\n${log().slice(-4000)}`)
  }
  console.error(error)
  process.exitCode = 1
} finally {
  stopServices()
  rmSync(work, { recursive: true, force: true })
}
