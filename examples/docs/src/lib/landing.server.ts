import type { DocCodeLine } from './docs-types.ts'
import {
  branchSource,
  compiledCounter,
  counterSource,
  formSource,
  listSource,
  routeSource,
} from './landing-samples.ts'
import { highlightLines } from './mdx.server.ts'

export type LandingData = {
  readonly branch: readonly DocCodeLine[]
  readonly compiled: readonly DocCodeLine[]
  readonly counter: readonly DocCodeLine[]
  readonly form: readonly DocCodeLine[]
  readonly list: readonly DocCodeLine[]
  readonly route: readonly DocCodeLine[]
}

export async function loadLandingRoute(): Promise<LandingData> {
  return {
    branch: highlightLines(branchSource, 'tsx', 'branch'),
    compiled: highlightLines(compiledCounter, 'tsx', 'compiled'),
    counter: highlightLines(counterSource, 'tsx', 'counter'),
    form: highlightLines(formSource, 'tsx', 'form'),
    list: highlightLines(listSource, 'tsx', 'list'),
    route: highlightLines(routeSource, 'tsx', 'route'),
  }
}
