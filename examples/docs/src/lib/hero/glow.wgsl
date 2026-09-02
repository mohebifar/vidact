// The stage behind and beneath the crystal, drawn last into the back layer
// underneath the glass layers: a perspective grid floor with a contact
// shadow, and one soft back light in the void above the horizon. It sits in
// the layer the glass refracts, so the grid bends through the crystal.

struct Glow {
  /** Crystal center in world space. */
  crystal: vec3f,
  aspect: f32,
  camera: vec3f,
  /** tan(fov / 2) of the camera. */
  tan_half: f32,
  /** Crystal center in uv space. */
  center: vec2f,
  floor_y: f32,
  time: f32,
  intensity: f32,
}

@group(0) @binding(0) var<uniform> glow: Glow;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out: VertexOut;
  out.position = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(corner.x, 1.0 - corner.y);
  return out;
}

fn grid_line(coordinate: f32, spacing: f32) -> f32 {
  let cell = coordinate / spacing;
  let distance = abs(fract(cell + 0.5) - 0.5) * spacing;
  let width = fwidth(coordinate) * 1.2;
  return 1.0 - smoothstep(0.0, width, distance);
}

fn floor_color(p: vec3f, travel: f32) -> vec3f {
  let offset = p.xz - glow.crystal.xz;
  // A pool of light on the floor behind the crystal, from the back light.
  let pool = exp(-dot(offset - vec2f(0.0, -1.4), offset - vec2f(0.0, -1.4)) * 0.14);
  let wide = exp(-dot(offset, offset) * 0.02);
  let fog = exp(-max(travel - 3.5, 0.0) * 0.26);
  let lines = max(grid_line(p.x, 0.5), grid_line(p.z, 0.5));
  // Contact shadow: tight and dark right under the crystal.
  let shadow = 1.0 - 0.9 * exp(-dot(offset * vec2f(1.0, 2.4), offset * vec2f(1.0, 2.4)) * 1.1);
  let tint = vec3f(0.6, 0.85, 0.76);
  let base = tint * (0.08 * pool + 0.016 * wide);
  let grid = tint * lines * (0.9 * wide + 0.4 * pool);
  return (base + grid) * shadow * fog;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let uv = in.uv;
  let breath = 0.95 + 0.05 * sin(glow.time * 0.35);

  // The camera looks down -Z from its position, so a pixel's ray only needs
  // the projection's half extents.
  let direction = normalize(vec3f(
    (uv.x * 2.0 - 1.0) * glow.tan_half * glow.aspect,
    (1.0 - uv.y * 2.0) * glow.tan_half,
    -1.0,
  ));

  // Evaluated unconditionally: the grid uses screen derivatives, which WGSL
  // forbids inside non-uniform branches. Rays above the horizon are masked.
  let downward = min(direction.y, -0.0005);
  let travel = (glow.floor_y - glow.camera.y) / downward;
  let floor = floor_color(glow.camera + direction * travel, travel);
  var color = select(vec3f(0.0), floor, direction.y < -0.0005);

  // One soft back light above and behind the crystal.
  let p = vec2f((uv.x - glow.center.x) * glow.aspect, uv.y - glow.center.y);
  let d = length(p - vec2f(0.0, -0.16));
  let horizon_mask = smoothstep(0.02, -0.03, direction.y);
  let light = vec3f(0.55, 0.8, 0.72) * (0.3 / (1.0 + d * d * 12.0) + 0.3 * exp(-d * d * 16.0));
  color += light * (1.0 - horizon_mask * 0.7);

  // Die out before the canvas edges so the section boundary never cuts the
  // stage with a hard line.
  let edge = smoothstep(1.0, 0.85, uv.y) * smoothstep(0.0, 0.08, uv.y) * smoothstep(1.0, 0.94, uv.x);
  color *= breath * glow.intensity * edge;
  let alpha = clamp(max(color.r, max(color.g, color.b)) * 2.2, 0.0, 1.0);
  return vec4f(color, alpha);
}
