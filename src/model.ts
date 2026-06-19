// The workspace model is the single source of truth for the editor.
// IMPORTANT: a workspace canvas's *position* is never stored directly.
// Its position is always derived from its index in `canvases` by the
// layout engine. This is what keeps the workspace "table-like" rather
// than a free-form Figma canvas: you can't drop something at an
// arbitrary pixel and have it stay there, you drop it INTO a sequence
// position (a grid slot), and the model only remembers the sequence.
//
// Images *within* a canvas, by contrast, carry explicit local x/y/w/h
// in the canvas's own coordinate units (matching IIIF's xywh-on-canvas
// convention), since that positioning is intentionally free-form.

import type { SourceCanvas, SourceImage, Workspace, WorkspaceCanvas } from "./types";

let nextId = 1;
function uid(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

export function createWorkspace(): Workspace {
  return {
    layout: {
      mode: "grid",
      columns: 3,
      gutter: 40,
      slotWidth: 360,
      slotHeight: 480,
    },
    behavior: "individuals",
    viewingDirection: "left-to-right",
    canvases: [],
  };
}

type Listener = (workspace: Workspace) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(workspace: Workspace): void {
  for (const fn of listeners) fn(workspace);
}

/**
 * Insert a new workspace canvas (sourced from a source-manifest canvas)
 * at a given sequence index. The canvas's own width/height (its
 * "page size") come straight from the source canvas; the single
 * source image fills it.
 */
export function addCanvasFromSource(workspace: Workspace, sourceCanvas: SourceCanvas, atIndex: number): WorkspaceCanvas {
  const firstImage = sourceCanvas.images[0];
  const wc: WorkspaceCanvas = {
    id: uid("wc"),
    sourceCanvasId: sourceCanvas.id,
    label: sourceCanvas.label,
    width: sourceCanvas.width,
    height: sourceCanvas.height,
    behavior: null,
    images: firstImage
      ? [
          {
            id: uid("img"),
            sourceImageId: firstImage.id,
            url: firstImage.url,
            // Image fills the canvas by default, like a normal painting anno.
            x: 0,
            y: 0,
            w: sourceCanvas.width,
            h: sourceCanvas.height,
          },
        ]
      : [],
  };

  const index = Math.max(0, Math.min(atIndex, workspace.canvases.length));
  workspace.canvases.splice(index, 0, wc);
  notify(workspace);
  return wc;
}

/**
 * Merge a source image into an *existing* workspace canvas, placed at
 * a given local point (canvas-local units). Free placement, no clip,
 * may overflow the canvas bounds.
 */
export function addImageToCanvas(
  workspace: Workspace,
  workspaceCanvasId: string,
  sourceImage: SourceImage,
  localX: number,
  localY: number
) {
  const wc = workspace.canvases.find((c) => c.id === workspaceCanvasId);
  if (!wc) return null;

  // Keep the dropped image at its own native aspect ratio, sized
  // relative to the target canvas (defaults to ~45% of canvas width).
  const targetW = wc.width * 0.45;
  const aspect = sourceImage.width / sourceImage.height;
  const targetH = targetW / aspect;

  const img = {
    id: uid("img"),
    sourceImageId: sourceImage.id,
    url: sourceImage.url,
    // Center the new image on the drop point.
    x: localX - targetW / 2,
    y: localY - targetH / 2,
    w: targetW,
    h: targetH,
  };
  wc.images.push(img);
  notify(workspace);
  return img;
}

/**
 * Shift an image's local position by (dx, dy), canvas-local units.
 * `silent: true` skips the notify pass — used during a continuous drag
 * gesture, where the caller is driving the live visuals directly and
 * only wants a single notify at the end (see canvasInteractions.ts).
 */
export function moveImageBy(
  workspace: Workspace,
  canvasId: string,
  imageId: string,
  dx: number,
  dy: number,
  opts: { silent?: boolean } = {}
): void {
  const wc = workspace.canvases.find((c) => c.id === canvasId);
  const img = wc?.images.find((i) => i.id === imageId);
  if (!img) return;
  img.x += dx;
  img.y += dy;
  if (!opts.silent) notify(workspace);
}

export function setColumns(workspace: Workspace, columns: number): void {
  workspace.layout.columns = Math.max(1, columns);
  notify(workspace);
}

export function removeCanvas(workspace: Workspace, workspaceCanvasId: string): void {
  workspace.canvases = workspace.canvases.filter((c) => c.id !== workspaceCanvasId);
  notify(workspace);
}

/**
 * Set an image's position and size in canvas-local units.
 * Mirrors the IIIF xywh convention; both position and dimensions are updated
 * atomically so the bounding box is always internally consistent.
 */
export function resizeImage(
  workspace: Workspace,
  canvasId: string,
  imageId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { silent?: boolean } = {}
): void {
  const wc = workspace.canvases.find((c) => c.id === canvasId);
  const img = wc?.images.find((i) => i.id === imageId);
  if (!img) return;
  img.x = x;
  img.y = y;
  img.w = w;
  img.h = h;
  if (!opts.silent) notify(workspace);
}

/** Trigger listeners without mutating anything — e.g. to commit a silent drag. */
export function forceRender(workspace: Workspace): void {
  notify(workspace);
}
