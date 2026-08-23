import { useState } from 'react'

function unsupportedStateFactory() {
  return useState(0)
}

export function ResidualStateCall() {
  return <p>static</p>
}
