import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const server = spawn(process.execPath, ['dist/server/server.js'], {
  cwd: projectRoot,
  env: { ...process.env, PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stderr = ''
let browser
server.stderr.setEncoding('utf8')
server.stderr.on('data', (chunk) => {
  stderr += chunk
})

try {
  const baseUrl = await startedUrl(server)
  const health = await fetch(new URL('/health', baseUrl))
  const documentResponse = await fetch(baseUrl)
  const html = await documentResponse.text()
  const client = await fetch(new URL('/assets/client.js', baseUrl))
  const stylesheet = await fetch(new URL('/assets/style.css', baseUrl))

  assert(health.ok, `health request failed with ${health.status}`)
  assert((await health.json()).status === 'ok', 'health payload did not report ok')
  assert(documentResponse.ok, `shop document failed with ${documentResponse.status}`)
  assert(html.includes('data-server-component="shop-page"'), 'shop document lacks SSR content')
  assert(html.includes('/assets/client.js'), 'shop document lacks its client entry')
  assert(html.includes('/assets/style.css'), 'shop document lacks its stylesheet')
  assert(client.ok, `client asset failed with ${client.status}`)
  assert(stylesheet.ok, `stylesheet failed with ${stylesheet.status}`)

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.addInitScript(() => {
    Error.stackTraceLimit = 100
  })
  const browserErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message))

  let releaseClient
  const clientIntercepted = new Promise((resolve) => {
    page.route('**/assets/client.js', async (route) => {
      resolve()
      await new Promise((release) => {
        releaseClient = release
      })
      await route.continue()
    })
  })
  await page.goto(baseUrl.href, { waitUntil: 'commit' })
  await page.waitForSelector('.shop-shell')
  await clientIntercepted
  await page.evaluate(() => {
    globalThis.__shopIdentity = {
      shell: document.querySelector('.shop-shell'),
      search: document.querySelector('.search-field input'),
      category: document.querySelectorAll('.category-filters button')[2],
      product: document.querySelector('.product-card'),
    }
    globalThis.__shopHydrationRecords = []
    globalThis.__shopHydrationObserver = new MutationObserver((records) => {
      globalThis.__shopHydrationRecords.push(...records)
    })
    globalThis.__shopHydrationObserver.observe(document.querySelector('#shop-root'), {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })
  })
  releaseClient()
  await page.waitForLoadState('networkidle')

  const hydration = await page.evaluate(() => {
    globalThis.__shopHydrationRecords.push(...globalThis.__shopHydrationObserver.takeRecords())
    globalThis.__shopHydrationObserver.disconnect()
    const identity = globalThis.__shopIdentity
    const nodes = {
      shell: document.querySelector('.shop-shell'),
      search: document.querySelector('.search-field input'),
      category: document.querySelectorAll('.category-filters button')[2],
      product: document.querySelector('.product-card'),
    }
    const retained = Object.fromEntries(
      Object.keys(identity).map((key) => [key, identity[key] === nodes[key]]),
    )
    return {
      mutations: globalThis.__shopHydrationRecords.length,
      records: globalThis.__shopHydrationRecords.map((record) => ({
        type: record.type,
        target: record.target.nodeName,
        attributeName: record.attributeName,
        added: [...record.addedNodes].map((node) => node.nodeName),
        removed: [...record.removedNodes].map((node) => node.nodeName),
      })),
      retained,
    }
  })
  assert(
    Object.values(hydration.retained).every(Boolean),
    `production hydration replaced server nodes: ${JSON.stringify(hydration.retained)}; mutations=${hydration.mutations}; errors=${browserErrors.join(' | ')}`,
  )
  assert(
    hydration.mutations === 0,
    `production hydration caused ${hydration.mutations} DOM mutations: ${JSON.stringify(hydration.records)}`,
  )

  await page.getByRole('button', { name: 'Add Ridge Bottle to cart' }).click()
  await page.waitForFunction(() => document.querySelector('.cart-link')?.textContent.includes('1'))
  const responsive = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
  assert(responsive, 'narrow production shop overflows the viewport horizontally')
  assert(
    browserErrors.length === 0,
    `production browser reported errors:\n${browserErrors.join('\n')}`,
  )
  console.log(`Production shop smoke passed at ${baseUrl}`)
} finally {
  await browser?.close()
  await terminate(server)
}

function startedUrl(child) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    const timeout = setTimeout(() => {
      reject(new Error(`shop server did not start within 10 seconds\n${stderr}`))
    }, 10_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      const match = stdout.match(/https?:\/\/[^\s]+/)
      if (match === null) return
      clearTimeout(timeout)
      resolve(new URL(match[0]))
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`shop server exited before startup with code ${code}\n${stderr}`))
    })
  })
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const timeout = new Promise((resolve) => setTimeout(resolve, 2_000, 'timeout'))
  if ((await Promise.race([exited, timeout])) === 'timeout') child.kill('SIGKILL')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
