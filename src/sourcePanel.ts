import type { SourceCanvas, SourceManifest } from "./types";

/**
 * Renders the source manifest's canvases as a thumbnail list.
 * Dragging is implemented with pointer events (not native HTML5 DnD)
 * because OSD's canvas captures pointer input and doesn't play nicely
 * with the native DnD API for drop targets layered on top of it.
 */
export function renderSourcePanel(
  container: HTMLElement,
  sourceManifest: SourceManifest,
  onDragStart: (sourceCanvas: SourceCanvas, pointerEvent: PointerEvent) => void
): void {
  container.innerHTML = "";

  const title = document.createElement("h2");
  title.textContent = sourceManifest.label;
  container.appendChild(title);

  const hint = document.createElement("p");
  hint.className = "panel-hint";
  hint.textContent = "Drag a page into the workspace, or onto an existing canvas to merge.";
  container.appendChild(hint);

  const list = document.createElement("div");
  list.className = "source-list";
  container.appendChild(list);

  for (const canvas of sourceManifest.canvases) {
    const card = document.createElement("div");
    card.className = "source-card";
    card.dataset.canvasId = canvas.id;

    const thumbUrl = canvas.images[0]?.url;
    if (thumbUrl) {
      const img = document.createElement("img");
      img.src = thumbUrl;
      img.alt = canvas.label;
      img.draggable = false; // we handle dragging ourselves
      card.appendChild(img);
    }

    const label = document.createElement("div");
    label.className = "source-card-label";
    label.textContent = canvas.label;
    card.appendChild(label);

    card.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return; // primary button only
      onDragStart(canvas, e);
    });

    list.appendChild(card);
  }
}
