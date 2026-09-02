// Minimal bloom chain after the prism background's dark pipeline: a soft-knee
// extract, a separable 9-tap Gaussian reused per level, and a normalized
// three-level composite. Selected per draw through `stage`.

struct BloomParams {
  direction: vec2f,
  texel: vec2f,
  threshold: f32,
  stage: f32,
}

@group(0) @binding(0) var source_a: texture_2d<f32>;
@group(0) @binding(1) var source_b: texture_2d<f32>;
@group(0) @binding(2) var source_c: texture_2d<f32>;
@group(0) @binding(3) var bloom_samp: sampler;
@group(0) @binding(4) var<uniform> bloom: BloomParams;

fn bright_contribution(color: vec3f) -> vec3f {
  let brightness = max(max(color.r, color.g), color.b);
  let threshold = max(bloom.threshold, 0.0);
  let knee = max(threshold * 0.5, 0.0001);
  var soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 0.0001);
  let contribution = max(brightness - threshold, soft) / max(brightness, 0.0001);
  return color * contribution;
}

const WEIGHTS = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

fn blur(uv: vec2f) -> vec3f {
  var color = textureSampleLevel(source_a, bloom_samp, uv, 0.0).rgb * WEIGHTS[0];
  for (var tap = 1u; tap < 5u; tap = tap + 1u) {
    let offset = bloom.direction * bloom.texel * f32(tap);
    color += (
      textureSampleLevel(source_a, bloom_samp, uv + offset, 0.0).rgb
      + textureSampleLevel(source_a, bloom_samp, uv - offset, 0.0).rgb
    ) * WEIGHTS[tap];
  }
  return color;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  if (bloom.stage < 0.5) {
    let color = textureSampleLevel(source_a, bloom_samp, uv, 0.0).rgb;
    return vec4f(bright_contribution(max(color, vec3f(0.0))), 1.0);
  }
  if (bloom.stage < 1.5) {
    return vec4f(max(blur(uv), vec3f(0.0)), 1.0);
  }
  let color = (
    textureSampleLevel(source_a, bloom_samp, uv, 0.0).rgb * 0.5
    + textureSampleLevel(source_b, bloom_samp, uv, 0.0).rgb * 0.75
    + textureSampleLevel(source_c, bloom_samp, uv, 0.0).rgb * 1.0
  ) / 2.25;
  return vec4f(max(color, vec3f(0.0)), 1.0);
}
