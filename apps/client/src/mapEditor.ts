import {
  applyEditableMapBrush,
  createDefaultEditableMapDocument,
  decodeEditableMapDocument,
  encodeEditableMapDocument,
  editableMapToMapData,
  EDITABLE_PORTAL_MIN_LENGTH_CELLS,
  EDITABLE_PORTAL_WIDTH_CELLS,
  EDITOR_MAP_MAX_HEIGHT_CELLS,
  EDITOR_MAP_MAX_WIDTH_CELLS,
  resizeEditableMapDocument,
  setEditablePortalPair,
  toggleEditablePortalPair
} from "@disc-arena/core";
import type {
  EditableBrushSize,
  EditableLayer,
  EditableMapDocument,
  EditablePortalEndpointId,
  EditablePortalPair,
  EditablePortalPairId,
  EditableTool,
  GroundMaterial,
  MapCellShape,
  MapData,
  ObstacleMaterial,
  Vec2
} from "@disc-arena/core";
import { materialEdgeColor } from "./colors";

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

type PaintMode =
  | "idle"
  | "paint"
  | "pan"
  | "portal_pending"
  | "portal_move"
  | "portal_resize"
  | "portal_rotate";
type EditorTool = EditableTool | "drag";
type EditorMenu = "tools" | "materials" | "resize" | "special";
type BrushMode = "1" | "2" | "4" | "rect" | "circle";
type PortalHitPart = "body" | "head" | "tail";

interface PendingRegion {
  readonly kind: "rect" | "circle";
  readonly startCell: Vec2;
}

interface GridEdge {
  readonly start: Vec2;
  readonly end: Vec2;
}

interface LayerBoundaryEdge extends GridEdge {
  readonly color: string;
}

interface FilledLayerCell {
  readonly shape: MapCellShape;
  readonly color: string;
}

interface PortalHitTarget {
  readonly pairId: EditablePortalPairId;
  readonly endpointId: EditablePortalEndpointId;
  readonly part: PortalHitPart;
}

interface PortalDragState {
  readonly target: PortalHitTarget;
  readonly startGrid: Vec2;
  lastGrid: Vec2;
  longPressTimer?: number;
}

const DRAFT_STORAGE_KEY = "disc-arena.editable-map.draft.v1";
const baseCellPixels = 24;
const minZoom = 0.12;
const maxZoom = 8;
const portalLongPressMs = 320;
const portalMoveThresholdCells = 0.18;

const groundColors: Record<GroundMaterial, string> = {
  void: "#303238",
  grass: "#1b5f3e",
  ice: "#9eddf2",
  sand: "#d8bd72"
};

const obstacleColors: Record<ObstacleMaterial, string> = {
  wood: "#8f3f2f"
};

const groundEdgeColors = materialColorMap(groundColors);
const obstacleEdgeColors = materialColorMap(obstacleColors);

const portalColors: Record<
  EditablePortalPairId,
  { readonly base: string; readonly highlight: string; readonly cap: string; readonly outline: string }
> = {
  portal1: {
    base: "#1378d8",
    highlight: "#8fc8ef",
    cap: "#9298a3",
    outline: "#07345f"
  },
  portal2: {
    base: "#8b32dc",
    highlight: "#c9a6e9",
    cap: "#9298a3",
    outline: "#3c1761"
  }
};

export function createMapEditor(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  elements: MapEditorElements
): MapEditorController {
  let document = loadDraft() ?? createDefaultEditableMapDocument();
  let activeMenu: EditorMenu | undefined;
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
  let portalDrag: PortalDragState | undefined;
  const menuButtons = queryButtons(elements.panel, "[data-editor-menu]");
  const menuPanels = queryElements(elements.panel, "[data-editor-menu-panel]");
  const toolButtons = queryButtons(elements.panel, "[data-editor-tool]");
  const brushButtons = queryButtons(elements.panel, "[data-editor-brush]");
  const specialPortalButtons = queryButtons(elements.panel, "[data-editor-special-portal]");
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

  for (const button of menuButtons) {
    button.addEventListener("click", () => {
      const nextMenu = button.dataset.editorMenu as EditorMenu;
      activeMenu = activeMenu === nextMenu ? undefined : nextMenu;
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
  for (const button of specialPortalButtons) {
    button.addEventListener("click", () => {
      const portalPairId = button.dataset.editorSpecialPortal as EditablePortalPairId;
      document = toggleEditablePortalPair(document, portalPairId);
      pendingRegion = undefined;
      clearPortalDrag();
      syncControlsFromState();
      const exists = document.portalLayer.some((pair) => pair.id === portalPairId);
      updateStatus(`${portalPairId} ${exists ? "added" : "removed"}`);
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
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#24262b";
    context.fillRect(0, 0, width, height);

    drawLayer(width, height, "ground");
    drawLayerInnerOutline("ground");
    drawPortalLayer();
    drawLayer(width, height, "obstacle");
    drawLayerInnerOutline("obstacle");
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
    const grid = screenToGrid(screenPoint);
    hoverCell = cell;
    const portalHit = hitTestPortals(grid);
    if (portalHit) {
      startPortalEdit(portalHit, grid);
      return;
    }

    if (isRegionBrush(activeBrushMode)) {
      handleRegionClick(cell, activeBrushMode);
      return;
    }

    mode = "paint";
    paintAt(cell);
  }

  function handlePointerMove(_event: PointerEvent, screenPoint: Vec2): void {
    hoverCell = screenToCell(screenPoint);
    const grid = screenToGrid(screenPoint);

    if (mode === "pan" && lastPointer) {
      camera = {
        ...camera,
        x: camera.x + screenPoint.x - lastPointer.x,
        y: camera.y + screenPoint.y - lastPointer.y
      };
      lastPointer = screenPoint;
      return;
    }

    if (isPortalEditMode(mode)) {
      updatePortalEdit(grid);
      return;
    }

    if (mode === "paint") {
      paintAt(hoverCell);
    }
  }

  function handlePointerUp(_event: PointerEvent): void {
    clearPortalDrag();
    mode = "idle";
    lastPointer = undefined;
  }

  function handlePointerCancel(): void {
    clearPortalDrag();
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

  function startPortalEdit(target: PortalHitTarget, grid: Vec2): void {
    pendingRegion = undefined;
    clearPortalDrag();
    portalDrag = {
      target,
      startGrid: grid,
      lastGrid: grid
    };

    if (target.part === "body") {
      mode = "portal_pending";
      portalDrag.longPressTimer = window.setTimeout(() => {
        if (mode === "portal_pending" && portalDrag?.target === target) {
          mode = "portal_rotate";
          updateStatus("Rotate portal");
        }
      }, portalLongPressMs);
      updateStatus("Drag to move, hold to rotate");
      return;
    }

    mode = "portal_resize";
    updateStatus("Drag portal end to resize pair");
  }

  function updatePortalEdit(grid: Vec2): void {
    if (!portalDrag) {
      return;
    }

    if (mode === "portal_pending") {
      if (gridDistance(grid, portalDrag.startGrid) < portalMoveThresholdCells) {
        return;
      }
      clearPortalLongPressTimer();
      mode = "portal_move";
    }

    if (mode === "portal_move") {
      movePortalEndpoint(portalDrag.target, subGrid(grid, portalDrag.lastGrid));
      portalDrag.lastGrid = grid;
      return;
    }

    if (mode === "portal_resize") {
      resizePortalPair(portalDrag.target, grid);
      portalDrag.lastGrid = grid;
      return;
    }

    if (mode === "portal_rotate") {
      rotatePortalEndpoint(portalDrag.target, grid);
      portalDrag.lastGrid = grid;
    }
  }

  function movePortalEndpoint(target: PortalHitTarget, delta: Vec2): void {
    updatePortalPair(target.pairId, (pair) => ({
      ...pair,
      [target.endpointId]: {
        ...pair[target.endpointId],
        center: {
          x: pair[target.endpointId].center.x + delta.x,
          y: pair[target.endpointId].center.y + delta.y
        }
      }
    }));
  }

  function resizePortalPair(target: PortalHitTarget, grid: Vec2): void {
    const pair = findPortalPair(target.pairId);
    if (!pair) {
      return;
    }
    const endpoint = pair[target.endpointId];
    const tangent = tangentFromAngle(endpoint.angle);
    const fromCenter = subGrid(grid, endpoint.center);
    const projectedHalfLength = Math.abs(dotGrid(fromCenter, tangent));
    const nextLength = Math.max(
      EDITABLE_PORTAL_MIN_LENGTH_CELLS,
      Math.round(projectedHalfLength * 2)
    );
    updatePortalPair(target.pairId, (current) => ({
      ...current,
      lengthCells: nextLength
    }));
  }

  function rotatePortalEndpoint(target: PortalHitTarget, grid: Vec2): void {
    const pair = findPortalPair(target.pairId);
    if (!pair) {
      return;
    }
    const endpoint = pair[target.endpointId];
    const delta = subGrid(grid, endpoint.center);
    if (gridDistance(delta, { x: 0, y: 0 }) < 0.001) {
      return;
    }
    updatePortalPair(target.pairId, (current) => ({
      ...current,
      [target.endpointId]: {
        ...current[target.endpointId],
        angle: Math.atan2(delta.y, delta.x)
      }
    }));
  }

  function updatePortalPair(
    portalPairId: EditablePortalPairId,
    updater: (pair: EditablePortalPair) => EditablePortalPair
  ): void {
    const pair = findPortalPair(portalPairId);
    if (!pair) {
      return;
    }
    document = setEditablePortalPair(document, updater(pair));
    syncControlsFromState();
    updateStatus(`${portalPairId} edited`);
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

  function drawLayerInnerOutline(layer: EditableLayer): void {
    const edges = layerBoundaryEdges(layer);
    if (edges.length === 0) {
      return;
    }

    context.save();
    context.beginPath();
    addLayerClipPath(layer);
    context.clip();
    context.lineWidth = Math.max(2, Math.round(cellPixels() * 0.14));
    context.lineJoin = "miter";
    context.lineCap = "butt";

    for (const edge of edges) {
      const start = gridToScreen(edge.start);
      const end = gridToScreen(edge.end);
      context.strokeStyle = edge.color;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
    context.restore();
  }

  function addLayerClipPath(layer: EditableLayer): void {
    for (let y = 0; y < document.heightCells; y += 1) {
      for (let x = 0; x < document.widthCells; x += 1) {
        const cell = filledLayerCell(layer, x, y);
        if (!cell) {
          continue;
        }
        const screen = cellToScreen(x, y);
        addCellShapePath(screen.x, screen.y, cellPixels(), cell.shape);
        context.closePath();
      }
    }
  }

  function layerBoundaryEdges(layer: EditableLayer): readonly LayerBoundaryEdge[] {
    const edgeCounts = new Map<
      string,
      { readonly edge: LayerBoundaryEdge; count: number }
    >();

    for (let y = 0; y < document.heightCells; y += 1) {
      for (let x = 0; x < document.widthCells; x += 1) {
        const cell = filledLayerCell(layer, x, y);
        if (!cell) {
          continue;
        }
        for (const edge of gridCellEdges(x, y, cell.shape)) {
          const colorEdge = { ...edge, color: cell.color };
          const key = `${cell.color}:${normalizedGridEdgeKey(edge)}`;
          const existing = edgeCounts.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            edgeCounts.set(key, { edge: colorEdge, count: 1 });
          }
        }
      }
    }

    return [...edgeCounts.values()]
      .filter((entry) => entry.count === 1)
      .map((entry) => entry.edge);
  }

  function filledLayerShape(
    layer: EditableLayer,
    x: number,
    y: number
  ): MapCellShape | undefined {
    return filledLayerCell(layer, x, y)?.shape;
  }

  function filledLayerCell(
    layer: EditableLayer,
    x: number,
    y: number
  ): FilledLayerCell | undefined {
    const index = cellIndex(x, y);
    if (layer === "ground") {
      const cell = document.groundLayer[index];
      return cell && cell.material !== "void"
        ? { shape: cell.shape, color: groundEdgeColors[cell.material] }
        : undefined;
    }

    const cell = document.obstacleLayer[index];
    return cell ? { shape: cell.shape, color: obstacleEdgeColors[cell.material] } : undefined;
  }

  function drawPortalLayer(): void {
    for (const pair of document.portalLayer) {
      drawPortalEndpoint(pair, "a");
      drawPortalEndpoint(pair, "b");
    }
  }

  function drawPortalEndpoint(
    pair: EditablePortalPair,
    endpointId: EditablePortalEndpointId
  ): void {
    const endpoint = pair[endpointId];
    const center = gridToScreen(endpoint.center);
    const size = cellPixels();
    const width = EDITABLE_PORTAL_WIDTH_CELLS * size;
    const radius = width / 2;
    const length = pair.lengthCells * size;
    const halfLength = length / 2;
    const colors = portalColors[pair.id];

    context.save();
    context.translate(center.x, center.y);
    context.rotate(endpoint.angle);

    context.fillStyle = colors.cap;
    context.beginPath();
    context.arc(-halfLength, 0, radius, 0, Math.PI * 2);
    context.arc(halfLength, 0, radius, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = colors.base;
    context.fillRect(-halfLength, -radius, length, width);

    context.fillStyle = colors.highlight;
    context.fillRect(-halfLength, -radius * 0.34, length, radius * 0.68);

    context.strokeStyle = colors.outline;
    context.lineWidth = Math.max(1.5, size * 0.08);
    context.beginPath();
    context.moveTo(-halfLength, -radius);
    context.lineTo(halfLength, -radius);
    context.arc(halfLength, 0, radius, -Math.PI / 2, Math.PI / 2);
    context.lineTo(-halfLength, radius);
    context.arc(-halfLength, 0, radius, Math.PI / 2, -Math.PI / 2);
    context.closePath();
    context.stroke();

    drawPortalDirectionArrow(size);
    context.restore();
  }

  function drawPortalDirectionArrow(size: number): void {
    const start = EDITABLE_PORTAL_WIDTH_CELLS * size * 0.65;
    const end = EDITABLE_PORTAL_WIDTH_CELLS * size * 1.35;
    const arrow = Math.max(5, size * 0.18);

    context.save();
    context.strokeStyle = "rgba(255,255,255,0.9)";
    context.fillStyle = "rgba(255,255,255,0.9)";
    context.lineWidth = Math.max(1.5, size * 0.07);
    context.beginPath();
    context.moveTo(0, start);
    context.lineTo(0, end);
    context.stroke();

    context.beginPath();
    context.moveTo(0, end + arrow);
    context.lineTo(-arrow * 0.7, end - arrow * 0.25);
    context.lineTo(arrow * 0.7, end - arrow * 0.25);
    context.closePath();
    context.fill();
    context.restore();
  }

  function hitTestPortals(grid: Vec2): PortalHitTarget | undefined {
    for (let pairIndex = document.portalLayer.length - 1; pairIndex >= 0; pairIndex -= 1) {
      const pair = document.portalLayer[pairIndex];
      if (!pair) {
        continue;
      }
      const bHit = hitTestPortalEndpoint(pair, "b", grid);
      if (bHit) {
        return bHit;
      }
      const aHit = hitTestPortalEndpoint(pair, "a", grid);
      if (aHit) {
        return aHit;
      }
    }
    return undefined;
  }

  function hitTestPortalEndpoint(
    pair: EditablePortalPair,
    endpointId: EditablePortalEndpointId,
    grid: Vec2
  ): PortalHitTarget | undefined {
    const endpoint = pair[endpointId];
    const local = portalLocalPoint(endpoint, grid);
    const halfLength = pair.lengthCells / 2;
    const radius = EDITABLE_PORTAL_WIDTH_CELLS / 2;
    const headDistance = Math.hypot(local.x + halfLength, local.y);
    const tailDistance = Math.hypot(local.x - halfLength, local.y);

    if (headDistance <= radius + 0.14) {
      return { pairId: pair.id, endpointId, part: "head" };
    }
    if (tailDistance <= radius + 0.14) {
      return { pairId: pair.id, endpointId, part: "tail" };
    }
    if (
      Math.abs(local.x) <= halfLength &&
      Math.abs(local.y) <= radius + 0.08
    ) {
      return { pairId: pair.id, endpointId, part: "body" };
    }
    return undefined;
  }

  function portalLocalPoint(
    endpoint: EditablePortalPair[EditablePortalEndpointId],
    grid: Vec2
  ): Vec2 {
    const delta = subGrid(grid, endpoint.center);
    const tangent = tangentFromAngle(endpoint.angle);
    const normal = normalFromAngle(endpoint.angle);
    return {
      x: dotGrid(delta, tangent),
      y: dotGrid(delta, normal)
    };
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
    syncButtonGroup(menuButtons, (button) => button.dataset.editorMenu === activeMenu);
    syncButtonGroup(toolButtons, (button) => button.dataset.editorTool === activeTool);
    syncButtonGroup(
      brushButtons,
      (button) => button.dataset.editorBrush === activeBrushMode
    );
    syncButtonGroup(
      specialPortalButtons,
      (button) =>
        document.portalLayer.some(
          (pair) => pair.id === (button.dataset.editorSpecialPortal as EditablePortalPairId)
        )
    );
    syncButtonGroup(
      groundMaterialButtons,
      (button) => button.dataset.editorGroundMaterial === activeGroundMaterial
    );
    syncButtonGroup(
      obstacleMaterialButtons,
      (button) => button.dataset.editorObstacleMaterial === activeObstacleMaterial
    );
    for (const panel of menuPanels) {
      panel.hidden = panel.getAttribute("data-editor-menu-panel") !== activeMenu;
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

  function findPortalPair(
    portalPairId: EditablePortalPairId
  ): EditablePortalPair | undefined {
    return document.portalLayer.find((pair) => pair.id === portalPairId);
  }

  function clearPortalDrag(): void {
    clearPortalLongPressTimer();
    portalDrag = undefined;
  }

  function clearPortalLongPressTimer(): void {
    if (portalDrag?.longPressTimer !== undefined) {
      window.clearTimeout(portalDrag.longPressTimer);
      delete portalDrag.longPressTimer;
    }
  }

  function cellPixels(): number {
    return baseCellPixels * camera.zoom;
  }

  function gridToScreen(point: Vec2): Vec2 {
    const size = cellPixels();
    return {
      x: camera.x + point.x * size,
      y: camera.y + point.y * size
    };
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

function isPortalEditMode(mode: PaintMode): boolean {
  return (
    mode === "portal_pending" ||
    mode === "portal_move" ||
    mode === "portal_resize" ||
    mode === "portal_rotate"
  );
}

function tangentFromAngle(angle: number): Vec2 {
  return {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
}

function normalFromAngle(angle: number): Vec2 {
  return {
    x: -Math.sin(angle),
    y: Math.cos(angle)
  };
}

function subGrid(a: Vec2, b: Vec2): Vec2 {
  return {
    x: a.x - b.x,
    y: a.y - b.y
  };
}

function dotGrid(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function gridDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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

function gridCellEdges(x: number, y: number, shape: MapCellShape): readonly GridEdge[] {
  const topLeft = { x, y };
  const topRight = { x: x + 1, y };
  const bottomRight = { x: x + 1, y: y + 1 };
  const bottomLeft = { x, y: y + 1 };

  if (shape === 1) {
    return edgesFromPoints([topLeft, topRight, bottomLeft]);
  }
  if (shape === 2) {
    return edgesFromPoints([topLeft, topRight, bottomRight]);
  }
  if (shape === 3) {
    return edgesFromPoints([topRight, bottomRight, bottomLeft]);
  }
  if (shape === 4) {
    return edgesFromPoints([topLeft, bottomRight, bottomLeft]);
  }
  return edgesFromPoints([topLeft, topRight, bottomRight, bottomLeft]);
}

function edgesFromPoints(points: readonly Vec2[]): readonly GridEdge[] {
  return points.map((point, index) => ({
    start: point,
    end: points[(index + 1) % points.length] ?? point
  }));
}

function normalizedGridEdgeKey(edge: GridEdge): string {
  const a = `${edge.start.x},${edge.start.y}`;
  const b = `${edge.end.x},${edge.end.y}`;
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function materialColorMap<TMaterial extends string>(
  colors: Record<TMaterial, string>
): Record<TMaterial, string> {
  const entries = Object.entries(colors).map(([material, color]) => [
    material,
    materialEdgeColor(color as string)
  ]);
  return Object.fromEntries(entries) as Record<TMaterial, string>;
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
