import { Glass, floor_fade } from "./glass-common.wgsl";

// Feature-edge wireframe, after the prism background's edge pass: thin
// additive lines that keep the silhouette and facet creases crisp no matter
// how dark the glass body is. Edges facing the rim light burn brighter, so
// the light visibly travels along the crystal as the pointer moves.

@group(0) @binding(0) var<uniform> glass: Glass;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) world_position: vec3f,
  @location(1) world_normal: vec3f,
};

@vertex
fn vs_main(@location(0) position: vec3f, @location(1) normal: vec3f) -> VertexOut {
  var world = (glass.model * vec4f(position, 1.0)).xyz;
  // Nudge toward the camera so the line wins the depth test against the
  // faces it sits on.
  world += normalize(glass.camera_position - world) * 0.006;
  var out: VertexOut;
  out.position = glass.view_projection * vec4f(world, 1.0);
  out.world_position = world;
  out.world_normal = (glass.model * vec4f(normal, 0.0)).xyz;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let normal = normalize(in.world_normal);
  let view = normalize(glass.camera_position - in.world_position);
  let facing = clamp(dot(view, normal), 0.0, 1.0);
  let toward_light = max(dot(normal, normalize(glass.rim_direction)), 0.0);
  let sweep = pow(toward_light, 3.0);
  // Silhouette edges (grazing) stay lit; interior creases only light up
  // when the rim light reaches them.
  let base = 0.05 + 0.12 * pow(1.0 - facing, 2.0);
  let intensity = (base + sweep * 0.9) * floor_fade(glass, in.world_position.y);
  let color = mix(vec3f(0.55, 0.75, 0.7), vec3f(0.9, 1.0, 0.96), sweep) * intensity;
  return vec4f(color, 0.0);
}
