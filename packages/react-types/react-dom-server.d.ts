declare module 'react-dom/server' {
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
