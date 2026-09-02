import {
  detectPackageManager,
  installDependencies,
  installDependenciesCommand,
  runScriptCommand,
  type PackageManagerName,
} from 'nypm'

export type { PackageManagerName }

export const packageManagers = ['npm', 'pnpm', 'yarn', 'bun', 'deno'] as const

export type PackageManager = (typeof packageManagers)[number]

export function isPackageManager(value: string): value is PackageManager {
  return (packageManagers as readonly string[]).includes(value)
}

export function packageManagerFromUserAgent(
  userAgent = process.env.npm_config_user_agent,
): PackageManager | undefined {
  const name = userAgent?.split(' ')[0]?.split('/')[0]
  return name !== undefined && isPackageManager(name) ? name : undefined
}

/**
 * The package manager that invoked us is the best signal, because a new project
 * has no lockfile of its own yet. Detection falls back to the surrounding
 * directory, which matters when the CLI is generating into an existing workspace.
 */
export async function resolvePackageManager(cwd: string): Promise<PackageManager> {
  const fromUserAgent = packageManagerFromUserAgent()
  if (fromUserAgent !== undefined) return fromUserAgent
  const detected = await detectPackageManager(cwd, { includeParentDirs: true })
  return detected !== undefined && isPackageManager(detected.name) ? detected.name : 'npm'
}

export function installCommand(packageManager: PackageManager): string {
  return installDependenciesCommand(packageManager)
}

export function runCommand(packageManager: PackageManager, script: string): string {
  return runScriptCommand(packageManager, script)
}

export type Installer = (options: {
  readonly cwd: string
  readonly packageManager: PackageManager
}) => Promise<void>

export const install: Installer = async ({ cwd, packageManager }) => {
  await installDependencies({ cwd, packageManager, silent: true })
}
