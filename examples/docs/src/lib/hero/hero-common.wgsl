// Shared helpers, adapted from vgpu's environment-map/transmission examples
// and the vgpu.sh prism background.

export const PI: f32 = 3.141592653589793;

export fn equirect_uv(direction: vec3f) -> vec2f {
  let d = normalize(direction);
  return vec2f(atan2(d.z, d.x) / (2.0 * PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI);
}

export fn direction_from_equirect(uv: vec2f) -> vec3f {
  let phi = (uv.x - 0.5) * 2.0 * PI;
  let theta = uv.y * PI;
  return vec3f(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));
}

export fn sample_env(env: texture_2d<f32>, env_samp: sampler, direction: vec3f) -> vec3f {
  return textureSampleLevel(env, env_samp, equirect_uv(direction), 0.0).rgb;
}

export fn tonemap_aces(color: vec3f) -> vec3f {
  let x = max(color, vec3f(0.0));
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

export fn linear_to_srgb(color: vec3f) -> vec3f {
  let x = max(color, vec3f(0.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

export fn srgb_to_linear(color: vec3f) -> vec3f {
  let x = max(color, vec3f(0.0));
  return select(pow((x + 0.055) / 1.055, vec3f(2.4)), x / 12.92, x <= vec3f(0.04045));
}
