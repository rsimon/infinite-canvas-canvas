import OpenSeadragon from "openseadragon";
import { frameAtPoint } from "./layout.js";
import { moveImageBy } from "./model.js";
import { select, clearSelection, getSelection } from "./selection.js";
import type { Frame, Workspace, WorkspaceCanvas, WorkspaceImage } from "./types";
import type { RenderState } from "./osdSync.js";

interface HitResult {
  frame: Frame;
  canvas: WorkspaceCanvas;
  image: WorkspaceImage | null;
}

interface DragState {
  canvasId: string;
  imageId: string;
  tiledImage: OpenSeadragon.TiledImage;
  /** Offset from the pointer's world position to the image's top-left, captured at press time. */
  grabOffset: OpenSeadragon.Point;
  moved: boolean;
}

/**
 * Handles two gestures directly on the OSD canvas:
 *  - click-to-select (a canvas frame, or an image within it)
 *  - press-and-drag-to-move an image within its canvas
 *
 * Selection always resolves through the `canvas-click` handler (which
 * OSD fires on every release, with a `quick` flag distinguishing a tap
 * from a pan/drag) so there's exactly one code path that decides what
 * gets selected. The press/drag/release handlers only concern
 * themselves with the optional move gesture and committing its result
 * back into the model; on a real drag they also select the moved
 * image directly, since `canvas-click` will see `quick: false` and
 * skip itself.
 */
export function setupCanvasInteractions({
  viewer,
  osdContainer,
  getWorkspace,
  getRenderState,
}: {
  viewer: OpenSeadragon.Viewer;
  osdContainer: HTMLElement;
  getWorkspace: () => Workspace;
  getRenderState: () => RenderState;
}): void {
  let dragging: DragState | null = null;

  function hitTest(point: OpenSeadragon.Point): HitResult | null {
    const { frames } = getRenderState();
    const workspace = getWorkspace();

    // Check images first in world-space so images dragged outside their canvas
    // frame are still hittable. Frames and images are checked in reverse order
    // so later-added (visually on top) items win.
    for (let fi = frames.length - 1; fi >= 0; fi--) {
      const frame = frames[fi];
      const wc = workspace.canvases.find((c) => c.id === frame.canvasId);
      if (!wc) continue;
      for (let ii = wc.images.length - 1; ii >= 0; ii--) {
        const img = wc.images[ii];
        const l = frame.x + img.x * frame.scale;
        const t = frame.y + img.y * frame.scale;
        const r = l + img.w * frame.scale;
        const b = t + img.h * frame.scale;
        if (point.x >= l && point.x <= r && point.y >= t && point.y <= b) {
          return { frame, canvas: wc, image: img };
        }
      }
    }

    // No image hit — check for a bare canvas frame.
    const frame = frameAtPoint(frames, point);
    if (!frame) return null;
    const wc = workspace.canvases.find((c) => c.id === frame.canvasId);
    return wc ? { frame, canvas: wc, image: null } : null;
  }

  viewer.addHandler("canvas-press", (event: OpenSeadragon.CanvasPressEvent) => {
    const point = viewer.viewport.pointFromPixel(event.position);
    const hit = hitTest(point);
    if (!hit?.image) return;

    // Only start a move drag when the image is already selected. A press on
    // an unselected image falls through to OSD's pan; canvas-click (quick=true)
    // will then select it, and the next press+drag will move it.
    const sel = getSelection();
    if (sel?.type !== "image" || sel.imageId !== hit.image.id) return;

    const tiledImage = getRenderState().tiledImagesByImageId.get(hit.image.id);
    if (!tiledImage) return; // image not finished loading yet -- skip drag, allow normal pan

    const bounds = tiledImage.getBounds();
    dragging = {
      canvasId: hit.canvas.id,
      imageId: hit.image.id,
      tiledImage,
      grabOffset: new OpenSeadragon.Point(point.x - bounds.x, point.y - bounds.y),
      moved: false,
    };
  });

  viewer.addHandler("canvas-drag", (event: OpenSeadragon.CanvasDragEvent) => {
    if (!dragging) return;
    const d = dragging;
    // Suppress OSD's own drag-to-pan for *this* gesture only. Note this
    // does NOT disable the tracker (unlike viewer.setMouseNavEnabled,
    // which we deliberately avoid here -- it disables the very same
    // tracker that fires canvas-release/canvas-click, which would leave
    // pan/zoom and selection permanently broken after the first image
    // drag, since nothing would ever fire to turn it back on).
    event.preventDefaultAction = true;
    d.moved = true;
    const point = viewer.viewport.pointFromPixel(event.position);
    const newX = point.x - d.grabOffset.x;
    const newY = point.y - d.grabOffset.y;
    d.tiledImage.setPosition(new OpenSeadragon.Point(newX, newY), true);

    // Keep the selection ring overlay in sync with the image being dragged.
    // The ring is a static OSD overlay (it doesn't automatically follow a
    // TiledImage that moves via setPosition), so we reposition it manually.
    const state = getRenderState();
    const ringEl = state.selectedImageRingEl;
    if (ringEl) {
      const frame = state.frames.find((f) => f.canvasId === d.canvasId);
      const wc = getWorkspace().canvases.find((c) => c.id === d.canvasId);
      const img = wc?.images.find((i) => i.id === d.imageId);
      if (frame && img) {
        try {
          viewer.updateOverlay(ringEl, new OpenSeadragon.Rect(newX, newY, img.w * frame.scale, img.h * frame.scale));
        } catch {
          /* overlay may have been removed by a concurrent resync */
        }
      }
    }
  });

  viewer.addHandler("canvas-release", () => {
    if (!dragging) return;

    if (dragging.moved) {
      const { canvasId, imageId, tiledImage } = dragging;
      const workspace = getWorkspace();
      const wc = workspace.canvases.find((c) => c.id === canvasId);
      const img = wc?.images.find((i) => i.id === imageId);
      const frame = getRenderState().frames.find((f) => f.canvasId === canvasId);

      if (wc && img && frame) {
        const bounds = tiledImage.getBounds();
        const localX = (bounds.x - frame.x) / frame.scale;
        const localY = (bounds.y - frame.y) / frame.scale;
        // Use silent to avoid triggering a notify (and full world rebuild) here.
        // select() below fires subscribeSelection → rerender(), which reads the
        // already-updated model -- giving us one clean rebuild instead of two
        // synchronous world.removeAll() calls inside the same OSD event handler.
        moveImageBy(workspace, canvasId, imageId, localX - img.x, localY - img.y, { silent: true });
      }
      select({ type: "image", canvasId, imageId });
    }

    dragging = null;
  });

  viewer.addHandler("canvas-click", (event: OpenSeadragon.CanvasClickEvent) => {
    if (!event.quick) return; // a pan, or the tail end of an image drag -- not a click
    const point = viewer.viewport.pointFromPixel(event.position);
    const hit = hitTest(point);

    if (hit?.image) {
      select({ type: "image", canvasId: hit.canvas.id, imageId: hit.image.id });
    } else if (hit?.frame) {
      select({ type: "canvas", canvasId: hit.frame.canvasId });
    } else {
      clearSelection();
    }
  });

  // Clicking truly outside the OSD element (e.g. on the toolbar) doesn't
  // go through OSD's tracker at all -- clear selection on outside clicks
  // for a more predictable feel, but don't fight clicks inside our own UI.
  document.addEventListener("pointerdown", (e) => {
    const target = e.target as Node;
    if (osdContainer.contains(target)) return;
    if ((target as HTMLElement).closest?.("aside, .sidebar, .inspector")) return;
    clearSelection();
  });
}
