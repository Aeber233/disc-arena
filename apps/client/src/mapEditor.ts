import {
  applyEditableMapBrush,
  createDefaultEditableMapDocument,
  decodeEditableMapDocument,
  encodeEditableMapDocument,
  editableMapToMapData,
  EDITOR_MAP_MAX_HEIGHT_CELLS,
  EDITOR_MAP_MAX_WIDTH_CELLS,
  resizeEditableMapDocument
} from "@disc-arena/core";
import type {
  EditableBrushSize,
  EditableLayer,
  EditableMapDocument,
  EditableTool,
  GroundMaterial,
  MapCellShape,
  MapData,
  ObstacleMaterial,
  Vec2
} from "@disc-arena/core";

interface MapEditorElements {
  readonly panel: HTMLElement;
  readonly status: HTMLElement;
  readonly width: HTMLInputElement;
  readonly height: HTMLInputElement;
  readonly resizeMap: HTMLButtonElement;
  readonly saveDraft: HTMLButtonElement;
  readonly exportMap: HTMLButtonElement;
  readonly importMap: HTMLButtonElement;
  readonly importFile: HTMLInputElement;
}

export interface MapEditorController {
  readonly elements: MapEditorElements;
  render(): void;
  handlePointerDown(event: PointerEvent, screenPoint: Vec2): void;
  handlePointerMove(event: PointerEvent, screenPoint: Vec2): void;
  handlePointerUp(event: PointerEvent): void;
  handlePointerCancel(): void;
  handleWheel(event: WheelEvent, screenPoint: Vec2): void;
  currentDocument(): EditableMapDocument;
  currentMapData(): MapData;
}

type PaintMode = "idle" | "paint" | "pan";
type EditorTool = EditableTool | "drag";
type EditorTab = "tools" | "materials";
type BrushMode = "1" | "2" | "4" | "rect" | "circle";

interface PendingRegion {
  readonly kind: "rect" | "circle";
  readonly startCell: Vec2;
}

const DRAFT_STORAGE_KEY = "disc-arena.editable-map.draft.v1";
const baseCellPixels = 24;
const minZoom = 0.35;
const maxZoom = 8;

const groundColors: Record<GroundMaterial, string> = {
  void: "#303238",
  grass: "#1b5f3e",
  ice: "#9eddf2",
  sand: "#d8bd72"
};

const obstacleColors: Record<ObstacleMaterial, string> = {
  wood: "#b98545"
};

export function createMapEditor(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  elements: MapEditorElements
): MapEditorController {
  let document = loadDraft() ?? createDefaultEditableMapDocument();
  let activeTab: EditorTab = "tools";
  let activeLayer: EditableLayer = "ground";
  let activeTool: EditorTool = "add";
  let activeBrushMode: BrushMode = "1";
  let activeGroundMaterial: GroundMaterial = "grass";
  let activeObstacleMaterial: ObstacleMaterial = "wood";
  let mode: PaintMode = "idle";
  let camera = { x: 80, y: 80, zoom: 1 };
  let lastPointer: Vec2 | undefined;
  let hoverCell: Vec2 | undefined;
  let pendingRegion: PendingRegion | undefined;
  const tabButtons = queryButtons(elements.panel, "[data-editor-tab]");
  const tabPanels = queryElements(elements.panel, "[data-editor-tab-panel]");
  const toolButtons = queryButtons(elements.panel, "[data-editor-tool]");
  const brushButtons = queryButtons(elements.panel, "[data-editor-brush]");
  const groundMaterialButtons = queryButtons(
    elements.panel,
    "[data-editor-ground-material]"
  );
  const obstacleMaterialButtons = queryButtons(
    elements.panel,
    "[data-editor-obstacle-material]"
  );

  syncControlsFromState();
  updateStatus("Ready");

  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      activeTab = button.dataset.editorTab as EditorTab;
      pendingRegion = undefined;
      syncControlsFromState();
    });
  }
  for (const button of toolButtons) {
    button.addEventListener("click", () => {
      activeTool = button.dataset.editorTool as EditorTool;
      pendingRegion = undefined;
      syncControlsFromState();
    });
  }
  for (const button of brushButtons) {
    button.addEventListener("click", () => {
      activeBrushMode = button.dataset.editorBrush as BrushMode;
      pendingRegion = undefined;
      syncControlsFromState();
    });
  }
  for (const button of groundMaterialButtons) {
    button.addEventListener("click", () => {
      activeLayer = "ground";
      activeGroundMaterial = button.dataset.editorGroundMaterial as GroundMaterial;
      pendingRegion = undefined;
      syncControlsFromState();
    });
  }
  for (const button of obstacleMaterialButtons) {
    button.addEventListener("click", () => {
      activeLayer = "obstacle";
      activeObstacleMaterial = button.dataset.editorObstacleMaterial as ObstacleMaterial;
      pendingRegion = undefined;
      syncControlsFromState();
    });
  }
  elements.resizeMap.addEventListener("click", () => {
    document = resizeEditableMapDocument(
      document,
      Number(elements.width.value),
      Number(elements.height.value)
    );
    syncSizeControlsFromDocument();
    updateStatus(`Resized to ${document.widthCells}x${document.heightCells}`);
  });
  elements.saveDraft.addEventListener("click", () => {
    saveDraft(document);
    updateStatus("Draft saved");
  });
  elements.exportMap.addEventListener("click", () => {
    exportDocument(document);
    updateStatus("Exported code");
  });
  elements.importMap.addEventListener("click", () => {
    elements.importFile.click();
  });
  elements.importFile.addEventListener("change", () => {
    void importSelectedFile(elements.importFile);
  });

  return {
    elements,
    render,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleWheel,
    currentDocument: () => document,
    currentMapData: () => editableMapToMapData(document)
  };

  function render(): void {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    context.save();
    context.fillStyle = "#24262b";
    context.fillRect(0, 0, width, height);

    drawLayer(width, height, "ground");
    drawLayer(width, height, "obstacle");
    drawGrid();
    drawBrushPreview();
    context.restore();
  }

  function handlePointerDown(event: PointerEvent, screenPoint: Vec2): void {
    if (event.button === 2 && pendingRegion) {
      pendingRegion = undefined;
      updateStatus("Shape draw cancelled");
      return;
    }

    if (event.button === 1 || event.button === 2 || activeTool === "drag") {
      mode = "pan";
      lastPointer = screenPoint;
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const cell = screenToCell(screenPoint);
    hoverCell = cell;
    if (isRegionBrush(activeBrushMode)) {
      handleRegionClick(cell, activeBrushMode);
      return;
    }

    mode = "paint";
    paintAt(cell);
  }

  function handlePointerMove(_event: PointerEvent, screenPoint: Vec2): void {
    hoverCell = screenToCell(screenPoint);

    if (mode === "pan" && lastPointer) {
      camera = {
        ...camera,
        x: camera.x + screenPoint.x - lastPointer.x,
        y: camera.y + screenPoint.y - lastPointer.y
      };
      lastPointer = screenPoint;
      return;
    }

    if (mode === "paint") {
      paintAt(hoverCell);
    }
  }

  function handlePointerUp(_event: PointerEvent): void {
    mode = "idle";
    lastPointer = undefined;
  }

  function handlePointerCancel(): void {
    mode = "idle";
    lastPointer = undefined;
  }

  function handleWheel(event: WheelEvent, screenPoint: Vec2): void {
    event.preventDefault();
    const before = screenToGrid(screenPoint);
    const zoomDelta = event.deltaY < 0 ? 1.1 : 0.9;
    camera = { ...camera, zoom: clamp(camera.zoom * zoomDelta, minZoom, maxZoom) };
    const afterCellSize = cellPixels();
    camera = {
      ...camera,
      x: screenPoint.x - before.x * afterCellSize,
      y: screenPoint.y - before.y * afterCellSize
    };
  }

  function paintAt(cell: Vec2): void {
    if (!isCellInMap(cell)) {
      return;
    }

    document = applyEditableMapBrush(document, {
      layer: activeLayer,
      tool: editableTool(activeTool),
      brushSize: numericBrushSize(activeBrushMode),
      cellX: cell.x,
      cellY: cell.y,
      groundMaterial: activeGroundMaterial,
      obstacleMaterial: activeObstacleMaterial
    });
    updateStatus(`${document.name} | ${document.widthCells}x${document.heightCells}`);
  }

  function handleRegionClick(cell: Vec2, brushMode: "rect" | "circle"): void {
    if (!isCellInMap(cell)) {
      return;
    }

    if (!pendingRegion || pendingRegion.kind !== brushMode) {
      pendingRegion = { kind: brushMode, startCell: cell };
      updateStatus("Select P2, right-click to cancel");
      return;
    }

    paintCells(regionCells(pendingRegion.startCell, cell, brushMode));
    pendingRegion = undefined;
    updateStatus(`${document.name} | ${document.widthCells}x${document.heightCells}`);
  }

  function paintCells(cells: readonly Vec2[]): void {
    for (const cell of cells) {
      document = applyEditableMapBrush(document, {
        layer: activeLayer,
        tool: editableTool(activeTool),
        brushSize: 1,
        cellX: cell.x,
        cellY: cell.y,
        groundMaterial: activeGroundMaterial,
        obstacleMaterial: activeObstacleMaterial
      });
    }
  }

  function drawLayer(_width: number, _height: number, layer: EditableLayer): void {
    const size = cellPixels();
    for (let y = 0; y < document.heightCells; y += 1) {
      for (let x = 0; x < document.widthCells; x += 1) {
        const screen = cellToScreen(x, y);
        if (layer === "ground") {
          const cell = document.groundLayer[cellIndex(x, y)];
          if (cell) {
            fillCellShape(screen.x, screen.y, size, cell.shape, groundColors[cell.material]);
          }
        } else {
          const cell = document.obstacleLayer[cellIndex(x, y)];
          if (cell) {
            fillCellShape(screen.x, screen.y, size, cell.shape, obstacleColors[cell.material]);
          }
        }
      }
    }
  }

  function drawGrid(): void {
    const size = cellPixels();
    const width = document.widthCells * size;
    const height = document.heightCells * size;

    for (let x = 0; x <= document.widthCells; x += 1) {
      const screenX = camera.x + x * size;
      context.beginPath();
      context.moveTo(screenX, camera.y);
      context.lineTo(screenX, camera.y + height);
      context.strokeStyle = gridColor(x);
      context.lineWidth = gridWidth(x);
      context.stroke();
    }

    for (let y = 0; y <= document.heightCells; y += 1) {
      const screenY = camera.y + y * size;
      context.beginPath();
      context.moveTo(camera.x, screenY);
      context.lineTo(camera.x + width, screenY);
      context.strokeStyle = gridColor(y);
      context.lineWidth = gridWidth(y);
      context.stroke();
    }
  }

  function drawBrushPreview(): void {
    if (!hoverCell || !isCellInMap(hoverCell)) {
      return;
    }

    if (pendingRegion) {
      if (pendingRegion.kind === "rect") {
        drawRectPreview(pendingRegion.startCell, hoverCell);
      } else {
        drawCirclePreview(pendingRegion.startCell, hoverCell);
      }
      return;
    }

    if (isRegionBrush(activeBrushMode) || activeTool === "drag") {
      return;
    }

    const size = cellPixels();
    const screen = cellToScreen(hoverCell.x, hoverCell.y);
    context.save();
    context.strokeStyle = "#fff";
    context.lineWidth = 2;
    context.setLineDash([8, 5]);
    context.strokeRect(
      screen.x,
      screen.y,
      numericBrushSize(activeBrushMode) * size,
      numericBrushSize(activeBrushMode) * size
    );
    context.restore();
  }

  function drawRectPreview(start: Vec2, end: Vec2): void {
    const size = cellPixels();
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const right = Math.max(start.x, end.x);
    const bottom = Math.max(start.y, end.y);
    const screen = cellToScreen(left, top);
    drawDashedPreviewPath(() => {
      context.rect(
        screen.x,
        screen.y,
        (right - left + 1) * size,
        (bottom - top + 1) * size
      );
    });
  }

  function drawCirclePreview(start: Vec2, end: Vec2): void {
    const center = cellCenterToScreen(start);
    const edge = cellCenterToScreen(end);
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
    drawDashedPreviewPath(() => {
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    });
  }

  function drawDashedPreviewPath(addPath: () => void): void {
    context.save();
    context.beginPath();
    addPath();
    context.strokeStyle = "rgba(0,0,0,0.9)";
    context.lineWidth = 2;
    context.setLineDash([8, 6]);
    context.stroke();
    context.restore();
  }

  function fillCellShape(
    x: number,
    y: number,
    size: number,
    shape: MapCellShape,
    color: string
  ): void {
    context.beginPath();
    addCellShapePath(x, y, size, shape);
    context.closePath();
    context.fillStyle = color;
    context.fill();
  }

  function addCellShapePath(x: number, y: number, size: number, shape: MapCellShape): void {
    if (shape === 1) {
      context.moveTo(x, y);
      context.lineTo(x + size, y);
      context.lineTo(x, y + size);
      return;
    }
    if (shape === 2) {
      context.moveTo(x, y);
      context.lineTo(x + size, y);
      context.lineTo(x + size, y + size);
      return;
    }
    if (shape === 3) {
      context.moveTo(x + size, y);
      context.lineTo(x + size, y + size);
      context.lineTo(x, y + size);
      return;
    }
    if (shape === 4) {
      context.moveTo(x, y);
      context.lineTo(x + size, y + size);
      context.lineTo(x, y + size);
      return;
    }

    context.rect(x, y, size, size);
  }

  async function importSelectedFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }

    try {
      const imported = decodeEditableMapDocument(await file.text());
      document = imported;
      syncSizeControlsFromDocument();
      updateStatus("Imported code");
    } catch (error) {
      updateStatus(error instanceof Error ? error.message : "Import failed");
    }
  }

  function syncControlsFromState(): void {
    syncButtonGroup(tabButtons, (button) => button.dataset.editorTab === activeTab);
    syncButtonGroup(toolButtons, (button) => button.dataset.editorTool === activeTool);
    syncButtonGroup(
      brushButtons,
      (button) => button.dataset.editorBrush === activeBrushMode
    );
    syncButtonGroup(
      groundMaterialButtons,
      (button) => button.dataset.editorGroundMaterial === activeGroundMaterial
    );
    syncButtonGroup(
      obstacleMaterialButtons,
      (button) => button.dataset.editorObstacleMaterial === activeObstacleMaterial
    );
    for (const panel of tabPanels) {
      panel.hidden = panel.getAttribute("data-editor-tab-panel") !== activeTab;
    }
    elements.width.max = String(EDITOR_MAP_MAX_WIDTH_CELLS);
    elements.height.max = String(EDITOR_MAP_MAX_HEIGHT_CELLS);
    syncSizeControlsFromDocument();
  }

  function syncSizeControlsFromDocument(): void {
    elements.width.value = String(document.widthCells);
    elements.height.value = String(document.heightCells);
  }

  function updateStatus(text: string): void {
    elements.status.textContent = text;
  }

  function cellPixels(): number {
    return baseCellPixels * camera.zoom;
  }

  function cellToScreen(x: number, y: number): Vec2 {
    const size = cellPixels();
    return {
      x: camera.x + x * size,
      y: camera.y + y * size
    };
  }

  function cellCenterToScreen(cell: Vec2): Vec2 {
    const size = cellPixels();
    return {
      x: camera.x + (cell.x + 0.5) * size,
      y: camera.y + (cell.y + 0.5) * size
    };
  }

  function screenToGrid(point: Vec2): Vec2 {
    const size = cellPixels();
    return {
      x: (point.x - camera.x) / size,
      y: (point.y - camera.y) / size
    };
  }

  function screenToCell(point: Vec2): Vec2 {
    const grid = screenToGrid(point);
    return {
      x: Math.floor(grid.x),
      y: Math.floor(grid.y)
    };
  }

  function isCellInMap(cell: Vec2): boolean {
    return (
      cell.x >= 0 &&
      cell.y >= 0 &&
      cell.x < document.widthCells &&
      cell.y < document.heightCells
    );
  }

  function cellIndex(x: number, y: number): number {
    return y * document.widthCells + x;
  }

  function regionCells(start: Vec2, end: Vec2, kind: "rect" | "circle"): Vec2[] {
    return kind === "rect" ? rectCells(start, end) : circleCells(start, end);
  }

  function rectCells(start: Vec2, end: Vec2): Vec2[] {
    const cells: Vec2[] = [];
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const right = Math.max(start.x, end.x);
    const bottom = Math.max(start.y, end.y);
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (isCellInMap({ x, y })) {
          cells.push({ x, y });
        }
      }
    }
    return cells;
  }

  function circleCells(start: Vec2, end: Vec2): Vec2[] {
    const cells: Vec2[] = [];
    const radius = Math.hypot(end.x - start.x, end.y - start.y);
    const left = Math.floor(start.x - radius);
    const top = Math.floor(start.y - radius);
    const right = Math.ceil(start.x + radius);
    const bottom = Math.ceil(start.y + radius);
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const cell = { x, y };
        const distanceToCenter = Math.hypot(x - start.x, y - start.y);
        if (isCellInMap(cell) && distanceToCenter <= radius + 0.0001) {
          cells.push(cell);
        }
      }
    }
    return cells;
  }
}

function isRegionBrush(brushMode: BrushMode): brushMode is "rect" | "circle" {
  return brushMode === "rect" || brushMode === "circle";
}

function numericBrushSize(brushMode: BrushMode): EditableBrushSize {
  if (brushMode === "2") {
    return 2;
  }
  if (brushMode === "4") {
    return 4;
  }
  return 1;
}

function editableTool(tool: EditorTool = "add"): EditableTool {
  return tool === "drag" ? "add" : tool;
}

function queryButtons(root: HTMLElement, selector: string): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>(selector)];
}

function queryElements(root: HTMLElement, selector: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)];
}

function syncButtonGroup(
  buttons: readonly HTMLButtonElement[],
  isActive: (button: HTMLButtonElement) => boolean
): void {
  for (const button of buttons) {
    button.classList.toggle("is-active", isActive(button));
  }
}

function loadDraft(): EditableMapDocument | undefined {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    return raw ? decodeEditableMapDocument(raw) : undefined;
  } catch {
    return undefined;
  }
}

function saveDraft(document: EditableMapDocument): void {
  localStorage.setItem(DRAFT_STORAGE_KEY, encodeEditableMapDocument(document));
}

function exportDocument(document: EditableMapDocument): void {
  const blob = new Blob([`${encodeEditableMapDocument(document)}\n`], {
    type: "text/plain"
  });
  const url = URL.createObjectURL(blob);
  const link = documentElement("a");
  link.href = url;
  link.download = `${document.id}.damap`;
  link.click();
  URL.revokeObjectURL(url);
}

function documentElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K
): HTMLElementTagNameMap[K] {
  return document.createElement(tagName);
}

function gridWidth(index: number): number {
  if (index % 4 === 0) {
    return 1.8;
  }
  if (index % 2 === 0) {
    return 1.1;
  }
  return 0.55;
}

function gridColor(index: number): string {
  if (index % 4 === 0) {
    return "rgba(255,255,255,0.4)";
  }
  if (index % 2 === 0) {
    return "rgba(255,255,255,0.28)";
  }
  return "rgba(255,255,255,0.16)";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
