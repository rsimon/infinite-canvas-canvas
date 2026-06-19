import OpenSeadragon from "openseadragon";
import type { Selection, Workspace } from "./types";
import type { RenderState } from "./osdSync.js";

type Corner = "tl" | "tr" | "bl" | "br";

const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];

const CORNER_CURSOR: Record<Corner, string> = {
  tl: "nwse-resize",
  tr: "nesw-resize",
  bl: "nesw-resize",
  br: "nwse-resize",
};

interface ResizeDrag {
  pointerId: number;
  canvasId: string;
  imageId: string;
  tiledImage: OpenSeadragon.TiledImage;
  /** World-space position of the fixed (opposite) corner. */
  anchorX: number;
  anchorY: number;
  /** anchor is on the right edge  → new left  = anchorX − width  */
  anchorIsRight: boolean;
  /** anchor is on the bottom edge → new top   = anchorY − height */
  anchorIsBottom: boolean;
  /** img.w / img.h, fixed for the duration of the drag. */
  aspect: number;
  /** Minimum world-space width (10% of initial width). */
  minW: number;
}

/**
 * Attaches four corner resize handles (DOM elements, not OSD overlays) on top
 * of the OSD container. Handles are positioned in screen-pixel coordinates via
 * viewer.viewport.pixelFromPoint and refreshed on every viewport change.
 *
 * Resize is aspect-ratio-preserving: horizontal distance from the pointer to
 * the fixed anchor corner drives the new width; height is derived from that.
 * Changes are applied live via TiledImage.setPosition / setWidth during the
 * drag gesture and committed to the model (via onResizeCommit) on pointer-up.
 */
export function setupResizeHandles({
  viewer,
  osdContainer,
  getSelection,
  getWorkspace,
  getRenderState,
  onResizeCommit,
}: {
  viewer: OpenSeadragon.Viewer;
  osdContainer: HTMLElement;
  getSelection: () => Selection;
  getWorkspace: () => Workspace;
  getRenderState: () => RenderState;
  onResizeCommit: (
    canvasId: string,
    imageId: string,
    x: number,
    y: number,
    w: number,
    h: number
  ) => void;
}): { refreshHandles: () => void } {
  const layer = document.createElement("div");
  layer.className = "resize-handles-layer";
  osdContainer.appendChild(layer);

  const handleEls = Object.fromEntries(
    CORNERS.map((c) => {
      const el = document.createElement("div");
      el.className = `resize-handle resize-handle-${c}`;
      el.style.cursor = CORNER_CURSOR[c];
      layer.appendChild(el);
      return [c, el];
    })
  ) as unknown as Record<Corner, HTMLElement>;

  let drag: ResizeDrag | null = null;

  function worldToPixel(wx: number, wy: number): { x: number; y: number } {
    const p = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(wx, wy), true);
    return { x: p.x, y: p.y };
  }

  function pixelToWorld(px: number, py: number): OpenSeadragon.Point {
    return viewer.viewport.pointFromPixel(new OpenSeadragon.Point(px, py));
  }

  function placeHandle(corner: Corner, wx: number, wy: number): void {
    const { x, y } = worldToPixel(wx, wy);
    const el = handleEls[corner];
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  function placeHandlesAt(left: number, top: number, right: number, bottom: number): void {
    placeHandle("tl", left, top);
    placeHandle("tr", right, top);
    placeHandle("bl", left, bottom);
    placeHandle("br", right, bottom);
  }

  function refreshHandles(): void {
    const sel = getSelection();
    if (sel?.type !== "image") {
      layer.style.display = "none";
      return;
    }

    const workspace = getWorkspace();
    const state = getRenderState();
    const wc = workspace.canvases.find((c) => c.id === sel.canvasId);
    const img = wc?.images.find((i) => i.id === sel.imageId);
    const frame = state.frames.find((f) => f.canvasId === sel.canvasId);

    if (!img || !frame) {
      layer.style.display = "none";
      return;
    }

    layer.style.display = "block";
    const left   = frame.x + img.x * frame.scale;
    const top    = frame.y + img.y * frame.scale;
    const right  = left + img.w * frame.scale;
    const bottom = top  + img.h * frame.scale;
    placeHandlesAt(left, top, right, bottom);
  }

  viewer.addHandler("update-viewport", refreshHandles);
  viewer.addHandler("animation", refreshHandles);

  for (const corner of CORNERS) {
    const el = handleEls[corner];

    el.addEventListener("pointerdown", (e: PointerEvent) => {
      // Stop the event from reaching OSD's MouseTracker so it doesn't start a pan.
      e.stopPropagation();
      e.preventDefault();

      const sel = getSelection();
      if (sel?.type !== "image") return;

      const state = getRenderState();
      const tiledImage = state.tiledImagesByImageId.get(sel.imageId);
      if (!tiledImage) return; // image still loading — skip

      const workspace = getWorkspace();
      const wc = workspace.canvases.find((c) => c.id === sel.canvasId);
      const img = wc?.images.find((i) => i.id === sel.imageId);
      const frame = state.frames.find((f) => f.canvasId === sel.canvasId);
      if (!img || !frame) return;

      const left   = frame.x + img.x * frame.scale;
      const top    = frame.y + img.y * frame.scale;
      const right  = left + img.w * frame.scale;
      const bottom = top  + img.h * frame.scale;

      // The anchor corner is opposite to the one being dragged.
      const anchorIsRight  = corner === "tl" || corner === "bl";
      const anchorIsBottom = corner === "tl" || corner === "tr";

      drag = {
        pointerId: e.pointerId,
        canvasId: sel.canvasId,
        imageId: sel.imageId,
        tiledImage,
        anchorX: anchorIsRight  ? right  : left,
        anchorY: anchorIsBottom ? bottom : top,
        anchorIsRight,
        anchorIsBottom,
        aspect: img.w / img.h,
        minW: img.w * frame.scale * 0.1,
      };

      // Redirect all subsequent pointer events to this element until pointerup.
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener("pointermove", (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d = drag;

      const containerRect = osdContainer.getBoundingClientRect();
      const world = pixelToWorld(
        e.clientX - containerRect.left,
        e.clientY - containerRect.top
      );

      const rawW = Math.abs(world.x - d.anchorX);
      const w = Math.max(rawW, d.minW);
      const h = w / d.aspect;

      const left = d.anchorIsRight  ? d.anchorX - w : d.anchorX;
      const top  = d.anchorIsBottom ? d.anchorY - h : d.anchorY;

      // Live update: move and resize the TiledImage directly (no model/resync).
      d.tiledImage.setPosition(new OpenSeadragon.Point(left, top), true);
      d.tiledImage.setWidth(w, true);

      // Keep handles and selection ring in sync with the new bounds.
      placeHandlesAt(left, top, left + w, top + h);

      const ringEl = getRenderState().selectedImageRingEl;
      if (ringEl) {
        try {
          viewer.updateOverlay(ringEl, new OpenSeadragon.Rect(left, top, w, h));
        } catch { /* overlay may be mid-resync */ }
      }
    });

    el.addEventListener("pointerup", (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d = drag;
      drag = null;

      const state = getRenderState();
      const frame = state.frames.find((f) => f.canvasId === d.canvasId);
      if (!frame) return;

      // getBounds(true) returns an OSD Rect {x, y, width, height} in world space.
      const b = d.tiledImage.getBounds(true);
      onResizeCommit(
        d.canvasId,
        d.imageId,
        (b.x      - frame.x) / frame.scale, // local x
        (b.y      - frame.y) / frame.scale, // local y
        b.width              / frame.scale, // local w
        b.height             / frame.scale  // local h
      );
    });

    el.addEventListener("pointercancel", () => { drag = null; });
  }

  return { refreshHandles };
}
