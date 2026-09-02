import {
  draw,
  effect,
  frame,
  geometry,
  init,
  sampler,
  surface,
  target,
  uniforms,
  type Gpu,
  type Surface,
  type Target,
} from 'vgpu'
import { perspectiveCamera } from 'vgpu/scene'

import logoUrl from '@/assets/logo.glb?url'

import bloomWgsl from './hero/bloom.wgsl'
import copyWgsl from './hero/copy.wgsl'
import edgeWgsl from './hero/edge.wgsl'
import envWgsl from './hero/env.wgsl'
import glassBackWgsl from './hero/glass-back.wgsl'
import glassFrontWgsl from './hero/glass-front.wgsl'
import glassMidWgsl from './hero/glass-mid.wgsl'
import { featureEdges, parseLogoMesh } from './hero/glb.ts'
import glowWgsl from './hero/glow.wgsl'
import presentWgsl from './hero/present.wgsl'

/** Tuning knobs for the hero crystal. */
const IOR = 1.55
const ABSORPTION: readonly [number, number, number] = [1.15, 0.9, 0.8] // smoky obsidian body
const REFLECTION_STRENGTH = 1
const ENVIRONMENT_EXPOSURE = 1.2
const DISPERSION = 0.06
const BLOOM_THRESHOLD = 0.8
const BLOOM_STRENGTH = 1.4
const BASE_YAW = 1.15 // resting Y rotation; pi / 2 is face-on
const BASE_TILT = 0 // resting X rotation
const POINTER_TILT = 0.22 // how far the pointer can tilt the crystal
const TILT_EASE = 10 // how quickly the pointer tilt is followed
const CRYSTAL_SCALE = 1.35 // world radius; the vertical half-view is ~1.46
const CAMERA_DISTANCE = 4
const FOV = 40
const FLOOR_Y = -1.05 // world height of the mirror floor
const CONTAINER_MAX_PX = 1152 // the hero copy's max-w-6xl container
const CONTAINER_PADDING_PX = 24 // its px-6 gutter
const GLOW_INTENSITY = 0.35 // ambient stage light level
const IRIDESCENCE = 0.12 // thin-film color on the facet edges
const REFRACTION_WARP = 1 // gain on background warping through the glass; 1 is physical
const SURFACE_BODY = 0.35 // how much a nearer arm veils the arm behind it
const REFLECTION_STRENGTH_FLOOR = 0.85 // brightness of the mirror image at the contact line
const EDGE_ANGLE = 28 // creases sharper than this (degrees) get a wireframe line
const ENV_SIZE: readonly [number, number] = [512, 256]
const HDR: GPUTextureFormat = 'rgba16float'

type FrameTargets = {
  readonly back: Target
  readonly bloom: readonly Target[]
  readonly composite: Target
  readonly scene: Target
}

/**
 * Mounts the crystal logo into `host` with vgpu (WebGPU) and returns an
 * idempotent cleanup. The pipeline is a miniature of the vgpu.sh prism
 * background: back-glass layer, front glass refracting it in screen space,
 * bloom pyramid, then a tonemapped premultiplied present.
 */
export async function createHeroLogo(host: HTMLElement): Promise<() => void> {
  if (!('gpu' in navigator)) return () => {}

  let gpu: Gpu
  try {
    gpu = await init()
  } catch {
    return () => {}
  }

  gpu.onError((error) => console.error('[hero-logo]', error))
  let disposed = false
  let frameHandle = 0
  const listeners: (() => void)[] = []
  const dispose = () => {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(frameHandle)
    for (const remove of listeners) remove()
    gpu.dispose()
    canvas.remove()
  }

  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  host.appendChild(canvas)

  try {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const output: Surface = surface(gpu, canvas, {
      alphaMode: 'premultiplied',
      clearColor: [0, 0, 0, 0],
      dpr: [1, 2],
    })

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

    // Bake the studio panels once.
    const envTarget = target(gpu, { format: HDR, size: [...ENV_SIZE] })
    const bakeEnv = effect(gpu, envWgsl)

    const mesh = parseLogoMesh(await (await fetch(logoUrl)).arrayBuffer())
    if (disposed) return dispose
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

    const glassValues = (reflectionFade: number) => ({
      absorption: ABSORPTION,
      body: SURFACE_BODY,
      bounding_radius: CRYSTAL_SCALE,
      camera_position: [0, 0, CAMERA_DISTANCE],
      dispersion: DISPERSION,
      environment_exposure: ENVIRONMENT_EXPOSURE,
      floor_y: FLOOR_Y,
      fresnel_f0: ((IOR - 1) / (IOR + 1)) ** 2,
      ior: IOR,
      iridescence: IRIDESCENCE,
      warp: REFRACTION_WARP,
      model: modelMatrix(BASE_YAW, BASE_TILT, 0, 0),
      reflection_fade: reflectionFade,
      reflection_strength: REFLECTION_STRENGTH,
      rim_direction: [0, 1, 0.4],
      view_projection: new Float32Array(16),
    })
    const glassUniforms = uniforms(gpu, glassValues(0))
    // The mirror image shares every value except its model matrix and fade.
    const mirrorUniforms = uniforms(gpu, glassValues(REFLECTION_STRENGTH_FLOOR))

    // The back layer is built front to back with "under" compositing: the
    // farthest front face first, then the farthest back face beneath it, then
    // the stage light beneath both. Depth keeps the farthest face at each step.
    const under = {
      color: { dst: 'one', src: 'one-minus-dst-alpha' },
    } as const
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

    // Mirroring across the floor flips the winding, hence the opposite cull.
    const glassMirror = draw(gpu, {
      blend: 'premultiplied',
      cull: 'front',
      geometry: logoGeometry,
      shader: glassFrontWgsl,
    })
    glassMirror.set({ env_samp: envSampler, env_tex: envTarget, glass: mirrorUniforms })

    const edgeLines = draw(gpu, {
      blend: 'additive',
      depth: { compare: 'less-equal', write: false },
      geometry: edgeGeometry,
      shader: edgeWgsl,
    })
    edgeLines.set({ glass: glassUniforms })
    const edgeLinesMirror = draw(gpu, {
      blend: 'additive',
      depth: { compare: 'less-equal', write: false },
      geometry: edgeGeometry,
      shader: edgeWgsl,
    })
    edgeLinesMirror.set({ glass: mirrorUniforms })

    const glowUniforms = uniforms(gpu, {
      aspect: 1,
      camera: [0, 0, CAMERA_DISTANCE],
      center: [0.5, 0.5],
      crystal: [0, 0, 0],
      floor_y: FLOOR_Y,
      intensity: GLOW_INTENSITY,
      tan_half: Math.tan((FOV * Math.PI) / 360),
      time: 0,
    })
    const glowLight = draw(gpu, {
      blend: under,
      depth: { compare: 'always', write: false },
      shader: glowWgsl,
      vertices: 3,
    })
    glowLight.set({ glow: glowUniforms })

    const copyBack = draw(gpu, {
      depth: { compare: 'always', write: false },
      shader: copyWgsl,
      vertices: 3,
    })
    const bloomExtract = effect(gpu, bloomWgsl)
    const bloomBlurs = [0, 1, 2].flatMap(() => [effect(gpu, bloomWgsl), effect(gpu, bloomWgsl)])
    const bloomComposite = effect(gpu, bloomWgsl)
    const present = effect(gpu, presentWgsl)
    present.set({ present: { bloom_strength: BLOOM_STRENGTH } })

    const createTargets = (): FrameTargets => {
      const [width, height] = output.size
      const level = (divisor: number): readonly [number, number] => [
        Math.max(1, Math.floor(width / divisor)),
        Math.max(1, Math.floor(height / divisor)),
      ]
      return {
        back: target(gpu, { depth: true, format: HDR, size: level(1) }),
        scene: target(gpu, { depth: true, format: HDR, size: level(1) }),
        bloom: [2, 2, 4, 4, 8, 8].map((divisor) =>
          target(gpu, { format: HDR, size: level(divisor) }),
        ),
        composite: target(gpu, { format: HDR, size: level(2) }),
      }
    }

    const bindTargets = (frameTargets: FrameTargets) => {
      const { back, bloom, composite, scene } = frameTargets
      copyBack.set({ source_samp: screenSampler, source_tex: back })
      glassFront.set({ scene_samp: screenSampler, scene_tex: back })
      glassMirror.set({ scene_samp: screenSampler, scene_tex: back })
      const stage = (
        dir: readonly [number, number],
        size: readonly [number, number],
        stageId: number,
      ) => ({
        direction: dir,
        stage: stageId,
        texel: [1 / size[0], 1 / size[1]],
        threshold: BLOOM_THRESHOLD,
      })
      // Extract into the composite target as scratch; each blur then ping-pongs
      // so no pass ever samples the texture it writes.
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
    }

    let targets = createTargets()
    bindTargets(targets)

    await Promise.all([
      bakeEnv.compile(envTarget),
      glowLight.compile(targets.back),
      glassMid.compile(targets.back),
      glassBack.compile(targets.back),
      glassFront.compile(targets.scene),
      glassMirror.compile(targets.scene),
      edgeLines.compile(targets.scene),
      edgeLinesMirror.compile(targets.scene),
      copyBack.compile(targets.scene),
      bloomExtract.compile(targets.bloom[0]!),
      present.compile({ colors: [output.format] }),
    ])
    if (disposed) return dispose

    frame(gpu, (baked) => baked.pass({ target: envTarget }, (pass) => pass.draw(bakeEnv)))

    let tiltX = 0
    let tiltY = 0
    let targetTiltX = 0
    let targetTiltY = 0
    let lastTime = performance.now()

    const startTime = performance.now()
    const render = () => {
      const time = (performance.now() - startTime) / 1000
      const aspect = output.size[0] / Math.max(1, output.size[1])
      const camera = perspectiveCamera({
        aspect,
        far: 20,
        fov: FOV,
        near: 0.1,
        position: [0, 0, CAMERA_DISTANCE],
        target: [0, 0, 0],
      })
      const halfHeight = Math.tan((FOV * Math.PI) / 360) * CAMERA_DISTANCE
      const halfWidth = halfHeight * aspect
      // Sit the crystal's right edge on the content container's right edge
      // (max-w-6xl with px-6), converting that pixel edge to world units at
      // the crystal's depth. Narrow viewports fall back to centered.
      const cssWidth = Math.max(1, canvas.clientWidth)
      const worldPerPixel = (2 * halfWidth) / cssWidth
      const containerHalfPx = Math.min(CONTAINER_MAX_PX, cssWidth) / 2 - CONTAINER_PADDING_PX
      const shiftX = Math.max(0, containerHalfPx * worldPerPixel - CRYSTAL_SCALE * 1.05)
      // Rest the crystal on the floor: its lowest point sits ~0.57 radii below center.
      const lift = FLOOR_Y + CRYSTAL_SCALE * 0.57 + 0.02
      const viewProjection = camera.viewProjection as unknown as Float32Array<ArrayBuffer>
      const model = modelMatrix(BASE_YAW + tiltY, BASE_TILT + tiltX, lift, shiftX)
      // The rim light sits on the pointer's side and above, so it sweeps
      // across the facets as the pointer moves.
      const pointerX = tiltY / Math.max(POINTER_TILT, 0.0001)
      const pointerY = tiltX / Math.max(POINTER_TILT, 0.0001)
      const rimDirection = [pointerX * 1.6, 0.9 - pointerY * 0.7, 0.35]
      glowUniforms.set({
        aspect,
        center: [0.5 + shiftX / (2 * halfWidth), 0.5 - lift / (2 * halfHeight)],
        crystal: [shiftX, lift, 0],
        time: reducedMotion ? 0 : time,
      })
      glassUniforms.set({ model, rim_direction: rimDirection, view_projection: viewProjection })
      mirrorUniforms.set({
        model: mirrorAcrossFloor(model, FLOOR_Y),
        rim_direction: rimDirection,
        view_projection: viewProjection,
      })
      frame(gpu, (current) => {
        current.pass({ clear: [0, 0, 0, 0], clearDepth: 0, target: targets.back }, (pass) => {
          pass.draw(glassMid)
          pass.draw(glassBack)
          pass.draw(glowLight)
        })
        current.pass({ clear: [0, 0, 0, 0], target: targets.scene }, (pass) => {
          pass.draw(copyBack)
          pass.draw(glassMirror)
          pass.draw(edgeLinesMirror)
          pass.draw(glassFront)
          pass.draw(edgeLines)
        })
        current.pass({ target: targets.composite }, (pass) => pass.draw(bloomExtract))
        for (let levelIndex = 0; levelIndex < 3; levelIndex += 1) {
          current.pass({ target: targets.bloom[levelIndex * 2]! }, (pass) =>
            pass.draw(bloomBlurs[levelIndex * 2]!),
          )
          current.pass({ target: targets.bloom[levelIndex * 2 + 1]! }, (pass) =>
            pass.draw(bloomBlurs[levelIndex * 2 + 1]!),
          )
        }
        current.pass({ target: targets.composite }, (pass) => pass.draw(bloomComposite))
        current.pass({ target: output }, (pass) => pass.draw(present))
      })
    }

    const renderFrame = () => {
      const now = performance.now()
      const delta = Math.min((now - lastTime) / 1000, 0.1)
      lastTime = now
      const ease = Math.min(1, delta * TILT_EASE)
      tiltX += (targetTiltX - tiltX) * ease
      tiltY += (targetTiltY - tiltY) * ease
      render()
      frameHandle = requestAnimationFrame(renderFrame)
    }

    let sawInitialResize = false
    const unsubscribeResize = output.onResize(() => {
      if (!sawInitialResize) {
        sawInitialResize = true
        return
      }
      if (disposed) return
      const previous = targets
      targets = createTargets()
      bindTargets(targets)
      destroyTargets(previous)
      if (reducedMotion) render()
    })
    listeners.push(unsubscribeResize)

    const onPointerMove = (event: PointerEvent) => {
      targetTiltY = ((event.clientX / window.innerWidth) * 2 - 1) * POINTER_TILT
      targetTiltX = ((event.clientY / window.innerHeight) * 2 - 1) * POINTER_TILT
    }
    const onVisibilityChange = () => {
      cancelAnimationFrame(frameHandle)
      if (!document.hidden) {
        lastTime = performance.now()
        frameHandle = requestAnimationFrame(renderFrame)
      }
    }

    if (reducedMotion) {
      render()
    } else {
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      listeners.push(() => window.removeEventListener('pointermove', onPointerMove))
      document.addEventListener('visibilitychange', onVisibilityChange)
      listeners.push(() => document.removeEventListener('visibilitychange', onVisibilityChange))
      frameHandle = requestAnimationFrame(renderFrame)
    }

    return dispose
  } catch (error) {
    dispose()
    throw error
  }
}

function destroyTargets(frameTargets: FrameTargets): void {
  const all = [frameTargets.back, frameTargets.scene, frameTargets.composite, ...frameTargets.bloom]
  for (const item of all) (item as { destroy?: () => void }).destroy?.()
}

/** Reflects a column-major model matrix across the plane y = floorY. */
function mirrorAcrossFloor(model: Float32Array, floorY: number): Float32Array {
  const mirrored = new Float32Array(model)
  for (const index of [1, 5, 9]) mirrored[index] = -model[index]!
  mirrored[13] = 2 * floorY - model[13]!
  return mirrored
}

/** Column-major scale * Rx(tilt) * Ry(yaw), plus a vertical drift and horizontal shift. */
function modelMatrix(yaw: number, tilt: number, lift: number, shift: number): Float32Array {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(tilt)
  const sp = Math.sin(tilt)
  const k = CRYSTAL_SCALE
  // prettier-ignore
  return new Float32Array([
    k * cy, k * sp * sy, k * -cp * sy, 0,
    0, k * cp, k * sp, 0,
    k * sy, k * -sp * cy, k * cp * cy, 0,
    shift, lift, 0, 1,
  ])
}
