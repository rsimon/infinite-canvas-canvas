import OpenSeadragon from "openseadragon";
import { frameAtPoint, nearestSlotIndex, dropIndicatorForIndex } from "./layout.js";
import { addCanvasFromSource, addImageToCanvas } from "./model.js";
import type { SourceCanvas, Workspace } from "./types";
import type { RenderState } from "./osdSync.js";

interface DragState {
  sourceCanvas: SourceCanvas;
  ghostEl: HTMLElement;
  indicatorEl: HTMLElement | null;
}

export function setupDragController({
  viewer,
  osdContainer,
  getWorkspace,
  getRenderState,
}: {
  viewer: OpenSeadragon.Viewer;
  osdContainer: HTMLElement;
  getWorkspace: () => Workspace;
  getRenderState: () => RenderState;
}): { startDrag: (sourceCanvas: SourceCanvas, pointerEvent: PointerEvent) => void } {
  let dragState: DragState | null = null;

  function clientToWorldPoint(clientX: number, clientY: number): OpenSeadragon.Point | null {
    const rect = osdContainer.getBoundingClientRect();
    const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    if (!inside) return null;
    const pixel = new OpenSeadragon.Point(clientX - rect.left, clientY - rect.top);
    return viewer.viewport.pointFromPixel(pixel);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragState) return;
    dragState.ghostEl.style.left = `${e.clientX}px`;
    dragState.ghostEl.style.top = `${e.clientY}px`;

    clearTargetHighlight();
    removeIndicator();

    const worldPoint = clientToWorldPoint(e.clientX, e.clientY);
    if (!worldPoint) return;

    const { frames } = getRenderState();
    const hit = frameAtPoint(frames, worldPoint);

    if (hit) {
      highlightTarget(hit.canvasId);
    } else {
      const workspace = getWorkspace();
      const index = nearestSlotIndex(workspace, worldPoint);
      showIndicator(workspace, index);
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragState) return;
    const { sourceCanvas } = dragState;

    const worldPoint = clientToWorldPoint(e.clientX, e.clientY);
    cleanupDragVisuals();

    if (worldPoint) {
      const workspace = getWorkspace();
      const { frames } = getRenderState();
      const hit = frameAtPoint(frames, worldPoint);

      if (hit) {
        // Drop onto an existing workspace canvas -> merge image in.
        const sourceImage = sourceCanvas.images[0];
        if (sourceImage) {
          const localX = (worldPoint.x - hit.x) / hit.scale;
          const localY = (worldPoint.y - hit.y) / hit.scale;
          addImageToCanvas(workspace, hit.canvasId, sourceImage, localX, localY);
        }
      } else {
        // Drop onto empty grid space -> insert a new workspace canvas.
        const index = nearestSlotIndex(workspace, worldPoint);
        addCanvasFromSource(workspace, sourceCanvas, index);
      }
    }

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    dragState = null;
  }

  function startDrag(sourceCanvas: SourceCanvas, pointerEvent: PointerEvent): void {
    pointerEvent.preventDefault();

    const ghostEl = document.createElement("div");
    ghostEl.className = "drag-ghost";
    const thumbUrl = sourceCanvas.images[0]?.url;
    if (thumbUrl) {
      const img = document.createElement("img");
      img.src = thumbUrl;
      ghostEl.appendChild(img);
    }
    ghostEl.style.left = `${pointerEvent.clientX}px`;
    ghostEl.style.top = `${pointerEvent.clientY}px`;
    document.body.appendChild(ghostEl);

    dragState = { sourceCanvas, ghostEl, indicatorEl: null };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function highlightTarget(canvasId: string): void {
    const el = osdContainer.querySelector<HTMLElement>(`.canvas-frame[data-canvas-id="${canvasId}"]`);
    if (el) el.classList.add("drop-target");
  }

  function clearTargetHighlight(): void {
    osdContainer
      .querySelectorAll<HTMLElement>(".canvas-frame.drop-target")
      .forEach((el) => el.classList.remove("drop-target"));
  }

  function showIndicator(workspace: Workspace, index: number): void {
    if (!dragState) return;
    const indicator = dropIndicatorForIndex(workspace, index);
    const el = document.createElement("div");
    el.className = indicator.kind === "box" ? "slot-ghost slot-ghost-box" : "slot-ghost slot-ghost-line";
    viewer.addOverlay({
      element: el,
      location: new OpenSeadragon.Rect(indicator.rect.x, indicator.rect.y, indicator.rect.w, indicator.rect.h),
    });
    dragState.indicatorEl = el;
  }

  function removeIndicator(): void {
    if (dragState?.indicatorEl) {
      try {
        viewer.removeOverlay(dragState.indicatorEl);
      } catch {
        /* overlay may already be gone after a rerender */
      }
      dragState.indicatorEl = null;
    }
  }

  function cleanupDragVisuals(): void {
    clearTargetHighlight();
    removeIndicator();
    if (dragState?.ghostEl) dragState.ghostEl.remove();
  }

  return { startDrag };
}
