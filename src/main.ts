import OpenSeadragon from "openseadragon";
import { loadManifest } from "./iiif.js";
import { createWorkspace, setColumns, subscribe } from "./model.js";
import { syncWorld, type RenderState } from "./osdSync.js";
import { renderSourcePanel } from "./sourcePanel.js";
import { setupDragController } from "./dragController.js";
import { setupCanvasInteractions } from "./canvasInteractions.js";
import { renderInspector } from "./inspector.js";
import { getSelection, subscribeSelection } from "./selection.js";
import { tableBounds } from "./layout.js";
import { resizeImage } from "./model.js";
import { setupResizeHandles } from "./resizeHandles.js";
import "./style.css";

const SOURCE_MANIFEST_URL = "https://byabbe.se/codicum-static-iiif-playground/manifest.json";
// const SOURCE_MANIFEST_URL = "https://iiif.bodleian.ox.ac.uk/iiif/manifest/441db95d-cdff-472e-bb2d-b46f043db82d.json";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="layout">
    <aside class="sidebar" id="sourcePanel"></aside>
    <main class="workspace-area">
      <div class="toolbar">
        <label>
          Columns:
          <input type="number" id="columnsInput" min="1" max="8" value="3" />
        </label>
        <span class="toolbar-hint">Drag pages in from the left. Click a canvas or image to select it; drag an image to reposition it within its canvas.</span>
      </div>
      <div id="osdContainer" class="osd-container"></div>
    </main>
    <aside class="sidebar inspector" id="inspectorPanel"></aside>
  </div>
`;

const osdContainer = document.querySelector<HTMLDivElement>("#osdContainer")!;
const sourcePanelEl = document.querySelector<HTMLElement>("#sourcePanel")!;
const inspectorEl = document.querySelector<HTMLElement>("#inspectorPanel")!;
const columnsInput = document.querySelector<HTMLInputElement>("#columnsInput")!;

const workspace = createWorkspace();
let renderState: RenderState = { frames: [], tiledImagesByImageId: new Map(), selectedImageRingEl: null };

const viewer = OpenSeadragon({
  element: osdContainer,
  showNavigationControl: true,
  showNavigator: true,
  prefixUrl: "https://openseadragon.github.io/openseadragon/images/",
  navigatorPosition: "BOTTOM_RIGHT",
  gestureSettingsMouse: { clickToZoom: false },
  // 0 = no constraint: user can freely pan to empty workspace area.
  // The default (0.5) and the previous setting (1.0) both spring the viewport
  // back when the world items don't fill the viewport edge-to-edge, which
  // fights the user on an infinite-canvas where panning to empty grid space
  // is intentional.
  visibilityRatio: 0,
  constrainDuringPan: false,
  minZoomImageRatio: 0.1,
  maxZoomPixelRatio: 4,
  // We rebuild the whole World on every model change (removeAll + re-add).
  // Without this, OSD auto-calls viewport.goHome() the moment the world's
  // item count passes through 1 -- which happens on every single rebuild,
  // not just the first one -- resetting pan/zoom on every drop.
  preserveViewport: true,
});

// Establish the initial viewport over the empty grid so OSD overlays
// (drop indicators, etc.) have a valid coordinate mapping before any
// content is added. Without this, viewer.addOverlay on an empty world
// has no coordinate system to anchor to and fills the viewport.
//
// The padding must match what syncWorld uses in its auto-fit on first
// drop (unionRect(frameUnion, tableBounds) + 10%), so the drop
// placeholder and the materialized canvas appear at the same screen
// position and scale.
{
  const b = tableBounds(workspace);
  const padding = Math.max(b.w, b.h) * 0.1;
  viewer.viewport.fitBounds(
    new OpenSeadragon.Rect(b.x - padding, b.y - padding, b.w + padding * 2, b.h + padding * 2),
    true
  );
}

// Defer all world rebuilds to a requestAnimationFrame callback so they always
// run OUTSIDE any OSD event handler. Calling viewer.world.removeAll() from
// inside canvas-click or canvas-release corrupts OSD's internal gesture state
// (accumulated pan delta, zoom resets), producing erratic viewport jumps and
// partial renders where syncWorld crashes before renderInspector is reached.
let pendingFit = false;
let pendingRaf: number | null = null;

function scheduleRender({ fit = false }: { fit?: boolean } = {}): void {
  pendingFit = pendingFit || fit;
  if (pendingRaf !== null) return; // coalesce back-to-back notifications into one frame
  pendingRaf = requestAnimationFrame(() => {
    pendingRaf = null;
    const doFit = pendingFit;
    pendingFit = false;
    renderState = syncWorld(viewer, workspace, getSelection(), { fit: doFit });
    renderInspector(inspectorEl, workspace, getSelection());
    // Reposition handles immediately after every world rebuild. OSD animation
    // events would eventually do this, but tiledImagesByImageId is populated
    // asynchronously (success callbacks), so the model-fallback path in
    // refreshHandles covers the window before they fire.
    refreshHandles();
  });
}

// Auto-fit the viewport the first time a canvas lands in the workspace.
// hasAutoFitted is set synchronously (before the deferred render fires) so a
// second rapid drop doesn't re-trigger the fit.
let hasAutoFitted = false;
subscribe(() => {
  const shouldFit = !hasAutoFitted && workspace.canvases.length > 0;
  if (shouldFit) hasAutoFitted = true;
  scheduleRender({ fit: shouldFit });
});
// refreshHandles is filled in after setupResizeHandles is called below.
// The closure over the variable (not its initial no-op value) means the
// subscription always calls the real implementation once it's assigned.
let refreshHandles: () => void = () => {};

subscribeSelection(() => {
  scheduleRender();
  refreshHandles();
});

setupCanvasInteractions({
  viewer,
  osdContainer,
  getWorkspace: () => workspace,
  getRenderState: () => renderState,
});

({ refreshHandles } = setupResizeHandles({
  viewer,
  osdContainer,
  getSelection,
  getWorkspace: () => workspace,
  getRenderState: () => renderState,
  onResizeCommit: (canvasId, imageId, x, y, w, h) => {
    resizeImage(workspace, canvasId, imageId, x, y, w, h);
    // resizeImage fires notify → workspace subscriber → scheduleRender.
    // Also refresh handles immediately from updated model data so they don't
    // flicker back to the pre-resize position before the RAF fires.
    refreshHandles();
  },
}));

const dragController = setupDragController({
  viewer,
  osdContainer,
  getWorkspace: () => workspace,
  getRenderState: () => renderState,
});

columnsInput.addEventListener("change", (e) => {
  const cols = parseInt((e.target as HTMLInputElement).value, 10) || 1;
  setColumns(workspace, cols);
});

loadManifest(SOURCE_MANIFEST_URL)
  .then((sourceManifest) => {
    renderSourcePanel(sourcePanelEl, sourceManifest, (sourceCanvas, pointerEvent) => {
      dragController.startDrag(sourceCanvas, pointerEvent);
    });
  })
  .catch((err: Error) => {
    sourcePanelEl.innerHTML = `<p class="error">Failed to load source manifest: ${err.message}</p>`;
    console.error(err);
  });

// Initial render (empty workspace — sets up the inspector).
scheduleRender();
