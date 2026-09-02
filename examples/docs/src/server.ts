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
    <meta name="description" content="Vidact compiles React components into direct DOM code. No Virtual DOM, no React runtime." />
    <title>Vidact</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="${development ? '/src/style.css' : '/assets/style.css'}" />
  </head>
  <body>
    <div id="${rootId}">${applicationHtml}</div>
    <script id="${snapshotId}" type="application/json">${snapshot}</script>
    <script type="module" src="${clientEntry}"></script>
  </body>
</html>`,
})
