import {
  addEditableBallPlacement,
  applyEditableMapBrush,
  canPlaceEditableBall,
  createDefaultEditableMapDocument,
  decodeEditableMapDocument,
  encodeEditableMapDocument,
  editableMapToMapData,
  EDITABLE_BALL_RADIUS_TIER_IDS,
  EDITABLE_PORTAL_MIN_LENGTH_CELLS,
  EDITABLE_PORTAL_WIDTH_CELLS,
  EDITOR_MAP_MAX_HEIGHT_CELLS,
  EDITOR_MAP_MAX_WIDTH_CELLS,
  pixelBodyRadius,
  PIXEL_BODY_UNIT,
  resizeEditableMapDocument,
  removeEditableBallPlacement,
  setEditablePortalPair,
  toggleEditablePortalPair
} from "@disc-arena/core";
import type {
  EditableBallPlacement,
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
  PixelBodyRadiusTierId,
  Vec2
} from "@disc-arena/core";
import { materialEdgeColor } from "./colors";
import { uiText } from "./uiText";

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
  | "portal_move"
  | "portal_resize";
type EditorTool = EditableTool | "drag";
type EditorMenu = "tools" | "materials" | "resize" | "special" | "balls";
type BrushMode = "1" | "2" | "4" | "rect" | "circle-cell" | "circle-grid";
type RegionBrushMode = "rect" | "circle-cell" | "circle-grid";
type PortalHitPart = "body" | "head" | "tail" | "rotate";

interface PendingRegion {
  readonly kind: RegionBrushMode;
  readonly start: Vec2;
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

interface LayerRenderCache {
  readonly canvas: HTMLCanvasElement;
  revision: number;
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
}

const DRAFT_STORAGE_KEY = "disc-arena.editable-map.draft.v1";
const baseCellPixels = 24;
const minZoom = 0.12;
const maxZoom = 8;
const portalRotateButtonWidthCells = 1.15;
const portalRotateButtonHeightCells = 0.62;
const portalRotateButtonGapCells = 0.32;

const groundColors: Record<GroundMaterial, string> = {
  void: "#303238",
  grass: "#1b5f3e",
  ice: "#9eddf2",
  sand: "#d8bd72",
  cloud: "#effbff"
};

const obstacleColors: Record<ObstacleMaterial, string> = {
  wood: "#8f3f2f",
  elastic_wall: "#38b88b",
  sticky_wall: "#65516f",
  airbag: "#e3c65b"
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
  let layerRevision = 0;
  const layerCaches: Record<EditableLayer, LayerRenderCache> = {
    ground: createLayerRenderCache(),
    obstacle: createLayerRenderCache()
  };
  let activeMenu: EditorMenu | undefined;
  let activeLayer: EditableLayer = "ground";
  let activeTool: EditorTool = "add";
  let activeBrushMode: BrushMode = "1";
  let activeBallRadiusTierId: PixelBodyRadiusTierId = "18px";
  let activeGroundMaterial: GroundMaterial = "grass";
  let activeObstacleMaterial: ObstacleMaterial = "wood";
  let mode: PaintMode = "idle";
  let camera = { x: 80, y: 80, zoom: 1 };
  let lastPointer: Vec2 | undefined;
  let hoverCell: Vec2 | undefined;
  let hoverGrid: Vec2 | undefined;
  let pendingRegion: PendingRegion | undefined;
  let portalDrag: PortalDragState | undefined;
  const menuButtons = queryButtons(elements.panel, "[data-editor-menu]");
  const menuPanels = queryElements(elements.panel, "[data-editor-menu-panel]");
  const toolButtons = queryButtons(elements.panel, "[data-editor-tool]");
  const brushButtons = queryButtons(elements.panel, "[data-editor-brush]");
  const ballSizeButtons = queryButtons(elements.panel, "[data-editor-ball-size]");
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
  updateStatus(uiText.editor.status.ready);

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
  for (const button of ballSizeButtons) {
    button.addEventListener("click", () => {
      const radiusTierId = button.dataset.editorBallSize as PixelBodyRadiusTierId;
      if ((EDITABLE_BALL_RADIUS_TIER_IDS as readonly string[]).includes(radiusTierId)) {
        activeBallRadiusTierId = radiusTierId;
      }
      activeMenu = "balls";
      pendingRegion = undefined;
      syncControlsFromState();
      updateStatus(uiText.editor.status.ballSize(activeBallRadiusTierId));
    });
  }
  for (const button of specialPortalButtons) {
    button.addEventListener("click", () => {
      const portalPairId = button.dataset.editorSpecialPortal as EditablePortalPairId;
      setDocument(toggleEditablePortalPair(document, portalPairId), { layersChanged: false });
      pendingRegion = undefined;
      clearPortalDrag();
      syncControlsFromState();
      const exists = document.portalLayer.some((pair) => pair.id === portalPairId);
      updateStatus(uiText.editor.status.portalToggled(portalPairId, exists));
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
    setDocument(
      resizeEditableMapDocument(
        document,
        Number(elements.width.value),
        Number(elements.height.value)
      )
    );
    syncSizeControlsFromDocument();
    updateStatus(uiText.editor.status.resized(document.widthCells, document.heightCells));
  });
  elements.saveDraft.addEventListener("click", () => {
    saveDraft(document);
    updateStatus(uiText.editor.status.draftSaved);
  });
  elements.exportMap.addEventListener("click", () => {
    exportDocument(document);
    updateStatus(uiText.editor.status.exported);
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

    drawCachedLayer("ground");
    drawPortalLayer();
    drawCachedLayer("obstacle");
    drawGrid();
    drawBallLayer();
    drawBrushPreview();
    context.restore();
  }

  function handlePointerDown(event: PointerEvent, screenPoint: Vec2): void {
    if (event.button === 2 && pendingRegion) {
      pendingRegion = undefined;
      updateStatus(uiText.editor.status.shapeCancelled);
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
    hoverGrid = grid;

    if (activeMenu === "balls") {
      handleBallClick(grid);
      return;
    }

    const portalHit = hitTestPortals(grid);
    if (portalHit) {
      if (portalHit.part === "rotate") {
        promptPortalRotation(portalHit);
      } else {
        startPortalEdit(portalHit, grid);
      }
      return;
    }

    if (isRegionBrush(activeBrushMode)) {
      handleRegionClick(cell, grid, activeBrushMode);
      return;
    }

    mode = "paint";
    paintAt(cell);
  }

  function handlePointerMove(_event: PointerEvent, screenPoint: Vec2): void {
    hoverCell = screenToCell(screenPoint);
    const grid = screenToGrid(screenPoint);
    hoverGrid = grid;

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
      mode = "portal_move";
      updateStatus(uiText.editor.status.dragPortal);
      return;
    }

    mode = "portal_resize";
    updateStatus(uiText.editor.status.resizePortal);
  }

  function updatePortalEdit(grid: Vec2): void {
    if (!portalDrag) {
      return;
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

  function promptPortalRotation(target: PortalHitTarget): void {
    const pair = findPortalPair(target.pairId);
    if (!pair) {
      return;
    }
    const endpoint = pair[target.endpointId];
    const currentDegrees = radiansToDegrees(endpoint.angle);
    const rawAngle = window.prompt(
      uiText.editor.prompt.portalAngle,
      String(Math.round(currentDegrees))
    );
    if (rawAngle === null) {
      return;
    }
    const degrees = Number(rawAngle.trim());
    if (!Number.isFinite(degrees)) {
      updateStatus(uiText.editor.status.invalidPortalAngle);
      return;
    }

    updatePortalPair(target.pairId, (current) => ({
      ...current,
      [target.endpointId]: {
        ...current[target.endpointId],
        angle: degreesToRadians(degrees)
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
    setDocument(setEditablePortalPair(document, updater(pair)), { layersChanged: false });
    syncControlsFromState();
    updateStatus(uiText.editor.status.portalEdited(portalPairId));
  }

  function paintAt(cell: Vec2): void {
    if (!isCellInMap(cell)) {
      return;
    }

    setDocument(
      applyEditableMapBrush(document, {
        layer: activeLayer,
        tool: editableTool(activeTool),
        brushSize: numericBrushSize(activeBrushMode),
        cellX: cell.x,
        cellY: cell.y,
        groundMaterial: activeGroundMaterial,
        obstacleMaterial: activeObstacleMaterial
      })
    );
    updateStatus(uiText.editor.status.mapSize(document.name, document.widthCells, document.heightCells));
  }

  function handleRegionClick(
    cell: Vec2,
    grid: Vec2,
    brushMode: RegionBrushMode
  ): void {
    const point = regionPointForBrush(cell, grid, brushMode);
    if (!isRegionPointInMap(cell, point, brushMode)) {
      return;
    }

    if (!pendingRegion || pendingRegion.kind !== brushMode) {
      pendingRegion = { kind: brushMode, start: point };
      updateStatus(uiText.editor.status.selectSecondPoint);
      return;
    }

    paintCells(regionCells(pendingRegion.start, point, brushMode));
    pendingRegion = undefined;
    updateStatus(uiText.editor.status.mapSize(document.name, document.widthCells, document.heightCells));
  }

  function isRegionPointInMap(
    cell: Vec2,
    point: Vec2,
    brushMode: RegionBrushMode
  ): boolean {
    if (brushMode === "circle-grid") {
      return isGridIntersectionInMap(point);
    }
    return isCellInMap(cell);
  }

  function paintCells(cells: readonly Vec2[]): void {
    let nextDocument = document;
    for (const cell of cells) {
      nextDocument = applyEditableMapBrush(nextDocument, {
        layer: activeLayer,
        tool: editableTool(activeTool),
        brushSize: 1,
        cellX: cell.x,
        cellY: cell.y,
        groundMaterial: activeGroundMaterial,
        obstacleMaterial: activeObstacleMaterial
      });
    }
    setDocument(nextDocument);
  }

  function handleBallClick(grid: Vec2): void {
    const hitBall = hitTestBall(grid);
    if (hitBall) {
      setDocument(removeEditableBallPlacement(document, hitBall.id), {
        layersChanged: false
      });
      syncControlsFromState();
      updateStatus(uiText.editor.status.removedBall(hitBall.id));
      return;
    }

    if (!isGridPointInMap(grid)) {
      updateStatus(uiText.editor.status.ballOutside);
      return;
    }

    const next = addEditableBallPlacement(document, grid, activeBallRadiusTierId);
    if (!next) {
      updateStatus(uiText.editor.status.invalidBall);
      return;
    }

    setDocument(next, { layersChanged: false });
    syncControlsFromState();
    updateStatus(uiText.editor.status.addedBall(document.ballLayer.at(-1)?.number ?? ""));
  }

  function drawBallLayer(): void {
    for (const ball of document.ballLayer) {
      drawEditorBall(ball, { preview: false, valid: true });
    }
  }

  function drawBallPreview(): void {
    if (activeMenu !== "balls" || !hoverGrid || !isGridPointInMap(hoverGrid)) {
      return;
    }

    const hitBall = hitTestBall(hoverGrid);
    if (hitBall) {
      drawEditorBall(hitBall, { preview: true, valid: false });
      return;
    }

    drawEditorBall(
      {
        id: "preview-ball",
        center: hoverGrid,
        radiusTierId: activeBallRadiusTierId,
        number: nextEditablePreviewNumber(),
        outerColor: "#050505"
      },
      {
        preview: true,
        valid: canPlaceEditableBall(document, hoverGrid, activeBallRadiusTierId)
      }
    );
  }

  function drawEditorBall(
    ball: EditableBallPlacement,
    options: { readonly preview: boolean; readonly valid: boolean }
  ): void {
    const center = gridToScreen(ball.center);
    const radius = ballRadiusCells(ball.radiusTierId) * cellPixels();
    const innerRadius = Math.max(3, radius * 0.54);
    const outerColor = ball.outerColor ?? "#050505";

    context.save();
    context.globalAlpha = options.preview ? 0.58 : 1;
    context.fillStyle = outerColor;
    context.strokeStyle = options.valid ? "#020202" : "#e85454";
    context.lineWidth = Math.max(2, radius * 0.12);
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.fillStyle = "#f8f8f3";
    context.beginPath();
    context.arc(center.x, center.y, innerRadius, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#101010";
    context.font = `${Math.max(9, radius * 0.64)}px ui-monospace, monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(ball.number), center.x, center.y + radius * 0.04);

    if (options.preview && !options.valid) {
      context.strokeStyle = "#e85454";
      context.lineWidth = Math.max(2, radius * 0.16);
      context.beginPath();
      context.arc(center.x, center.y, radius + context.lineWidth, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  function hitTestBall(grid: Vec2): EditableBallPlacement | undefined {
    for (let index = document.ballLayer.length - 1; index >= 0; index -= 1) {
      const ball = document.ballLayer[index];
      if (!ball) {
        continue;
      }
      if (gridDistance(grid, ball.center) <= ballRadiusCells(ball.radiusTierId)) {
        return ball;
      }
    }
    return undefined;
  }

  function nextEditablePreviewNumber(): number {
    return document.ballLayer.reduce(
      (next, ball) => Math.max(next, ball.number + 1),
      0
    );
  }

  function ballRadiusCells(radiusTierId: PixelBodyRadiusTierId): number {
    return pixelBodyRadius(radiusTierId) / document.cellSize;
  }

  function drawCachedLayer(layer: EditableLayer): void {
    const cache = layerCaches[layer];
    if (cache.revision !== layerRevision) {
      rebuildLayerCache(layer, cache);
    }

    context.drawImage(
      cache.canvas,
      camera.x,
      camera.y,
      document.widthCells * cellPixels(),
      document.heightCells * cellPixels()
    );
  }

  function rebuildLayerCache(layer: EditableLayer, cache: LayerRenderCache): void {
    const canvasWidth = Math.max(1, document.widthCells * baseCellPixels);
    const canvasHeight = Math.max(1, document.heightCells * baseCellPixels);
    if (cache.canvas.width !== canvasWidth) {
      cache.canvas.width = canvasWidth;
    }
    if (cache.canvas.height !== canvasHeight) {
      cache.canvas.height = canvasHeight;
    }

    const target = requiredCanvasContext(cache.canvas);
    target.save();
    target.imageSmoothingEnabled = false;
    target.clearRect(0, 0, canvasWidth, canvasHeight);
    drawLayerToContext(target, layer, baseCellPixels);
    drawLayerInnerOutlineToContext(target, layer, baseCellPixels);
    target.restore();
    cache.revision = layerRevision;
  }

  function drawLayerToContext(
    target: CanvasRenderingContext2D,
    layer: EditableLayer,
    size: number
  ): void {
    for (let y = 0; y < document.heightCells; y += 1) {
      for (let x = 0; x < document.widthCells; x += 1) {
        const screen = { x: x * size, y: y * size };
        if (layer === "ground") {
          const cell = document.groundLayer[cellIndex(x, y)];
          if (cell) {
            fillCellShapeOnContext(
              target,
              screen.x,
              screen.y,
              size,
              cell.shape,
              groundColors[cell.material]
            );
          }
        } else {
          const cell = document.obstacleLayer[cellIndex(x, y)];
          if (cell) {
            fillCellShapeOnContext(
              target,
              screen.x,
              screen.y,
              size,
              cell.shape,
              obstacleColors[cell.material]
            );
          }
        }
      }
    }
  }

  function drawLayerInnerOutlineToContext(
    target: CanvasRenderingContext2D,
    layer: EditableLayer,
    size: number
  ): void {
    const edges = layerBoundaryEdges(layer);
    if (edges.length === 0) {
      return;
    }

    target.save();
    target.beginPath();
    addLayerClipPathToContext(target, layer, size);
    target.clip();
    target.lineWidth = Math.max(2, Math.round(size * 0.14));
    target.lineJoin = "miter";
    target.lineCap = "butt";

    for (const edge of edges) {
      target.strokeStyle = edge.color;
      target.beginPath();
      target.moveTo(edge.start.x * size, edge.start.y * size);
      target.lineTo(edge.end.x * size, edge.end.y * size);
      target.stroke();
    }
    target.restore();
  }

  function addLayerClipPathToContext(
    target: CanvasRenderingContext2D,
    layer: EditableLayer,
    size: number
  ): void {
    for (let y = 0; y < document.heightCells; y += 1) {
      for (let x = 0; x < document.widthCells; x += 1) {
        const cell = filledLayerCell(layer, x, y);
        if (!cell) {
          continue;
        }
        addCellShapePathOnContext(target, x * size, y * size, size, cell.shape);
        target.closePath();
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
    drawPortalRotateButton(size);
    context.restore();
  }

  function drawPortalRotateButton(size: number): void {
    const rect = portalRotateButtonRect();
    context.save();
    context.fillStyle = "rgba(12, 27, 20, 0.9)";
    context.strokeStyle = "rgba(255,255,255,0.9)";
    context.lineWidth = Math.max(1.2, size * 0.045);
    context.fillRect(
      rect.left * size,
      rect.top * size,
      rect.width * size,
      rect.height * size
    );
    context.strokeRect(
      rect.left * size,
      rect.top * size,
      rect.width * size,
      rect.height * size
    );
    context.fillStyle = "#fff";
    context.font = `${Math.max(9, size * 0.34)}px ui-monospace, monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      "R",
      (rect.left + rect.width / 2) * size,
      (rect.top + rect.height / 2) * size
    );
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
    const rotateRect = portalRotateButtonRect();

    if (
      local.x >= rotateRect.left &&
      local.x <= rotateRect.left + rotateRect.width &&
      local.y >= rotateRect.top &&
      local.y <= rotateRect.top + rotateRect.height
    ) {
      return { pairId: pair.id, endpointId, part: "rotate" };
    }

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

  function portalRotateButtonRect(): {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  } {
    const top =
      -EDITABLE_PORTAL_WIDTH_CELLS / 2 -
      portalRotateButtonGapCells -
      portalRotateButtonHeightCells;
    return {
      left: -portalRotateButtonWidthCells / 2,
      top,
      width: portalRotateButtonWidthCells,
      height: portalRotateButtonHeightCells
    };
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
    if (activeMenu === "balls") {
      drawBallPreview();
      return;
    }

    if (pendingRegion) {
      if (pendingRegion.kind === "rect") {
        if (hoverCell && isCellInMap(hoverCell)) {
          drawRectPreview(pendingRegion.start, hoverCell);
        }
      } else if (pendingRegion.kind === "circle-cell") {
        if (hoverCell && isCellInMap(hoverCell)) {
          drawCirclePreview(pendingRegion.start, cellCenterGridPoint(hoverCell));
        }
      } else {
        const end = snapGridIntersection(hoverGrid ?? pendingRegion.start);
        if (isGridIntersectionInMap(end)) {
          drawCirclePreview(pendingRegion.start, end);
        }
      }
      return;
    }

    if (!hoverCell || !isCellInMap(hoverCell)) {
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
    const center = gridToScreen(start);
    const edge = gridToScreen(end);
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
    fillCellShapeOnContext(context, x, y, size, shape, color);
  }

  function fillCellShapeOnContext(
    target: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    shape: MapCellShape,
    color: string
  ): void {
    target.beginPath();
    addCellShapePathOnContext(target, x, y, size, shape);
    target.closePath();
    target.fillStyle = color;
    target.fill();
  }

  function addCellShapePath(x: number, y: number, size: number, shape: MapCellShape): void {
    addCellShapePathOnContext(context, x, y, size, shape);
  }

  function addCellShapePathOnContext(
    target: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    shape: MapCellShape
  ): void {
    if (shape === 1) {
      target.moveTo(x, y);
      target.lineTo(x + size, y);
      target.lineTo(x, y + size);
      return;
    }
    if (shape === 2) {
      target.moveTo(x, y);
      target.lineTo(x + size, y);
      target.lineTo(x + size, y + size);
      return;
    }
    if (shape === 3) {
      target.moveTo(x + size, y);
      target.lineTo(x + size, y + size);
      target.lineTo(x, y + size);
      return;
    }
    if (shape === 4) {
      target.moveTo(x, y);
      target.lineTo(x + size, y + size);
      target.lineTo(x, y + size);
      return;
    }

    target.rect(x, y, size, size);
  }

  async function importSelectedFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }

    try {
      const imported = decodeEditableMapDocument(await file.text());
      setDocument(imported);
      syncSizeControlsFromDocument();
      updateStatus(uiText.editor.status.imported);
    } catch (error) {
      updateStatus(error instanceof Error ? error.message : uiText.editor.status.importFailed);
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
      ballSizeButtons,
      (button) => button.dataset.editorBallSize === activeBallRadiusTierId
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

  function setDocument(
    nextDocument: EditableMapDocument,
    options: { readonly layersChanged?: boolean } = {}
  ): void {
    document = nextDocument;
    if (options.layersChanged !== false) {
      layerRevision += 1;
    }
  }

  function findPortalPair(
    portalPairId: EditablePortalPairId
  ): EditablePortalPair | undefined {
    return document.portalLayer.find((pair) => pair.id === portalPairId);
  }

  function clearPortalDrag(): void {
    portalDrag = undefined;
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

  function isGridPointInMap(point: Vec2): boolean {
    return (
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < document.widthCells &&
      point.y < document.heightCells
    );
  }

  function isGridIntersectionInMap(point: Vec2): boolean {
    return (
      point.x >= 0 &&
      point.y >= 0 &&
      point.x <= document.widthCells &&
      point.y <= document.heightCells
    );
  }

  function cellIndex(x: number, y: number): number {
    return y * document.widthCells + x;
  }

  function regionCells(start: Vec2, end: Vec2, kind: RegionBrushMode): Vec2[] {
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
    const right = Math.ceil(start.x + radius) - 1;
    const bottom = Math.ceil(start.y + radius) - 1;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const cell = { x, y };
        const distanceToCenter = Math.hypot(x + 0.5 - start.x, y + 0.5 - start.y);
        if (isCellInMap(cell) && distanceToCenter <= radius + 0.0001) {
          cells.push(cell);
        }
      }
    }
    return cells;
  }
}

function isRegionBrush(brushMode: BrushMode): brushMode is RegionBrushMode {
  return (
    brushMode === "rect" ||
    brushMode === "circle-cell" ||
    brushMode === "circle-grid"
  );
}

function isPortalEditMode(mode: PaintMode): boolean {
  return (
    mode === "portal_move" ||
    mode === "portal_resize"
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

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function snapGridIntersection(point: Vec2): Vec2 {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y)
  };
}

function cellCenterGridPoint(cell: Vec2): Vec2 {
  return {
    x: cell.x + 0.5,
    y: cell.y + 0.5
  };
}

function regionPointForBrush(cell: Vec2, grid: Vec2, brushMode: RegionBrushMode): Vec2 {
  if (brushMode === "rect") {
    return cell;
  }
  if (brushMode === "circle-cell") {
    return cellCenterGridPoint(cell);
  }
  return snapGridIntersection(grid);
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

function createLayerRenderCache(): LayerRenderCache {
  return {
    canvas: document.createElement("canvas"),
    revision: -1
  };
}

function requiredCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable");
  }
  return context;
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
