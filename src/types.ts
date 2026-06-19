// --- Source manifest (read-only, normalized from IIIF v2/v3) ---

export interface SourceImage {
  id: string;
  url: string;
  width: number;
  height: number;
  /** IIIF Image API service base URL (without trailing slash), if present.
   * When set, OSD loads via info.json for full deep-zoom capability. */
  serviceUrl?: string;
}

export interface SourceCanvas {
  id: string;
  label: string;
  width: number;
  height: number;
  images: SourceImage[];
}

export interface SourceManifest {
  id: string;
  label: string;
  canvases: SourceCanvas[];
}

// --- Workspace (the editor's own model, the thing being authored) ---

/** xywh in the owning canvas's local coordinate units. */
export interface WorkspaceImage {
  id: string;
  sourceImageId: string;
  url: string;
  serviceUrl?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Mirrors IIIF Canvas-level behavior values relevant to pagination. */
export type CanvasBehavior = "non-paged" | "facing-pages" | null;

export interface WorkspaceCanvas {
  id: string;
  sourceCanvasId: string;
  label: string;
  /** Canvas's own coordinate space size (its "page size"), in canvas-local units. */
  width: number;
  height: number;
  behavior: CanvasBehavior;
  images: WorkspaceImage[];
}

/** Mirrors IIIF Manifest viewingDirection. */
export type ViewingDirection = "left-to-right" | "right-to-left" | "top-to-bottom" | "bottom-to-top";

/** Mirrors IIIF Manifest-level layout behavior (the subset relevant here). */
export type ManifestBehavior = "individuals" | "paged" | "continuous";

export interface WorkspaceLayout {
  mode: "grid" | "reading";
  columns: number;
  /** World units between grid slots. */
  gutter: number;
  slotWidth: number;
  slotHeight: number;
}

export interface Workspace {
  layout: WorkspaceLayout;
  behavior: ManifestBehavior;
  viewingDirection: ViewingDirection;
  canvases: WorkspaceCanvas[];
}

// --- Derived / render-time geometry ---

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A workspace canvas's rendered rectangle in world (viewport) coordinates. */
export interface Frame extends Rect {
  canvasId: string;
  index: number;
  slotBox: Rect;
  /** World-units-per-canvas-local-unit, for converting points into the canvas's xywh space. */
  scale: number;
}

export type DropIndicator =
  | { kind: "box"; rect: Rect }
  | { kind: "line"; rect: Rect };

// --- Editor (UI) state ---

export type Selection =
  | { type: "canvas"; canvasId: string }
  | { type: "image"; canvasId: string; imageId: string }
  | null;
