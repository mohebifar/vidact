import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { expect, it } from 'vitest'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))

it('builds a portable Vercel function for page routes alongside public client assets', async () => {
  await exec(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.nitro.config.ts'],
    {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'production', NITRO_PRESET: 'vercel' },
    },
  )

  const temporary = await mkdtemp(join(tmpdir(), 'vidact-docs-vercel-'))
  try {
    // Only deployment files are available: no source tree or workspace node_modules.
    const output = join(temporary, 'output')
    await cp(join(root, '.vercel/output'), output, { recursive: true })
    const config = JSON.parse(await readFile(join(output, 'config.json'), 'utf8'))
    expect(config.version).toBe(3)
    expect(config.framework.name).toBe('nitro')
    expect(config.routes).toEqual([
      {
        src: '/assets/(.*)',
        headers: { 'cache-control': 'public, max-age=0, must-revalidate' },
      },
      { handle: 'filesystem' },
      { src: '/(.*)', dest: '/__server' },
    ])

    const functionDirectory = join(output, 'functions/__server.func')
    const functionConfig = JSON.parse(
      await readFile(join(functionDirectory, '.vc-config.json'), 'utf8'),
    )
    expect(functionConfig.runtime).toBe('nodejs24.x')
    expect(functionConfig.launcherType).toBe('Nodejs')

    const { stdout } = await exec(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          import { pathToFileURL } from 'node:url';
          const { default: handler } = await import(pathToFileURL(process.argv[1]).href);
            const origin = 'https://example.test';
            const responses = [];
            for (const [path, options] of [
              ['/', {}],
              ['/docs', {}],
              ['/docs/reference/react-compatibility', {}],
              ['/docs/getting-started/quick-start', { headers: { 'x-vidact-start-navigation': '1' } }],
              ['/docs/not-a-page', {}],
              ['/docs', { method: 'HEAD' }],
            ]) {
              const response = await handler.fetch(new Request(origin + path, options));
              responses.push({ status: response.status, type: response.headers.get('content-type'), body: await response.text() });
            }
            console.log(JSON.stringify(responses));
        `,
        join(functionDirectory, functionConfig.handler),
      ],
      { cwd: temporary },
    )
    const [landing, overview, reference, navigation, missing, head] = JSON.parse(stdout)
    expect(landing.status).toBe(200)
    expect(landing.body).toContain('<!doctype html>')
    expect(landing.body).toContain('/assets/client.js')
    expect(overview.status).toBe(200)
    expect(overview.body).toContain('Why Vidact?')
    expect(reference.status).toBe(200)
    expect(reference.body).toContain('How to read the tables')
    expect(navigation.status).toBe(200)
    expect(navigation.type).toContain('application/x-vidact-start+json')
    expect(navigation.body).toContain('Write a component')
    expect(navigation.body).not.toContain('<!doctype html>')
    expect(missing.status).toBe(404)
    expect(head.status).toBe(200)
    expect(head.body).toBe('')

    expect(await readFile(join(output, 'static/assets/client.js'), 'utf8')).not.toBe('')
    expect(await readFile(join(output, 'static/assets/style.css'), 'utf8')).not.toBe('')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}, 60_000)
