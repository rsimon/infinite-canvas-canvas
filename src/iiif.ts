// Minimal IIIF Presentation 2.x/3.x loader/normalizer. We only need
// read access to canvases + their painted images, so we normalize
// into SourceManifest/SourceCanvas/SourceImage (see types.ts), which
// mirrors Presentation 3 vocabulary even when the source is v2 — that's
// closer to where this editor's own output model should live.

import type { SourceManifest, SourceCanvas, SourceImage } from "./types";

type LanguageMap = Record<string, string[]>;

function pickLabel(label: unknown): string {
  if (!label) return "Untitled";
  if (typeof label === "string") return label;
  if (typeof label === "object") {
    const map = label as LanguageMap;
    const firstLang = Object.keys(map)[0];
    if (firstLang && map[firstLang]?.[0]) return map[firstLang][0];
  }
  return "Untitled";
}

export async function loadManifest(url: string): Promise<SourceManifest> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status}`);
  const json = await res.json();

  const isV2 = typeof json["@context"] === "string" && json["@context"].includes("/2/");
  return isV2 ? normalizeV2(json) : normalizeV3(json);
}

// --- IIIF Presentation 2.x ---

interface V2Service {
  "@id"?: string;
}

interface V2ImageResource {
  "@id": string;
  width?: number;
  height?: number;
  service?: V2Service | V2Service[];
}

interface V2Annotation {
  "@id": string;
  resource: V2ImageResource;
}

interface V2Canvas {
  "@id": string;
  label?: unknown;
  width: number;
  height: number;
  images?: V2Annotation[];
}

interface V2Manifest {
  "@id": string;
  label?: unknown;
  sequences?: { canvases?: V2Canvas[] }[];
}

function extractServiceUrl(service: unknown): string | undefined {
  if (!service) return undefined;
  const svc = Array.isArray(service) ? service[0] : service;
  if (!svc || typeof svc !== "object") return undefined;
  // IIIF Image API v2 uses "@id"; v3 uses "id"
  const url = (svc as Record<string, unknown>)["@id"] ?? (svc as Record<string, unknown>)["id"];
  return typeof url === "string" ? url.replace(/\/info\.json$/, "") : undefined;
}

function normalizeV2(json: V2Manifest): SourceManifest {
  const sequence = json.sequences?.[0] ?? { canvases: [] };
  const canvases: SourceCanvas[] = (sequence.canvases ?? []).map((c) => {
    const images: SourceImage[] = (c.images ?? []).map((anno, i) => ({
      id: anno["@id"] ?? `${c["@id"]}/image/${i}`,
      url: anno.resource["@id"],
      width: anno.resource.width ?? c.width,
      height: anno.resource.height ?? c.height,
      serviceUrl: extractServiceUrl(anno.resource.service),
    }));
    return {
      id: c["@id"],
      label: pickLabel(c.label),
      width: c.width,
      height: c.height,
      images,
    };
  });

  return { id: json["@id"], label: pickLabel(json.label), canvases };
}

// --- IIIF Presentation 3.x ---

interface V3Body {
  id: string;
  width?: number;
  height?: number;
  service?: unknown;
}

interface V3PaintingAnnotation {
  id: string;
  motivation: string;
  body?: V3Body;
}

interface V3AnnotationPage {
  items?: V3PaintingAnnotation[];
}

interface V3Canvas {
  id: string;
  label?: unknown;
  width: number;
  height: number;
  items?: V3AnnotationPage[];
}

interface V3Manifest {
  id: string;
  label?: unknown;
  items?: V3Canvas[];
}

function normalizeV3(json: V3Manifest): SourceManifest {
  const canvases: SourceCanvas[] = (json.items ?? []).map((c) => {
    const images: SourceImage[] = [];
    for (const annoPage of c.items ?? []) {
      for (const anno of annoPage.items ?? []) {
        if (anno.motivation !== "painting" || !anno.body) continue;
        images.push({
          id: anno.id,
          url: anno.body.id,
          width: anno.body.width ?? c.width,
          height: anno.body.height ?? c.height,
          serviceUrl: extractServiceUrl(anno.body.service),
        });
      }
    }
    return {
      id: c.id,
      label: pickLabel(c.label),
      width: c.width,
      height: c.height,
      images,
    };
  });

  return { id: json.id, label: pickLabel(json.label), canvases };
}
