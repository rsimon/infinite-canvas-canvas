import OpenSeadragon from "openseadragon";
import { frameAtPoint, imageAtPoint } from "./layout.js";
import { moveImageBy } from "./model.js";
import { select, clearSelection } from "./selection.js";
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
    const frame = frameAtPoint(frames, point);
    if (!frame) return null;
    const wc = getWorkspace().canvases.find((c) => c.id === frame.canvasId);
    if (!wc) return null;
    return { frame, canvas: wc, image: imageAtPoint(wc, frame, point) };
  }

  viewer.addHandler("canvas-press", (event: OpenSeadragon.CanvasPressEvent) => {
    const point = viewer.viewport.pointFromPixel(event.position);
    const hit = hitTest(point);
    if (!hit?.image) return;

    const tiledImage = getRenderState().tiledImagesByImageId.get(hit.image.id);
    if (!tiledImage) return; // image not finished loading yet -- skip drag, allow normal pan

    viewer.setMouseNavEnabled(false);
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
    event.preventDefaultAction = true;
    dragging.moved = true;
    const point = viewer.viewport.pointFromPixel(event.position);
    dragging.tiledImage.setPosition(
      new OpenSeadragon.Point(point.x - dragging.grabOffset.x, point.y - dragging.grabOffset.y),
      true
    );
  });

  viewer.addHandler("canvas-release", () => {
    if (!dragging) return;
    viewer.setMouseNavEnabled(true);

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
        moveImageBy(workspace, canvasId, imageId, localX - img.x, localY - img.y);
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
