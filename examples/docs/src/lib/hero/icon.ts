/**
 * Renders one still frame of the crystal into an offscreen target: the same
 * mesh, shaders, and material as the animated hero, framed square and centered
 * with no stage floor behind it. `scripts/render-icons.mjs` runs this headlessly
 * through Dawn to bake the favicon and the header mark.
 */
import {
  draw,
  effect,
  frame,
  geometry,
  sampler,
  target,
  uniforms,
  type Gpu,
  type Target,
} from 'vgpu'
import { perspectiveCamera } from 'vgpu/scene'

import bloomWgsl from './bloom.wgsl'
import copyWgsl from './copy.wgsl'
import edgeWgsl from './edge.wgsl'
import envWgsl from './env.wgsl'
import glassBackWgsl from './glass-back.wgsl'
import glassFrontWgsl from './glass-front.wgsl'
import glassMidWgsl from './glass-mid.wgsl'
import { featureEdges, parseLogoMesh } from './glb.ts'
import presentWgsl from './present.wgsl'
import {
  ABSORPTION,
  BASE_TILT,
  BASE_YAW,
  BLOOM_STRENGTH,
  BLOOM_THRESHOLD,
  CAMERA_DISTANCE,
  CRYSTAL_SCALE,
  DISPERSION,
  EDGE_ANGLE,
  ENV_SIZE,
  ENVIRONMENT_EXPOSURE,
  FOV,
  HDR,
  IOR,
  IRIDESCENCE,
  modelMatrix,
  REFLECTION_STRENGTH,
  REFRACTION_WARP,
  SURFACE_BODY,
} from './tuning.ts'

/** Fills more of the square than the hero framing, which leaves room for a floor. */
const ICON_SCALE = CRYSTAL_SCALE * 1.12
/** Turned slightly further into the light than the resting hero pose. */
const ICON_YAW = BASE_YAW + 0.1
const ICON_TILT = BASE_TILT - 0.06

/**
 * Which surface the icon will sit on. The hero's smoky obsidian reads as a dark
 * mark on a light page, but on a dark one it collapses into the background, so
 * the dark variant drinks far less light and is exposed harder: the same glass,
 * lit for a dark room.
 */
export type IconSurface = 'dark' | 'light'

const SURFACES = {
  light: {
    absorption: ABSORPTION,
    bloomStrength: BLOOM_STRENGTH,
    exposure: ENVIRONMENT_EXPOSURE,
    iridescence: IRIDESCENCE,
  },
  dark: {
    // Nearly clear glass under a much brighter studio: the facets read as
    // polished chrome instead of obsidian, so the mark holds its shape against
    // a dark page and in a dark tab strip.
    absorption: [0.05, 0.045, 0.04] as const,
    bloomStrength: BLOOM_STRENGTH * 1.35,
    exposure: ENVIRONMENT_EXPOSURE * 4.6,
    iridescence: IRIDESCENCE * 1.8,
  },
} as const satisfies Record<IconSurface, unknown>

export type IconRender = {
  readonly height: number
  /** Straight (un-premultiplied) RGBA8. */
  readonly pixels: Uint8Array
  readonly width: number
}

/**
 * Renders the crystal at `size` x `size` device pixels on a transparent
 * background. `glb` is the raw logo.glb, which the caller reads however it can.
 */
export async function renderCrystalIcon(
  gpu: Gpu,
  {
    glb,
    size,
    surface = 'light',
  }: {
    readonly glb: ArrayBuffer
    readonly size: number
    readonly surface?: IconSurface
  },
): Promise<IconRender> {
  const material = SURFACES[surface]
  const envSampler = sampler(gpu, {
    addressModeU: 'repeat',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
  })
  const screenSampler = sampler(gpu, {
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
  })

  const envTarget = target(gpu, { format: HDR, size: [...ENV_SIZE] })
  const bakeEnv = effect(gpu, envWgsl)

  const mesh = parseLogoMesh(glb)
  const logoGeometry = geometry(gpu, {
    buffers: [
      { attributes: { position: 'float32x3' }, data: mesh.positions },
      { attributes: { normal: 'float32x3' }, data: mesh.normals },
    ],
    indices: mesh.indices,
  })
  const edges = featureEdges(mesh, EDGE_ANGLE)
  const edgeGeometry = geometry(gpu, {
    buffers: [
      { attributes: { position: 'float32x3' }, data: edges.positions },
      { attributes: { normal: 'float32x3' }, data: edges.normals },
    ],
    topology: 'line-list',
  })

  const camera = perspectiveCamera({
    aspect: 1,
    far: 20,
    fov: FOV,
    near: 0.1,
    position: [0, 0, CAMERA_DISTANCE],
    target: [0, 0, 0],
  })
  const glassUniforms = uniforms(gpu, {
    absorption: material.absorption,
    body: SURFACE_BODY,
    bounding_radius: ICON_SCALE,
    camera_position: [0, 0, CAMERA_DISTANCE],
    dispersion: DISPERSION,
    environment_exposure: material.exposure,
    // No floor in the icon framing, so the fade below it never applies.
    floor_y: -1000,
    fresnel_f0: ((IOR - 1) / (IOR + 1)) ** 2,
    ior: IOR,
    iridescence: material.iridescence,
    warp: REFRACTION_WARP,
    model: modelMatrix(ICON_YAW, ICON_TILT, 0, 0, ICON_SCALE),
    reflection_fade: 0,
    reflection_strength: REFLECTION_STRENGTH,
    rim_direction: [0.55, 0.9, 0.35],
    view_projection: camera.viewProjection as unknown as Float32Array<ArrayBuffer>,
  })

  // Same front-to-back "under" compositing as the hero's back layer.
  const under = { color: { dst: 'one', src: 'one-minus-dst-alpha' } } as const
  const glassMid = draw(gpu, {
    blend: 'premultiplied',
    cull: 'back',
    depth: { compare: 'greater', write: true },
    geometry: logoGeometry,
    shader: glassMidWgsl,
  })
  glassMid.set({ env_samp: envSampler, env_tex: envTarget, glass: glassUniforms })

  const glassBack = draw(gpu, {
    blend: under,
    cull: 'front',
    depth: { compare: 'greater', write: true },
    geometry: logoGeometry,
    shader: glassBackWgsl,
  })
  glassBack.set({ env_samp: envSampler, env_tex: envTarget, glass: glassUniforms })

  const glassFront = draw(gpu, {
    cull: 'back',
    geometry: logoGeometry,
    shader: glassFrontWgsl,
  })
  glassFront.set({ env_samp: envSampler, env_tex: envTarget, glass: glassUniforms })

  const edgeLines = draw(gpu, {
    blend: 'additive',
    depth: { compare: 'less-equal', write: false },
    geometry: edgeGeometry,
    shader: edgeWgsl,
  })
  edgeLines.set({ glass: glassUniforms })

  const copyBack = draw(gpu, {
    depth: { compare: 'always', write: false },
    shader: copyWgsl,
    vertices: 3,
  })
  const bloomExtract = effect(gpu, bloomWgsl)
  const bloomBlurs = [0, 1, 2].flatMap(() => [effect(gpu, bloomWgsl), effect(gpu, bloomWgsl)])
  const bloomComposite = effect(gpu, bloomWgsl)
  const present = effect(gpu, presentWgsl)
  present.set({ present: { bloom_strength: material.bloomStrength } })

  const level = (divisor: number): readonly [number, number] => [
    Math.max(1, Math.floor(size / divisor)),
    Math.max(1, Math.floor(size / divisor)),
  ]
  const back = target(gpu, { depth: true, format: HDR, size: level(1) })
  const scene = target(gpu, { depth: true, format: HDR, size: level(1) })
  const bloom = [2, 2, 4, 4, 8, 8].map((divisor) =>
    target(gpu, { format: HDR, size: level(divisor) }),
  )
  const composite = target(gpu, { format: HDR, size: level(2) })
  const output: Target = target(gpu, { format: 'rgba8unorm', size: [size, size] })

  copyBack.set({ source_samp: screenSampler, source_tex: back })
  glassFront.set({ scene_samp: screenSampler, scene_tex: back })
  bloomExtract.set({
    bloom: stage([0, 0], composite.size, 0),
    bloom_samp: screenSampler,
    source_a: scene,
    source_b: scene,
    source_c: scene,
  })
  for (let levelIndex = 0; levelIndex < 3; levelIndex += 1) {
    const horizontal = bloomBlurs[levelIndex * 2]!
    const vertical = bloomBlurs[levelIndex * 2 + 1]!
    const horizontalTarget = bloom[levelIndex * 2]!
    const verticalTarget = bloom[levelIndex * 2 + 1]!
    const source = levelIndex === 0 ? composite : bloom[levelIndex * 2 - 1]!
    horizontal.set({
      bloom: stage([1, 0], horizontalTarget.size, 1),
      bloom_samp: screenSampler,
      source_a: source,
      source_b: source,
      source_c: source,
    })
    vertical.set({
      bloom: stage([0, 1], verticalTarget.size, 1),
      bloom_samp: screenSampler,
      source_a: horizontalTarget,
      source_b: horizontalTarget,
      source_c: horizontalTarget,
    })
  }
  bloomComposite.set({
    bloom: stage([0, 0], composite.size, 2),
    bloom_samp: screenSampler,
    source_a: bloom[1]!,
    source_b: bloom[3]!,
    source_c: bloom[5]!,
  })
  present.set({ bloom_tex: composite, present_samp: screenSampler, scene_tex: scene })

  await Promise.all([
    bakeEnv.compile(envTarget),
    glassMid.compile(back),
    glassBack.compile(back),
    glassFront.compile(scene),
    edgeLines.compile(scene),
    copyBack.compile(scene),
    bloomExtract.compile(bloom[0]!),
    present.compile(output),
  ])

  frame(gpu, (baked) => baked.pass({ target: envTarget }, (pass) => pass.draw(bakeEnv)))
  frame(gpu, (current) => {
    current.pass({ clear: [0, 0, 0, 0], clearDepth: 0, target: back }, (pass) => {
      pass.draw(glassMid)
      pass.draw(glassBack)
    })
    current.pass({ clear: [0, 0, 0, 0], target: scene }, (pass) => {
      pass.draw(copyBack)
      pass.draw(glassFront)
      pass.draw(edgeLines)
    })
    current.pass({ target: composite }, (pass) => pass.draw(bloomExtract))
    for (let levelIndex = 0; levelIndex < 3; levelIndex += 1) {
      current.pass({ target: bloom[levelIndex * 2]! }, (pass) =>
        pass.draw(bloomBlurs[levelIndex * 2]!),
      )
      current.pass({ target: bloom[levelIndex * 2 + 1]! }, (pass) =>
        pass.draw(bloomBlurs[levelIndex * 2 + 1]!),
      )
    }
    current.pass({ target: composite }, (pass) => pass.draw(bloomComposite))
    current.pass({ clear: [0, 0, 0, 0], target: output }, (pass) => pass.draw(present))
  })

  return { height: size, pixels: unpremultiply(await output.read()), width: size }
}

/** One bloom stage's uniform block. */
function stage(
  direction: readonly [number, number],
  stageSize: readonly [number, number],
  stageId: number,
) {
  return {
    direction,
    stage: stageId,
    texel: [1 / stageSize[0], 1 / stageSize[1]],
    threshold: BLOOM_THRESHOLD,
  }
}

/** The present pass writes premultiplied alpha; PNG stores straight alpha. */
function unpremultiply(pixels: Uint8Array): Uint8Array {
  const straight = new Uint8Array(pixels.length)
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]!
    straight[index + 3] = alpha
    if (alpha === 0) continue
    for (let channel = 0; channel < 3; channel += 1) {
      straight[index + channel] = Math.min(
        255,
        Math.round((pixels[index + channel]! * 255) / alpha),
      )
    }
  }
  return straight
}
