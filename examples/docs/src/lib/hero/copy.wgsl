// Copies the resolved back-glass layer into the scene target, alpha included.
// A plain draw with its own fullscreen triangle, so it can leave the depth
// buffer untouched for the glass that renders after it.

@group(0) @binding(0) var source_tex: texture_2d<f32>;
@group(0) @binding(1) var source_samp: sampler;

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

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return textureSampleLevel(source_tex, source_samp, in.uv, 0.0);
}
