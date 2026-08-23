import * as React from 'react'
import { useImperativeHandle as useHandle } from 'react'

export function AliasedImperativeHandle({ ref }: { ref: React.Ref<{ ready: true }> }) {
  useHandle(ref, () => ({ ready: true }), [])
  return <output>aliased</output>
}

export function NamespacedImperativeHandle({ ref }: { ref: React.Ref<{ ready: true }> }) {
  React.useImperativeHandle(ref, () => ({ ready: true }), [])
  return <output>namespaced</output>
}
