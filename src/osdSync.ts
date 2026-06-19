import OpenSeadragon from "openseadragon";
import { computeFrames, frameUnion, tableBounds, unionRect } from "./layout.js";
import type { Frame, Selection, Workspace } from "./types";

export interface RenderState {
  frames: Frame[];
  /** Live TiledImage instances keyed by workspace image id — used for
   * direct manipulation during a drag, bypassing a full resync. */
  tiledImagesByImageId: Map<string, OpenSeadragon.TiledImage>;
  /** The selection ring overlay element for the currently-selected image, if any.
   * Exposed so canvasInteractions can reposition it live during a drag gesture
   * rather than waiting for a full resync on release. */
  selectedImageRingEl: HTMLElement | null;
}

/**
 * Rebuild the OSD World from scratch to match the current workspace
 * model. Full-rebuild-on-every-change is the simplest correct strategy
 * for a prototype at this scale (a handful of canvases); a production
 * version would diff instead of clearing+re-adding. (Continuous drags
 * bypass this entirely — see canvasInteractions.ts.)
 */
export function syncWorld(
  viewer: OpenSeadragon.Viewer,
  workspace: Workspace,
  selection: Selection,
  { fit = false }: { fit?: boolean } = {}
): RenderState {
  viewer.world.removeAll();
  viewer.clearOverlays();

  const frames = computeFrames(workspace);
  const frameById = new Map(frames.map((f) => [f.canvasId, f]));
  const tiledImagesByImageId = new Map<string, OpenSeadragon.TiledImage>();
  let selectedImageRingEl: HTMLElement | null = null;

  for (const wc of workspace.canvases) {
    const frame = frameById.get(wc.id);
    if (!frame) continue;

    // Frame border + label, drawn as an HTML overlay so we get free
    // styling/hover affordances without fighting OSD's canvas drawing.
    const frameEl = document.createElement("div");
    frameEl.className = "canvas-frame";
    if (selection?.type === "canvas" && selection.canvasId === wc.id) {
      frameEl.classList.add("selected");
    }
    frameEl.dataset.canvasId = wc.id;
    const labelEl = document.createElement("div");
    labelEl.className = "canvas-frame-label";
    labelEl.textContent = `${frame.index + 1}. ${wc.label}`;
    frameEl.appendChild(labelEl);
    viewer.addOverlay({
      element: frameEl,
      location: new OpenSeadragon.Rect(frame.x, frame.y, frame.w, frame.h),
    });

    // Map each canvas-local image (xywh in canvas units) into world
    // coordinates via the frame's render scale.
    const scale = frame.scale;
    for (const img of wc.images) {
      const worldX = frame.x + img.x * scale;
      const worldY = frame.y + img.y * scale;
      const worldW = img.w * scale;

      viewer.addTiledImage({
        tileSource: img.serviceUrl ? `${img.serviceUrl}/info.json` : { type: "image", url: img.url },
        x: worldX,
        y: worldY,
        // Only width is specified; OSD derives height from the loaded
        // image's own aspect ratio (matches our stored w/h already).
        width: worldW,
        // OSD's .d.ts types this callback as a plain DOM `Event`, but at
        // runtime it actually passes `{ item: TiledImage }` -- see
        // openseadragon.js's `addTiledImage` implementation.
        success: ((event: { item: OpenSeadragon.TiledImage }) => {
          tiledImagesByImageId.set(img.id, event.item);
        }) as unknown as (event: Event) => void,
      });

      if (selection?.type === "image" && selection.imageId === img.id) {
        const ringEl = document.createElement("div");
        ringEl.className = "image-selection-ring";
        viewer.addOverlay({
          element: ringEl,
          location: new OpenSeadragon.Rect(worldX, worldY, worldW, img.h * scale),
        });
        selectedImageRingEl = ringEl;
      }
    }
  }

  if (fit && frames.length > 0) {
    const bounds = unionRect(frameUnion(frames), tableBounds(workspace));
    const padding = Math.max(bounds.w, bounds.h) * 0.1;
    viewer.viewport.fitBounds(
      new OpenSeadragon.Rect(bounds.x - padding, bounds.y - padding, bounds.w + padding * 2, bounds.h + padding * 2),
      true
    );
  }

  return { frames, tiledImagesByImageId, selectedImageRingEl };
}
