import { hydrateStart } from '@vidact/start/client'
import { routeManifest } from 'virtual:vidact-start/routes'

import './style.css'

await hydrateStart({ manifest: routeManifest })
