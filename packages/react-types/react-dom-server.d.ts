declare module 'react-dom/server' {
  export {
    renderToStaticMarkup,
    renderToString,
    type ServerChild,
    type ServerRenderOptions,
  } from '@vidact/runtime/server'
  export {
    renderToPipeableStream,
    renderToReadableStream,
    resume,
    resumeToPipeableStream,
    type FrameworkRenderOptions,
    type PipeableRenderOptions,
    type PipeableStream,
    type VidactReadableStream,
  } from '@vidact/runtime/framework/server'
}
