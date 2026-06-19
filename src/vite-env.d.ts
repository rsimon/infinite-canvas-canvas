/// <reference types="vite/client" />

// OSD 5.x ships no TypeScript declarations and @types/openseadragon targets a
// different major version. Minimal hand-written stub: OSD is declared as both
// a callable factory function and a namespace (merged declaration), which is
// the standard @types pattern for legacy modules that double as namespaces.
// Everything we don't model explicitly uses { [k: string]: any } so property
// accesses still type-check without explicit declarations.
declare module "openseadragon" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function OSD(options: Record<string, any>): OSD.Viewer;

  namespace OSD {
    // --- Geometry ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface Point { x: number; y: number; [k: string]: any }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface Rect  { x: number; y: number; width: number; height: number; [k: string]: any }

    // Constructors exposed as namespace constants (new OpenSeadragon.Point / Rect).
    // The interface name and const name coexist in separate type/value worlds.
    const Point: new (x: number, y: number) => Point;
    const Rect:  new (x: number, y: number, width: number, height: number) => Rect;

    // --- Core classes: open-ended index signature so any OSD call type-checks ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface Viewer      { [k: string]: any }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface TiledImage  { [k: string]: any }

    // --- Event types used in addHandler callbacks ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface CanvasPressEvent   { position: Point; [k: string]: any }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface CanvasDragEvent    { position: Point; delta: Point; preventDefaultAction: boolean; [k: string]: any }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface CanvasClickEvent   { quick: boolean; position: Point; [k: string]: any }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface CanvasReleaseEvent { position: Point; [k: string]: any }
  }

  export = OSD;
}

