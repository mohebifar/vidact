// Uniform layout and optical helpers shared by the two glass interfaces,
// adapted from the vgpu.sh prism background for a transformed arbitrary mesh.

export struct Glass {
  view_projection: mat4x4f,
  model: mat4x4f,
  camera_position: vec3f,
  ior: f32,
  /** Beer-Lambert absorption per world unit, in linear RGB. */
  absorption: vec3f,
  /** Schlick reflectance at normal incidence, derived from ior on the CPU. */
  fresnel_f0: f32,
  reflection_strength: f32,
  environment_exposure: f32,
  /** World radius of the crystal's bounding sphere (the pseudo-volume). */
  bounding_radius: f32,
  /** Chromatic offset applied to the refracted screen-space lookup. */
  dispersion: f32,
  /** Thin-film iridescence strength on the front faces. */
  iridescence: f32,
  /** Gain on the refracted screen-space displacement; 1 is physical. */
  warp: f32,
  /** Extra opacity a nearer arm adds over whatever sits behind it. */
  body: f32,
  /** Direction toward the sweeping rim light, in world space. */
  rim_direction: vec3f,
  /** World height of the mirror floor. */
  floor_y: f32,
  /** 0 for the crystal itself; the reflection's strength for its mirror image. */
  reflection_fade: f32,
}

/** 1 for the crystal; a fade with depth below the floor for its reflection. */
export fn floor_fade(glass: Glass, world_y: f32) -> f32 {
  let depth = max(glass.floor_y - world_y, 0.0);
  let mirrored = glass.reflection_fade * exp(-depth * 0.9);
  return select(1.0, mirrored, glass.reflection_fade > 0.0);
}

export fn dielectric_fresnel(f0: f32, facing: f32) -> f32 {
  let one_minus = 1.0 - clamp(facing, 0.0, 1.0);
  let squared = one_minus * one_minus;
  return f0 + (1.0 - f0) * squared * squared * one_minus;
}

/**
 * Distance a ray travels inside the crystal's bounding sphere before leaving.
 * The mesh has no analytic planes like the prism, so the sphere stands in for
 * the solid: exact at the silhouette, smooth everywhere else.
 */
export fn sphere_exit_distance(origin: vec3f, direction: vec3f, radius: f32) -> f32 {
  let b = dot(origin, direction);
  let c = dot(origin, origin) - radius * radius;
  return max(-b + sqrt(max(b * b - c, 0.0)), radius * 0.05);
}
