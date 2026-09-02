/**
 * Minimal GLB reader for the logo mesh: one primitive with float32 POSITION
 * and NORMAL attributes and uint16 indices, which is what Blender's default
 * glTF export produces for a single object.
 */

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942
const FLOAT32 = 5126
const UINT16 = 5123

type GltfJson = {
  readonly accessors: readonly {
    readonly bufferView: number
    readonly byteOffset?: number
    readonly componentType: number
    readonly count: number
  }[]
  readonly bufferViews: readonly {
    readonly byteLength: number
    readonly byteOffset?: number
  }[]
  readonly meshes: readonly {
    readonly primitives: readonly {
      readonly attributes: { readonly NORMAL: number; readonly POSITION: number }
      readonly indices: number
    }[]
  }[]
}

export type LogoMesh = {
  readonly indices: Uint16Array<ArrayBuffer>
  readonly normals: Float32Array<ArrayBuffer>
  /** Centered at the origin and scaled so the bounding radius is 1. */
  readonly positions: Float32Array<ArrayBuffer>
}

export function parseLogoMesh(data: ArrayBuffer): LogoMesh {
  const header = new DataView(data)
  if (header.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file')

  let json: GltfJson | undefined
  let binary: ArrayBuffer | undefined
  let offset = 12
  while (offset < data.byteLength) {
    const length = header.getUint32(offset, true)
    const type = header.getUint32(offset + 4, true)
    const chunk = data.slice(offset + 8, offset + 8 + length)
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(chunk)) as GltfJson
    if (type === CHUNK_BIN) binary = chunk
    offset += 8 + length + ((4 - (length % 4)) % 4)
  }
  if (json === undefined || binary === undefined) throw new Error('GLB chunks are missing')

  const primitive = json.meshes[0]?.primitives[0]
  if (primitive === undefined) throw new Error('GLB has no mesh primitive')

  const floats = (accessorIndex: number, components: number): Float32Array => {
    const accessor = json.accessors[accessorIndex]!
    if (accessor.componentType !== FLOAT32) throw new Error('expected float32 accessor')
    const view = json.bufferViews[accessor.bufferView]!
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    return new Float32Array(binary, start, accessor.count * components)
  }

  const indexAccessor = json.accessors[primitive.indices]!
  if (indexAccessor.componentType !== UINT16) throw new Error('expected uint16 indices')
  const indexView = json.bufferViews[indexAccessor.bufferView]!
  const indices = new Uint16Array(
    binary,
    (indexView.byteOffset ?? 0) + (indexAccessor.byteOffset ?? 0),
    indexAccessor.count,
  )

  const positions = new Float32Array(floats(primitive.attributes.POSITION, 3))
  const normals = new Float32Array(floats(primitive.attributes.NORMAL, 3))

  // Center on the bounding-box center, then normalize the bounding radius.
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, positions[i + axis]!)
      max[axis] = Math.max(max[axis]!, positions[i + axis]!)
    }
  }
  const center = [0, 1, 2].map((axis) => (min[axis]! + max[axis]!) / 2)
  let radiusSquared = 0
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]! - center[0]!
    const y = positions[i + 1]! - center[1]!
    const z = positions[i + 2]! - center[2]!
    radiusSquared = Math.max(radiusSquared, x * x + y * y + z * z)
  }
  const scale = 1 / Math.sqrt(radiusSquared)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i]! - center[0]!) * scale
    positions[i + 1] = (positions[i + 1]! - center[1]!) * scale
    positions[i + 2] = (positions[i + 2]! - center[2]!) * scale
  }

  return { indices: new Uint16Array(indices), normals, positions }
}

export type LogoEdges = {
  /** Averaged normal of the two faces meeting at each line vertex. */
  readonly normals: Float32Array<ArrayBuffer>
  /** Line-list positions: two vertices per feature edge. */
  readonly positions: Float32Array<ArrayBuffer>
}

/**
 * Feature edges of the mesh: boundaries and creases sharper than `minAngle`
 * degrees. Blender exports flat-shaded faces with split vertices, so edges are
 * matched by position rather than by index.
 */
export function featureEdges(mesh: LogoMesh, minAngle: number): LogoEdges {
  const { indices, positions } = mesh
  const threshold = Math.cos((minAngle * Math.PI) / 180)
  const key = (vertex: number) =>
    [0, 1, 2].map((axis) => positions[vertex * 3 + axis]!.toFixed(4)).join(',')
  const faces = new Map<string, { a: number; b: number; normals: number[][] }>()

  for (let i = 0; i < indices.length; i += 3) {
    const corners = [indices[i]!, indices[i + 1]!, indices[i + 2]!]
    const point = (vertex: number) => [0, 1, 2].map((axis) => positions[vertex * 3 + axis]!)
    const [p0, p1, p2] = corners.map(point) as [number[], number[], number[]]
    const u = [p1[0]! - p0[0]!, p1[1]! - p0[1]!, p1[2]! - p0[2]!]
    const v = [p2[0]! - p0[0]!, p2[1]! - p0[1]!, p2[2]! - p0[2]!]
    const normal = normalize([
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ])
    for (let edge = 0; edge < 3; edge += 1) {
      const a = corners[edge]!
      const b = corners[(edge + 1) % 3]!
      const [ka, kb] = [key(a), key(b)]
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      const entry = faces.get(id)
      if (entry === undefined) faces.set(id, { a, b, normals: [normal] })
      else entry.normals.push(normal)
    }
  }

  const lines: number[] = []
  const lineNormals: number[] = []
  for (const { a, b, normals } of faces.values()) {
    const [n0, n1] = normals
    if (n0 === undefined) continue
    const crease = n1 === undefined || dot(n0, n1) < threshold
    if (!crease) continue
    const average = normalize(n1 === undefined ? n0 : n0.map((value, axis) => value + n1[axis]!))
    for (const vertex of [a, b]) {
      lines.push(positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!)
      lineNormals.push(average[0]!, average[1]!, average[2]!)
    }
  }
  return { normals: new Float32Array(lineNormals), positions: new Float32Array(lines) }
}

function dot(a: number[], b: number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
}

function normalize(vector: number[]): number[] {
  const length = Math.sqrt(dot(vector, vector)) || 1
  return vector.map((value) => value / length)
}
