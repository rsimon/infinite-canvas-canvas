import OpenSeadragon from "openseadragon";
import { loadManifest } from "./iiif.js";
import { createWorkspace, setColumns, subscribe } from "./model.js";
import { syncWorld, type RenderState } from "./osdSync.js";
import { renderSourcePanel } from "./sourcePanel.js";
import { setupDragController } from "./dragController.js";
import { setupCanvasInteractions } from "./canvasInteractions.js";
import { renderInspector } from "./inspector.js";
import { getSelection, subscribeSelection } from "./selection.js";
import "./style.css";

const SOURCE_MANIFEST_URL = "https://byabbe.se/codicum-static-iiif-playground/manifest.json";

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
let renderState: RenderState = { frames: [], tiledImagesByImageId: new Map() };

const viewer = OpenSeadragon({
  element: osdContainer,
  showNavigationControl: true,
  showNavigator: true,
  navigatorPosition: "BOTTOM_RIGHT",
  gestureSettingsMouse: { clickToZoom: false },
  visibilityRatio: 1,
  constrainDuringPan: false,
  minZoomImageRatio: 0.1,
  maxZoomPixelRatio: 4,
});

function rerender({ fit = false }: { fit?: boolean } = {}): void {
  renderState = syncWorld(viewer, workspace, getSelection(), { fit });
  renderInspector(inspectorEl, workspace, getSelection());
}

// Auto-fit the viewport the first time a canvas lands in the workspace,
// so the user isn't staring at an empty/unzoomed view. After that we
// leave their pan/zoom alone on every subsequent edit.
let hasAutoFitted = false;
subscribe(() => {
  const shouldFit = !hasAutoFitted && workspace.canvases.length > 0;
  rerender({ fit: shouldFit });
  if (shouldFit) hasAutoFitted = true;
});
subscribeSelection(() => rerender());

setupCanvasInteractions({
  viewer,
  osdContainer,
  getWorkspace: () => workspace,
  getRenderState: () => renderState,
});

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

// Initial empty render so OSD has its viewport/navigator/inspector set up.
rerender();
