// v11 scenes: isometric "camera feeds" for every screen, in the same style as the HQ office (src/office).
// A scene is a plain class; SceneView owns the canvas, the loop, hover tips and clicks.
import type { GameState } from '../sim/types';

/** Something under the pointer: a stable id the panel can act on, and the tip text. */
export interface SceneHit {
  id: string;
  label: string;
}

export interface Scene {
  /** Canvas size in CSS px. Fit the world into it here. */
  resize(cssW: number, cssH: number): void;
  /** Draw one frame. Read the state fresh every frame; never copy it. `dt` in seconds, `nowMs` wall clock. */
  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, nowMs: number): void;
  /** What is under (x, y) in CSS px, or null. Called on pointer move and click. */
  hitTest(x: number, y: number): SceneHit | null;
}
