// Layout engine: pure functions from (workspace state) -> frame rects.
// "Frame" = the rectangle (in world/viewport coordinates) that a
// workspace canvas occupies. Canvases never store their own position;
// it's always recomputed from index + layout config, which is what
// makes reordering / column changes trivial (just recompute + redraw).

import type { DropIndicator, Frame, Rect, Workspace, WorkspaceCanvas, WorkspaceImage } from "./types";

interface Point {
  x: number;
  y: number;
}

/** Bounding box of a grid slot at row-major index `i`. */
function slotBox(workspace: Workspace, i: number): Rect {
  const { columns, gutter, slotWidth, slotHeight } = workspace.layout;
  const col = i % columns;
  const row = Math.floor(i / columns);
  return {
    x: col * (slotWidth + gutter),
    y: row * (slotHeight + gutter),
    w: slotWidth,
    h: slotHeight,
  };
}

/**
 * "object-fit: contain" — fit a (width x height) box inside a slot,
 * preserving aspect ratio, centered.
 */
function fitContain(box: Rect, width: number, height: number): Rect {
  const boxAspect = box.w / box.h;
  const aspect = width / height;
  let w: number, h: number;
  if (aspect > boxAspect) {
    w = box.w;
    h = w / aspect;
  } else {
    h = box.h;
    w = h * aspect;
  }
  return {
    x: box.x + (box.w - w) / 2,
    y: box.y + (box.h - h) / 2,
    w,
    h,
  };
}

/** Compute render frames for every workspace canvas, grid mode. */
export function computeGridFrames(workspace: Workspace): Frame[] {
  return workspace.canvases.map((wc, i) => {
    const box = slotBox(workspace, i);
    const rect = fitContain(box, wc.width, wc.height);
    return {
      canvasId: wc.id,
      index: i,
      ...rect,
      slotBox: box,
      // World-units-per-canvas-local-unit, for converting a point into
      // the canvas's own xywh coordinate space.
      scale: rect.w / wc.width,
    };
  });
}

export function computeFrames(workspace: Workspace): Frame[] {
  // Only grid mode implemented so far; reading mode is the next phase,
  // once spread logic (behavior/viewingDirection) is wired up.
  return computeGridFrames(workspace);
}

/** Total world-space bounding box of all current frames (for fit-to-view). */
export function frameUnion(frames: Frame[]): Rect {
  if (frames.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of frames) {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.w);
    maxY = Math.max(maxY, f.y + f.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function pointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

/** Find which existing frame (if any) contains a world point. */
export function frameAtPoint(frames: Frame[], point: Point): Frame | null {
  for (const f of frames) {
    if (pointInRect(point, f)) return f;
  }
  return null;
}

/**
 * Find which image within a given workspace canvas contains a world
 * point, topmost (last-painted) first.
 */
export function imageAtPoint(wc: WorkspaceCanvas, frame: Frame, point: Point): WorkspaceImage | null {
  const localX = (point.x - frame.x) / frame.scale;
  const localY = (point.y - frame.y) / frame.scale;
  for (let i = wc.images.length - 1; i >= 0; i--) {
    const img = wc.images[i];
    if (localX >= img.x && localX <= img.x + img.w && localY >= img.y && localY <= img.y + img.h) {
      return img;
    }
  }
  return null;
}

/**
 * Given a world point in empty grid space, find the nearest slot
 * index to insert a new canvas at (row-major). Clamped to
 * [0, canvases.length] so it's always a valid splice index.
 */
export function nearestSlotIndex(workspace: Workspace, point: Point): number {
  const { columns, gutter, slotWidth, slotHeight } = workspace.layout;
  const col = Math.max(0, Math.min(columns - 1, Math.round(point.x / (slotWidth + gutter))));
  const row = Math.max(0, Math.round(point.y / (slotHeight + gutter)));
  const index = row * columns + col;
  return Math.max(0, Math.min(index, workspace.canvases.length));
}

/**
 * What to show as a drop preview for inserting a new canvas at `index`.
 *
 * If the slot is currently empty (index === canvases.length, i.e. past
 * the end of the sequence), show a full ghost box — there's nothing
 * there to collide with visually. If the slot is currently occupied
 * (we'd be inserting *before* an existing canvas, shifting it over),
 * show a thin insertion line instead of a box, so it doesn't render on
 * top of that canvas's own frame border and read as "merge into this."
 */
export function dropIndicatorForIndex(workspace: Workspace, index: number): DropIndicator {
  const box = slotBox(workspace, index);
  if (index >= workspace.canvases.length) {
    return { kind: "box", rect: box };
  }
  const lineWidth = Math.min(8, workspace.layout.gutter);
  return {
    kind: "line",
    rect: { x: box.x - lineWidth / 2, y: box.y, w: lineWidth, h: box.h },
  };
}
