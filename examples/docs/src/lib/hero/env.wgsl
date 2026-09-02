import { direction_from_equirect, srgb_to_linear } from "./hero-common.wgsl";

// The deliberately sparse studio the crystal reflects, ported from the
// vgpu.sh prism background: a near-black room, a floor fill, one dominant
// feathered key panel, a secondary key for the left arm, and a faint
// signal-green accent. Baked once into an equirect HDR target.

struct StudioPanel {
  direction: vec3f,
  size: vec2f,
  feather: f32,
  color: vec3f,
  intensity: f32,
}

fn studio_panels() -> array<StudioPanel, 9> {
  return array<StudioPanel, 9>(
    // A broad back-left wall, only a touch brighter than the dark floor.
    StudioPanel(vec3f(-0.82, 0.08, 0.57), vec2f(1.35, 1.1), 0.22, vec3f(0.82, 0.84, 0.88), 0.011),
    // A broad, heavily feathered fill that barely lifts the bottom edge.
    StudioPanel(vec3f(0.0, -0.707, 0.707), vec2f(0.38, 0.62), 0.18, vec3f(1.0, 0.97, 0.91), 0.4),
    // The cool right panel is the dominant key and keeps a defined edge.
    StudioPanel(vec3f(0.612, 0.354, 0.707), vec2f(0.55, 0.14), 0.035, vec3f(0.76, 0.88, 1.0), 22.0),
    // A narrower warm-white counter key from the upper left.
    StudioPanel(vec3f(-0.55, 0.55, 0.63), vec2f(0.45, 0.09), 0.04, vec3f(1.0, 0.97, 0.92), 10.0),
    // A faint signal-green accent low on the left.
    StudioPanel(vec3f(-0.45, -0.5, 0.74), vec2f(0.35, 0.14), 0.09, vec3f(0.35, 0.95, 0.66), 3.2),
    // Thin secondary streaks spread around the sphere, so a rotating crystal
    // always has a facet catching light.
    StudioPanel(vec3f(0.2, 0.9, -0.4), vec2f(1.0, 0.05), 0.05, vec3f(1.0, 1.0, 1.0), 8.0),
    StudioPanel(vec3f(-0.85, 0.2, -0.5), vec2f(0.06, 0.7), 0.05, vec3f(0.9, 0.95, 1.0), 6.0),
    StudioPanel(vec3f(0.9, -0.1, -0.42), vec2f(0.05, 0.6), 0.05, vec3f(1.0, 0.98, 0.95), 7.0),
    StudioPanel(vec3f(0.1, -0.85, -0.52), vec2f(0.8, 0.06), 0.06, vec3f(0.95, 0.97, 1.0), 5.0),
  );
}

fn studio_panel_mask(direction: vec3f, panel: StudioPanel) -> f32 {
  let forward = normalize(panel.direction);
  let helper = select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(forward.y) > 0.92);
  let right = normalize(cross(helper, forward));
  let up = cross(forward, right);
  let facing = dot(direction, forward);
  if (facing <= 0.01) {
    return 0.0;
  }
  let local_x = abs(dot(direction, right) / facing);
  let local_y = abs(dot(direction, up) / facing);
  let edge_x = 1.0 - smoothstep(panel.size.x, panel.size.x + panel.feather, local_x);
  let edge_y = 1.0 - smoothstep(panel.size.y, panel.size.y + panel.feather, local_y);
  return edge_x * edge_y;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let direction = direction_from_equirect(uv);

  let floor_blend = 1.0 - smoothstep(-0.22, -0.02, direction.y);
  var color = mix(vec3f(0.001, 0.0012, 0.0016), vec3f(0.009, 0.01, 0.013), floor_blend);
  let horizon = exp(-abs(direction.y + 0.1) * 22.0) * 0.0012;
  color += vec3f(horizon, horizon * 0.96, horizon * 0.9);

  let panels = studio_panels();
  for (var index = 0u; index < 9u; index = index + 1u) {
    let panel = panels[index];
    color += panel.color * (studio_panel_mask(direction, panel) * panel.intensity);
  }

  // The prism background's filmic compression and gamma round trip, so the
  // baked values match the look its reflections were tuned against.
  let mapped = color / (vec3f(1.0) + color);
  return vec4f(srgb_to_linear(pow(max(mapped, vec3f(0.0)), vec3f(1.0 / 2.2))), 1.0);
}
