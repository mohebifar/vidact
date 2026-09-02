/**
 * Material and camera tuning for the crystal, shared by the animated hero
 * (`hero-logo.ts`) and the still icon render (`icon.ts`) so the favicon and the
 * header mark stay the same object as the one on the landing page.
 */

export const IOR = 1.55
export const ABSORPTION: readonly [number, number, number] = [1.15, 0.9, 0.8] // smoky obsidian body
export const REFLECTION_STRENGTH = 1
export const ENVIRONMENT_EXPOSURE = 1.2
export const DISPERSION = 0.06
export const BLOOM_THRESHOLD = 0.8
export const BLOOM_STRENGTH = 1.4
export const BASE_YAW = 1.15 // resting Y rotation; pi / 2 is face-on
export const BASE_TILT = 0 // resting X rotation
export const CRYSTAL_SCALE = 1.35 // world radius; the vertical half-view is ~1.46
export const CAMERA_DISTANCE = 4
export const FOV = 40
export const IRIDESCENCE = 0.12 // thin-film color on the facet edges
export const REFRACTION_WARP = 1 // gain on background warping through the glass; 1 is physical
export const SURFACE_BODY = 0.35 // how much a nearer arm veils the arm behind it
export const EDGE_ANGLE = 28 // creases sharper than this (degrees) get a wireframe line
export const ENV_SIZE: readonly [number, number] = [512, 256]
export const HDR: GPUTextureFormat = 'rgba16float'

/** Column-major scale * Rx(tilt) * Ry(yaw), plus a vertical drift and horizontal shift. */
export function modelMatrix(
  yaw: number,
  tilt: number,
  lift: number,
  shift: number,
  scale = CRYSTAL_SCALE,
): Float32Array {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(tilt)
  const sp = Math.sin(tilt)
  const k = scale
  // prettier-ignore
  return new Float32Array([
    k * cy, k * sp * sy, k * -cp * sy, 0,
    0, k * cp, k * sp, 0,
    k * sy, k * -sp * cy, k * cp * cy, 0,
    shift, lift, 0, 1,
  ])
}
