import { sample_env } from "./hero-common.wgsl";
import { Glass, dielectric_fresnel } from "./glass-common.wgsl";

// Inner/back interface of the crystal, after the prism background's
// glass-back pass: an environment-only layer the front interface refracts.
// Draws back faces with premultiplied blending; depth keeps the farthest
// face, which is the one a ray through the solid actually leaves by.

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
  let view = normalize(glass.camera_position - in.world_position);
  let incident = -view;
  // Back-facing triangles expose their inward normal to the camera ray.
  let inward_normal = -normalize(in.world_normal);

  // Glass -> air at the exit face; a totally internally reflected ray is
  // followed one bounce and treated as escaping in that direction.
  var transmitted = refract(incident, inward_normal, glass.ior);
  var escaped = 1.0;
  if (dot(transmitted, transmitted) < 0.00001) {
    transmitted = normalize(reflect(incident, inward_normal));
    escaped = 0.0;
  } else {
    transmitted = normalize(transmitted);
  }

  let facing = clamp(-dot(incident, inward_normal), 0.0, 1.0);
  let fresnel = dielectric_fresnel(glass.fresnel_f0, facing);
  // The interior reflection off this face, followed out through the solid.
  let reflected_direction = normalize(reflect(incident, inward_normal));
  let reflected = environment(reflected_direction) * glass.reflection_strength;

  let transmitted_environment = environment(transmitted) * glass.reflection_strength;
  let reflection_weight = mix(1.0, fresnel, escaped);
  let color = mix(transmitted_environment, reflected, reflection_weight);
  let alpha = clamp(reflection_weight + 0.25, 0.0, 1.0);
  return vec4f(color * alpha, alpha);
}
