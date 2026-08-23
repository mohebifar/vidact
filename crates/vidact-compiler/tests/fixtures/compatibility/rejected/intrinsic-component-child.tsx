function ForeignObject({ children }) {
  return <foreignObject>{children}</foreignObject>
}

export function IntrinsicComponentChild() {
  return (
    <svg>
      <ForeignObject>
        <div />
      </ForeignObject>
    </svg>
  )
}
