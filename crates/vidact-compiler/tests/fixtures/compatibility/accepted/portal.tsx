import { createPortal } from 'react-dom'

const target = document.createElement('aside')

function PortalChild() {
  return <strong>Portal child</strong>
}

export function Portal() {
  return createPortal(<PortalChild />, target)
}
