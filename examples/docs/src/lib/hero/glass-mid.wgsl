import { sample_env } from "./hero-common.wgsl";
import { Glass, dielectric_fresnel, sphere_exit_distance } from "./glass-common.wgsl";

// Middle interface for the crystal's concave shape. Where one arm of the V
// sits behind the other, a ray leaving the near arm enters the far arm
// through this face, so it belongs in the layer the front glass refracts.
// Depth keeps the farthest front face; in pixels covered by a single arm that
// is the arm's own face, which only adds a faint fresnel body.

@group(0) @binding(0) var<uniform> glass: Glass;
@group(0) @binding(1) var env_tex: texture_2d<f32>;
@group(0) @binding(2) var env_samp: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) world_position: vec3f,
  @location(1) world_normal: vec3f,
};

@vertex
fn vs_main(@location(0) position: vec3f, @location(1) normal: vec3f) -> VertexOut {
  let world = glass.model * vec4f(position, 1.0);
  var out: VertexOut;
  out.position = glass.view_projection * world;
  out.world_position = world.xyz;
  out.world_normal = (glass.model * vec4f(normal, 0.0)).xyz;
  return out;
}

fn environment(direction: vec3f) -> vec3f {
  return sample_env(env_tex, env_samp, direction) * glass.environment_exposure;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let normal = normalize(in.world_normal);
  let view = normalize(glass.camera_position - in.world_position);
  let incident = -view;
  let facing = clamp(dot(view, normal), 0.0, 1.0);

  let fresnel = dielectric_fresnel(glass.fresnel_f0, facing);
  let reflected = environment(reflect(incident, normal)) * glass.reflection_strength;

  // The far arm absorbs along its own interior on top of the near arm's.
  let inside = normalize(refract(incident, normal, 1.0 / glass.ior));
  let distance = sphere_exit_distance(in.world_position, inside, glass.bounding_radius);
  let transmittance = exp(-glass.absorption * distance);
  let transmitted = dot(transmittance, vec3f(1.0 / 3.0));

  let veil = clamp(glass.body + (1.0 - transmitted), 0.0, 1.0);
  let alpha = clamp(fresnel + (1.0 - fresnel) * veil, 0.0, 1.0);
  return vec4f(reflected * fresnel, alpha);
}
