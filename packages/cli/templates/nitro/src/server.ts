import { createStartHandler } from '@vidact/start/server'
import { routeManifest } from 'virtual:vidact-start/routes'

const development = import.meta.env.DEV

export default createStartHandler({
  manifest: routeManifest,
  clientEntry: development ? '/src/client.ts' : '/assets/client.js',
  renderDocument: ({
    applicationHtml,
    clientEntry,
    rootId,
    snapshot,
    snapshotId,
  }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="A full-stack application built with Vidact Start." />
    <title>{{projectName}}</title>
    <link rel="stylesheet" href="${development ? '/src/style.css' : '/assets/style.css'}" />
  </head>
  <body>
    <div id="${rootId}">${applicationHtml}</div>
    <script id="${snapshotId}" type="application/json">${snapshot}</script>
    <script type="module" src="${clientEntry}"></script>
  </body>
</html>`,
})
