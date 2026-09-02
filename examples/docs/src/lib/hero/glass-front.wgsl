import { sample_env } from "./hero-common.wgsl";
import { Glass, dielectric_fresnel, floor_fade, sphere_exit_distance } from "./glass-common.wgsl";

// Outer/front interface, after the prism background's glass.wgsl: one
// refracted screen-space lookup into the resolved back layer, one studio
// reflection, Beer-Lambert absorption over the interior distance, and an
// additive highlight that keeps the bright studio key visible on frontal
// faces. Chromatic dispersion offsets the refracted lookup per channel.

@group(0) @binding(0) var<uniform> glass: Glass;
@group(0) @binding(1) var scene_tex: texture_2d<f32>;
@group(0) @binding(2) var scene_samp: sampler;
@group(0) @binding(3) var env_tex: texture_2d<f32>;
@group(0) @binding(4) var env_samp: sampler;

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

fn project_to_uv(point: vec3f) -> vec2f {
  let clip = glass.view_projection * vec4f(point, 1.0);
  let ndc = clip.xy / max(clip.w, 0.00001);
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

fn sample_background(uv: vec2f) -> vec4f {
  let resolution = max(vec2f(textureDimensions(scene_tex)), vec2f(1.0));
  let half_texel = 0.5 / resolution;
  let safe_uv = clamp(uv, half_texel, vec2f(1.0) - half_texel);
  return textureSampleLevel(scene_tex, scene_samp, safe_uv, 0.0);
}

/**
 * Thin-film interference tint: the phase runs with the view angle, so tilting
 * the crystal sweeps the spectrum across each facet, and with the facet's
 * orientation, so neighbouring facets sit at different points of the cycle.
 */
fn thin_film(facing: f32, normal: vec3f, position: vec3f) -> vec3f {
  // View angle sweeps the cycle as the crystal tilts, the facet normal offsets
  // it per face, and the position term draws holo-foil bands across each face.
  let phase = (1.0 - facing) * 6.0
    + dot(normal, vec3f(2.1, 3.3, 1.2))
    + dot(position, vec3f(2.6, 4.4, 3.2));
  return vec3f(0.5) + 0.5 * cos(vec3f(phase, phase + 2.094, phase + 4.188));
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let normal = normalize(in.world_normal);
  let view = normalize(glass.camera_position - in.world_position);
  let incident = -view;
  let facing = clamp(dot(view, normal), 0.0, 1.0);

  let reflected_environment = environment(reflect(incident, normal));
  let fresnel = dielectric_fresnel(glass.fresnel_f0, facing);

  let inside = normalize(refract(incident, normal, 1.0 / glass.ior));
  let distance = sphere_exit_distance(in.world_position, inside, glass.bounding_radius);
  let exit_position = in.world_position + inside * distance;

  let resolution = max(vec2f(textureDimensions(scene_tex)), vec2f(1.0));
  let original_uv = in.position.xy / resolution;
  // Amplify the physical displacement and add a per-facet shear from the
  // surface normal, so every facet visibly warps the background behind it.
  let displacement = (project_to_uv(exit_position) - original_uv) * glass.warp
    + vec2f(normal.x, -normal.y) * 0.05 * glass.warp;
  let refracted_uv = original_uv + displacement;

  // Per-channel spread along the refraction displacement splits the back
  // layer's highlights into spectra.
  let spread = glass.dispersion;
  let uv_r = mix(original_uv, refracted_uv, 1.0 - spread);
  let uv_b = mix(original_uv, refracted_uv, 1.0 + spread);
  let background = vec3f(
    sample_background(uv_r).r,
    sample_background(refracted_uv).g,
    sample_background(uv_b).b,
  );

  let transmittance = exp(-glass.absorption * distance);
  let transmitted = background * transmittance;
  let reflected = reflected_environment * glass.reflection_strength;

  // The prism background's studio-panel highlight: keep the bright key's
  // footprint visible on low-Fresnel frontal faces, in linear HDR.
  let grazing_weight = pow(1.0 - facing, 1.5);
  let environment_luminance = dot(reflected_environment, vec3f(0.2126, 0.7152, 0.0722));
  let studio_panel_mask = smoothstep(0.5, 0.82, environment_luminance);
  // Holographic film: additive interference sheen, so the color play reads on
  // every facet no matter how dark the glass body is. Angular falloff makes
  // grazing facets glow harder, and the phase sweeps as the crystal tilts.
  // Confined to grazing angles so the body stays dark and the color lives
  // on the edges.
  let film = thin_film(facing, normal, in.world_position);
  let strength = clamp(glass.iridescence, 0.0, 2.0);
  let sheen = film * film * pow(1.0 - facing, 2.5) * strength;
  // The sweeping rim light: a tight lobe on facets turned toward it, biased
  // to grazing angles, so it travels over the crystal as the pointer moves.
  let toward_light = max(dot(normal, normalize(glass.rim_direction)), 0.0);
  let rim_light = vec3f(0.85, 0.97, 0.94)
    * pow(toward_light, 7.0)
    * (0.12 + 0.88 * pow(1.0 - facing, 1.5))
    * 1.6;
  let physical_glass = transmitted * (1.0 - fresnel) + reflected * fresnel + sheen + rim_light;
  let studio_panel_strength = studio_panel_mask
    * clamp(glass.reflection_strength * 0.4, 0.0, 0.7)
    * (0.65 + 0.35 * grazing_weight);
  let highlight = max(reflected * studio_panel_strength, vec3f(0.0));

  // A restrained cool rim keeps the silhouette readable against the black
  // band, standing in for the prism background's wireframe pass.
  let rim = vec3f(0.72, 0.9, 0.82) * pow(1.0 - facing, 4.0) * 0.45;
  // Premultiplied so the same shader draws the mirror image fading into the floor.
  let fade = floor_fade(glass, in.world_position.y);
  return vec4f((max(physical_glass, vec3f(0.0)) + highlight + rim) * fade, fade);
}
