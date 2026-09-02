import { linear_to_srgb, tonemap_aces } from "./hero-common.wgsl";

// Final presentation, after the prism background's present pass: the scene
// plus the combined bloom, one ACES tone mapping, sRGB conversion, and
// premultiplied alpha so the halo spills onto the page's dark hero band.

struct PresentParams {
  bloom_strength: f32,
}

@group(0) @binding(0) var scene_tex: texture_2d<f32>;
@group(0) @binding(1) var bloom_tex: texture_2d<f32>;
@group(0) @binding(2) var present_samp: sampler;
@group(0) @binding(3) var<uniform> present: PresentParams;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let scene = textureSampleLevel(scene_tex, present_samp, uv, 0.0);
  let bloom = textureSampleLevel(bloom_tex, present_samp, uv, 0.0).rgb
    * max(present.bloom_strength, 0.0);
  let linear = max(scene.rgb + bloom, vec3f(0.0));
  let bloom_luminance = dot(bloom, vec3f(0.2126, 0.7152, 0.0722));
  let alpha = clamp(scene.a + bloom_luminance * 2.0, 0.0, 1.0);
  let color = linear_to_srgb(tonemap_aces(linear));
  return vec4f(color * alpha, alpha);
}
