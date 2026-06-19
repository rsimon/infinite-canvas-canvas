import type { Selection, Workspace, WorkspaceImage } from "./types";

function filename(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).slice(-2).join("/"));
  } catch {
    return url;
  }
}

function round(n: number): number {
  return Math.round(n);
}

export function renderInspector(container: HTMLElement, workspace: Workspace, selection: Selection): void {
  container.innerHTML = "";

  const title = document.createElement("h2");
  title.textContent = "Inspector";
  container.appendChild(title);

  if (!selection) {
    const empty = document.createElement("p");
    empty.className = "panel-hint";
    empty.textContent = "Nothing selected. Click a canvas or an image in the workspace.";
    container.appendChild(empty);
    return;
  }

  const wc = workspace.canvases.find((c) => c.id === selection.canvasId);
  if (!wc) return;
  const index = workspace.canvases.indexOf(wc);

  const section = document.createElement("div");
  section.className = "inspector-section";

  const label = document.createElement("div");
  label.className = "inspector-canvas-label";
  label.textContent = `${index + 1}. ${wc.label}`;
  section.appendChild(label);

  const meta = document.createElement("div");
  meta.className = "inspector-meta";
  meta.textContent = `${round(wc.width)} × ${round(wc.height)} · ${wc.images.length} image${wc.images.length === 1 ? "" : "s"}`;
  section.appendChild(meta);

  container.appendChild(section);

  if (selection.type === "image") {
    const img = wc.images.find((i) => i.id === selection.imageId);
    if (img) {
      container.appendChild(renderImageDetail(img));
    }
  }

  const listTitle = document.createElement("h3");
  listTitle.textContent = "Images in this canvas";
  container.appendChild(listTitle);

  if (wc.images.length === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-hint";
    empty.textContent = "No images yet.";
    container.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "inspector-image-list";
    for (const img of wc.images) {
      const row = document.createElement("div");
      row.className = "inspector-image-row";
      if (selection.type === "image" && selection.imageId === img.id) {
        row.classList.add("selected");
      }

      const thumb = document.createElement("img");
      thumb.src = img.url;
      row.appendChild(thumb);

      const meta = document.createElement("div");
      meta.className = "inspector-image-row-meta";
      const name = document.createElement("div");
      name.className = "inspector-image-row-name";
      name.textContent = filename(img.url);
      const pos = document.createElement("div");
      pos.className = "inspector-image-row-pos";
      pos.textContent = `x:${round(img.x)} y:${round(img.y)} w:${round(img.w)} h:${round(img.h)}`;
      meta.appendChild(name);
      meta.appendChild(pos);
      row.appendChild(meta);

      list.appendChild(row);
    }
    container.appendChild(list);
  }
}

function renderImageDetail(img: WorkspaceImage): HTMLElement {
  const box = document.createElement("div");
  box.className = "inspector-section inspector-image-detail";

  const label = document.createElement("div");
  label.className = "inspector-image-detail-label";
  label.textContent = "Selected image";
  box.appendChild(label);

  const name = document.createElement("div");
  name.className = "inspector-meta";
  name.textContent = filename(img.url);
  box.appendChild(name);

  const grid = document.createElement("div");
  grid.className = "inspector-xywh-grid";
  for (const [k, v] of Object.entries({ x: img.x, y: img.y, w: img.w, h: img.h })) {
    const cell = document.createElement("div");
    cell.className = "inspector-xywh-cell";
    cell.innerHTML = `<span>${k}</span>${round(v)}`;
    grid.appendChild(cell);
  }
  box.appendChild(grid);

  return box;
}
