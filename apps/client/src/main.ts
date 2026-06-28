import {
  add,
  allBodiesSleeping,
  applyShotIntentToState,
  billiardsMapData,
  buildBodyProxies,
  createBilliardsGameState,
  createOutOfBoundsTracker,
  distance,
  hashGameState,
  length,
  PHYSICS_POWER_SCALE,
  PIXEL_BODY_UNIT,
  portalEndpointA,
  portalEndpointB,
  scale,
  stepWorld,
  sub,
  transformVector,
  updateOutOfBoundsBodies
} from "@disc-arena/core";
import type {
  BodyState,
  BodyProxy,
  ClientToServerEvents,
  ClipMask,
  GroundMaterial,
  MapObstacleData,
  MapCellShape,
  MapData,
  Portal,
  RoomPlayer,
  RoomStatePayload,
  ServerToClientEvents,
  ShotIntent,
  ShotResolvedPayload,
  SimulationOptions,
  StaticWallCollider,
  Vec2
} from "@disc-arena/core";
import { io, type Socket } from "socket.io-client";
import { materialEdgeColor } from "./colors";
import { createMapEditor } from "./mapEditor";
import "./styles.css";

const canvas = requiredElement<HTMLCanvasElement>("#game");
const hud = requiredElement<HTMLDivElement>("#hud");
const resetButton = requiredElement<HTMLButtonElement>("#reset");
const playPanel = requiredElement<HTMLDivElement>("#play-panel");
const mainMenu = requiredElement<HTMLDivElement>("#main-menu");
const menuPlayButton = requiredElement<HTMLButtonElement>("#menu-play");
const menuEditorButton = requiredElement<HTMLButtonElement>("#menu-editor");
const playMenuButton = requiredElement<HTMLButtonElement>("#play-menu");
const editorMenuButton = requiredElement<HTMLButtonElement>("#editor-menu");
const editorPanel = requiredElement<HTMLDivElement>("#editor-panel");
const context = requiredCanvasContext(canvas);
const editor = createMapEditor(canvas, context, {
  panel: editorPanel,
  status: requiredElement<HTMLElement>("#editor-status"),
  width: requiredElement<HTMLInputElement>("#editor-width"),
  height: requiredElement<HTMLInputElement>("#editor-height"),
  resizeMap: requiredElement<HTMLButtonElement>("#editor-resize"),
  saveDraft: requiredElement<HTMLButtonElement>("#editor-save-draft"),
  exportMap: requiredElement<HTMLButtonElement>("#editor-export"),
  importMap: requiredElement<HTMLButtonElement>("#editor-import"),
  importFile: requiredElement<HTMLInputElement>("#editor-import-file")
});

const simulationOptions: SimulationOptions = {
  mode: "playback",
  fixedDt: 1 / 60,
  maxSteps: 1,
  collisionIterations: 3,
  recordFrames: false,
  frameIntervalSteps: 1,
  quantize: true
};

const maxDragDistance = 180 * PIXEL_BODY_UNIT;
const maxShotPower = 1500 * PHYSICS_POWER_SCALE;
const cancelAimColor = "rgba(255,255,255,0.32)";
const bodyNumberPixelSize = 3;
const bodyNumberDigitGap = 1;
const tableSurroundColor = "#23754c";
const tableSurfaceColor = "#1b5f3e";
const voidSurfaceColor = "#303238";
const playMinZoomFactor = 0.65;
const playMaxZoomFactor = 12;
const groundColors: Record<GroundMaterial, string> = {
  void: voidSurfaceColor,
  grass: tableSurfaceColor,
  ice: "#9eddf2",
  sand: "#d8bd72"
};
const pixelWallFill = "#8f3f2f";
const pixelTableBorderColor = materialEdgeColor(tableSurfaceColor);
const pixelWallOutline = materialEdgeColor(pixelWallFill);
const trailMinSpeed = 25 * PIXEL_BODY_UNIT;
const trailFullSpeed = 520 * PIXEL_BODY_UNIT;
const socketUrl = import.meta.env.VITE_SOCKET_URL ?? "http://127.0.0.1:3000";
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketUrl);
type AppMode = "menu" | "play" | "editor";
interface PixelCircleRun {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

interface PixelCircleTemplate {
  readonly pixelRadius: number;
  readonly runs: readonly PixelCircleRun[];
}

interface PixelBitmapSize {
  readonly width: number;
  readonly height: number;
}

interface BodyTrailSample {
  readonly position: Vec2;
  readonly speed: number;
}

interface PickedBodyProxy {
  readonly body: BodyState;
  readonly proxy: BodyProxy;
}

const digitGlyphs: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"]
};
const fallbackDigitGlyph = digitGlyphs["0"]!;

const pixelCircleTemplateCache = new Map<number, PixelCircleTemplate>();
const pixelDiskCanvasCache = new Map<string, HTMLCanvasElement>();
const bodyTrailHistory = new Map<string, BodyTrailSample[]>();
let appMode: AppMode = "menu";
let currentMapData: MapData = billiardsMapData;
let gameState = createBilliardsGameState();
let stateHash = hashGameState(gameState, true);
let localPlayerId: string | undefined;
let players: readonly RoomPlayer[] = [];
let selectedBodyId: string | undefined;
let selectedProxyId: string | undefined;
let pointerStart: Vec2 | undefined;
let pointerCurrent: Vec2 | undefined;
let playPanPointerId: number | undefined;
let playPanLastPoint: Vec2 | undefined;
let outOfBoundsTracker = createOutOfBoundsTracker();
let pendingResolvedShot: ShotResolvedPayload | undefined;
let localPredictionShotId: string | undefined;
let connectionState = "connecting";
let lastTime = performance.now();
let accumulator = 0;
let viewport = createViewport();

resetButton.addEventListener("click", () => {
  if (socket.connected) {
    socket.emit("room:reset");
  } else {
    const nextState = createBilliardsGameState();
    resetLocalState(nextState, hashGameState(nextState, true));
  }
});

menuPlayButton.addEventListener("click", () => setAppMode("play"));
menuEditorButton.addEventListener("click", () => setAppMode("editor"));
playMenuButton.addEventListener("click", () => setAppMode("menu"));
editorMenuButton.addEventListener("click", () => setAppMode("menu"));

socket.on("connect", () => {
  connectionState = "connected";
});

socket.on("disconnect", () => {
  connectionState = "disconnected";
});

socket.on("room:joined", (payload) => {
  localPlayerId = payload.playerId;
  applyRoomState(payload);
});

socket.on("room:state", (payload) => {
  applyRoomState(payload);
});

socket.on("shot:started", (payload) => {
  if (payload.shotId === localPredictionShotId) {
    return;
  }
  startPrediction(payload.shotId, payload.shotIntent);
});

socket.on("shot:resolved", (payload) => {
  pendingResolvedShot = payload;
  if (allBodiesSleeping(gameState.bodies)) {
    applyResolvedShot(payload);
  }
});

socket.on("shot:rejected", (payload) => {
  pendingResolvedShot = undefined;
  localPredictionShotId = undefined;
  resetLocalState(payload.gameState, payload.stateHash);
});

window.addEventListener("resize", resizeCanvas);
canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", clearPointer);
canvas.addEventListener("lostpointercapture", clearPointer);
canvas.addEventListener("wheel", handleWheel, { passive: false });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

resizeCanvas();
setAppMode("menu");
requestAnimationFrame(tick);

function tick(now: number): void {
  const frameDt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += frameDt;

  if (appMode === "play") {
    while (accumulator >= simulationOptions.fixedDt) {
      stepWorld(gameState, currentMapData, simulationOptions, 0);
      updateOutOfBoundsBodies(
        gameState.bodies,
        currentMapData,
        outOfBoundsTracker,
        simulationOptions.fixedDt,
        0
      );
      if (pendingResolvedShot && allBodiesSleeping(gameState.bodies)) {
        applyResolvedShot(pendingResolvedShot);
      }
      accumulator -= simulationOptions.fixedDt;
    }

    render(now);
  } else if (appMode === "menu") {
    accumulator = 0;
    renderMenu();
  } else {
    accumulator = 0;
    editor.render();
  }
  requestAnimationFrame(tick);
}

function handlePointerDown(event: PointerEvent): void {
  if (appMode === "menu") {
    return;
  }

  const screenPoint = pointerPosition(event);
  if (appMode === "editor") {
    editor.handlePointerDown(event, screenPoint);
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  if (event.button === 1 || event.button === 2) {
    startPlayPan(event, screenPoint);
    return;
  }

  if (event.button !== 0) {
    return;
  }

  if (!canShoot()) {
    return;
  }

  const worldPoint = screenToWorld(screenPoint);
  const picked = pickBodyProxy(worldPoint, bodyProxiesForRender(), gameState.bodies);
  if (!picked || !picked.body.alive) {
    return;
  }

  selectedBodyId = picked.body.id;
  selectedProxyId = picked.proxy.proxyId;
  pointerStart = worldPoint;
  pointerCurrent = worldPoint;
  canvas.setPointerCapture(event.pointerId);
}

function handlePointerMove(event: PointerEvent): void {
  if (appMode === "menu") {
    return;
  }

  const screenPoint = pointerPosition(event);
  if (appMode === "editor") {
    editor.handlePointerMove(event, screenPoint);
    return;
  }

  if (updatePlayPan(event, screenPoint)) {
    return;
  }

  if (!selectedBodyId || !pointerStart) {
    return;
  }
  pointerCurrent = screenToWorld(screenPoint);
}

function handlePointerUp(event: PointerEvent): void {
  if (appMode === "menu") {
    return;
  }

  if (appMode === "editor") {
    editor.handlePointerUp(event);
    releasePointer(event);
    return;
  }

  if (endPlayPan(event)) {
    releasePointer(event);
    return;
  }

  if (!selectedBodyId || !pointerStart || !pointerCurrent) {
    clearPointer();
    return;
  }

  const selectedBody = gameState.bodies.find((body) => body.id === selectedBodyId);
  const selectedProxy = selectedBody
    ? selectedProxyForBody(selectedBody.id, bodyProxiesForRender())
    : undefined;
  if (
    !selectedBody ||
    !selectedProxy ||
    isPointInShotDeadZone(selectedProxy.position, selectedProxy.radius, pointerCurrent)
  ) {
    releasePointer(event);
    clearPointer();
    return;
  }

  const drag = clampDrag(sub(pointerCurrent, pointerStart));
  const power = (length(drag) / maxDragDistance) * maxShotPower;
  if (power > 0) {
    const direction = transformVector(scale(drag, -1), selectedProxy.transformToBody);
    const shotId = createShotId();
    const shotIntent: ShotIntent = {
      actorBodyId: selectedBodyId,
      angle: Math.atan2(direction.y, direction.x),
      power,
      spinOffset: 0
    };
    const knownStateHash = stateHash;
    const turnIndex = gameState.turnIndex;
    startPrediction(shotId, shotIntent);
    socket.emit("shot:submit", {
      shotId,
      turnIndex,
      knownStateHash,
      shotIntent
    });
  }

  releasePointer(event);
  clearPointer();
}

function releasePointer(event: PointerEvent): void {
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function clearPointer(): void {
  if (appMode === "editor") {
    editor.handlePointerCancel();
  }
  clearPlayPan();
  selectedBodyId = undefined;
  selectedProxyId = undefined;
  pointerStart = undefined;
  pointerCurrent = undefined;
}

function handleWheel(event: WheelEvent): void {
  if (appMode === "editor") {
    editor.handleWheel(event, pointerPosition(event));
    return;
  }

  if (appMode !== "play") {
    return;
  }

  event.preventDefault();
  zoomPlayViewport(pointerPosition(event), event.deltaY < 0 ? 1.1 : 0.9);
}

function startPlayPan(event: PointerEvent, screenPoint: Vec2): void {
  selectedBodyId = undefined;
  selectedProxyId = undefined;
  pointerStart = undefined;
  pointerCurrent = undefined;
  playPanPointerId = event.pointerId;
  playPanLastPoint = screenPoint;
  canvas.setPointerCapture(event.pointerId);
}

function updatePlayPan(event: PointerEvent, screenPoint: Vec2): boolean {
  if (playPanPointerId !== event.pointerId || !playPanLastPoint) {
    return false;
  }

  viewport = {
    ...viewport,
    x: viewport.x + screenPoint.x - playPanLastPoint.x,
    y: viewport.y + screenPoint.y - playPanLastPoint.y
  };
  playPanLastPoint = screenPoint;
  return true;
}

function endPlayPan(event: PointerEvent): boolean {
  if (playPanPointerId !== event.pointerId) {
    return false;
  }
  clearPlayPan();
  return true;
}

function clearPlayPan(): void {
  playPanPointerId = undefined;
  playPanLastPoint = undefined;
}

function zoomPlayViewport(screenPoint: Vec2, zoomFactor: number): void {
  const before = screenToWorld(screenPoint);
  const fitScale = viewportFitScale();
  const nextScale = clampNumber(
    viewport.scale * zoomFactor,
    fitScale * playMinZoomFactor,
    fitScale * playMaxZoomFactor
  );
  viewport = {
    x: screenPoint.x - before.x * nextScale,
    y: screenPoint.y - before.y * nextScale,
    scale: nextScale
  };
}

function setAppMode(nextMode: AppMode): void {
  appMode = nextMode;
  selectedBodyId = undefined;
  selectedProxyId = undefined;
  pointerStart = undefined;
  pointerCurrent = undefined;
  clearPlayPan();
  editor.handlePointerCancel();
  mainMenu.hidden = nextMode !== "menu";
  editorPanel.hidden = nextMode !== "editor";
  playPanel.hidden = nextMode !== "play";
  bodyTrailHistory.clear();
}

function renderMenu(): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawTable();
  drawPortals();
  drawWalls();
  drawBodies(bodyProxiesForRender());
}

function render(now: number): void {
  const proxies = bodyProxiesForRender();
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawTable();
  drawPortals();
  drawWalls();
  drawAim(now, proxies);
  drawBodies(proxies);
  recordBodyTrailSamples(proxies);
  updateHud();
}

function drawTable(): void {
  context.save();
  context.fillStyle = voidSurfaceColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (currentMapData.terrain) {
    drawTerrain(currentMapData);
  } else {
    context.fillStyle = tableSurfaceColor;
    context.fillRect(
      viewport.x,
      viewport.y,
      mapWidth() * viewport.scale,
      mapHeight() * viewport.scale
    );
  }

  const border = Math.max(4, Math.round(8 * viewport.scale));
  context.fillStyle = pixelTableBorderColor;
  context.fillRect(
    viewport.x,
    viewport.y,
    mapWidth() * viewport.scale,
    border
  );
  context.fillRect(
    viewport.x,
    viewport.y + mapHeight() * viewport.scale - border,
    mapWidth() * viewport.scale,
    border
  );
  context.fillRect(
    viewport.x,
    viewport.y,
    border,
    mapHeight() * viewport.scale
  );
  context.fillRect(
    viewport.x + mapWidth() * viewport.scale - border,
    viewport.y,
    border,
    mapHeight() * viewport.scale
  );

  drawHoleTriggers();
  context.restore();
}

function drawTerrain(mapData: MapData): void {
  const terrain = mapData.terrain;
  if (!terrain) {
    return;
  }

  for (let y = 0; y < terrain.heightCells; y += 1) {
    for (let x = 0; x < terrain.widthCells; x += 1) {
      const cell = terrain.cells[y * terrain.widthCells + x];
      if (!cell || cell.material === "void") {
        continue;
      }
      const screen = worldToScreen({
        x: terrain.origin.x + x * terrain.cellSize,
        y: terrain.origin.y + y * terrain.cellSize
      });
      fillMapCellShape(
        screen.x,
        screen.y,
        terrain.cellSize * viewport.scale,
        cell.shape,
        groundColors[cell.material]
      );
    }
  }
}

function drawHoleTriggers(): void {
  context.save();
  for (const trigger of currentMapData.triggers) {
    if (trigger.type !== "hole") {
      continue;
    }
    const center = worldToScreen(trigger.position);
    drawPixelDisk(
      center.x,
      center.y,
      Math.max(8, Math.round(trigger.radius / PIXEL_BODY_UNIT)),
      bodyPixelUnitSize(),
      "#17191d"
    );
  }
  context.restore();
}

function fillMapCellShape(
  x: number,
  y: number,
  size: number,
  shape: MapCellShape,
  color: string
): void {
  context.save();
  context.beginPath();
  addMapCellShapePath(x, y, size, shape);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  context.restore();
}

function addMapCellShapePath(
  x: number,
  y: number,
  size: number,
  shape: MapCellShape
): void {
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

function drawWalls(): void {
  context.save();

  if (currentMapData.obstacles) {
    drawObstacleLayer(currentMapData.obstacles);
    drawObstacleBoundaryLines();
    context.restore();
    return;
  }

  for (const collider of currentMapData.colliders) {
    if (collider.type !== "static_wall") {
      continue;
    }
    drawPixelWallSegment(collider);
  }
  context.restore();
}

function drawObstacleLayer(obstacles: MapObstacleData): void {
  for (let y = 0; y < obstacles.heightCells; y += 1) {
    for (let x = 0; x < obstacles.widthCells; x += 1) {
      const cell = obstacles.cells[y * obstacles.widthCells + x];
      if (!cell || cell.material !== "wood") {
        continue;
      }
      const screen = worldToScreen({
        x: obstacles.origin.x + x * obstacles.cellSize,
        y: obstacles.origin.y + y * obstacles.cellSize
      });
      fillMapCellShape(
        screen.x,
        screen.y,
        obstacles.cellSize * viewport.scale,
        cell.shape,
        pixelWallFill
      );
    }
  }
}

function drawObstacleBoundaryLines(): void {
  const outline = Math.max(2, Math.round(4 * viewport.scale));

  context.save();
  clipToObstacleLayer();
  context.strokeStyle = pixelWallOutline;
  context.lineWidth = outline * 2;
  context.lineCap = "square";

  for (const collider of currentMapData.colliders) {
    if (collider.type !== "static_wall") {
      continue;
    }
    const start = worldToScreen(collider.start);
    const end = worldToScreen(collider.end);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }
  context.restore();
}

function clipToObstacleLayer(): void {
  const obstacles = currentMapData.obstacles;
  if (!obstacles) {
    return;
  }

  context.beginPath();
  for (let y = 0; y < obstacles.heightCells; y += 1) {
    for (let x = 0; x < obstacles.widthCells; x += 1) {
      const cell = obstacles.cells[y * obstacles.widthCells + x];
      if (!cell || cell.material !== "wood") {
        continue;
      }
      const screen = worldToScreen({
        x: obstacles.origin.x + x * obstacles.cellSize,
        y: obstacles.origin.y + y * obstacles.cellSize
      });
      addMapCellShapePath(
        screen.x,
        screen.y,
        obstacles.cellSize * viewport.scale,
        cell.shape
      );
      context.closePath();
    }
  }
  context.clip();
}

function drawPixelWallSegment(collider: StaticWallCollider): void {
  const start = worldToScreen(collider.start);
  const end = worldToScreen(collider.end);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthPx = Math.hypot(dx, dy);
  if (lengthPx <= 0) {
    return;
  }

  const thickness = Math.max(10, Math.round(wallThicknessWorld() * viewport.scale));
  const outline = Math.max(3, Math.round(thickness * 0.22));
  const offset = collider.solidSideNormal
    ? {
        x: collider.solidSideNormal.x * viewport.scale,
        y: collider.solidSideNormal.y * viewport.scale
      }
    : undefined;
  const localSolidSide = offset
    ? Math.sign(offset.x * -dy + offset.y * dx) || 1
    : 0;
  const top = localSolidSide === 0 ? -thickness / 2 : localSolidSide < 0 ? -thickness : 0;

  context.save();
  context.translate(start.x, start.y);
  context.rotate(Math.atan2(dy, dx));
  context.fillStyle = pixelWallFill;
  context.fillRect(0, top, lengthPx, thickness);

  context.save();
  context.beginPath();
  context.rect(0, top, lengthPx, thickness);
  context.clip();
  context.strokeStyle = pixelWallOutline;
  context.lineWidth = outline;
  context.strokeRect(
    outline / 2,
    top + outline / 2,
    lengthPx - outline,
    thickness - outline
  );
  context.restore();
  context.restore();
}

function drawPixelDisk(
  x: number,
  y: number,
  pixelRadius: number,
  unitSize: number,
  color: string
): void {
  const template = pixelCircleTemplate(pixelRadius);
  const source = pixelDiskCanvas(template, color);
  const unit = Math.max(0.05, unitSize);
  const diameter = template.pixelRadius * 2 + 1;
  const drawSize = diameter * unit;
  const left = x - drawSize / 2;
  const top = y - drawSize / 2;

  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(source, left, top, drawSize, drawSize);
  context.restore();
}

function pixelDiskCanvas(
  template: PixelCircleTemplate,
  color: string
): HTMLCanvasElement {
  const cacheKey = `${template.pixelRadius}:${color}`;
  const cached = pixelDiskCanvasCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const diameter = template.pixelRadius * 2 + 1;
  const source = document.createElement("canvas");
  source.width = diameter;
  source.height = diameter;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  sourceContext.imageSmoothingEnabled = false;
  sourceContext.fillStyle = color;
  for (const run of template.runs) {
    sourceContext.fillRect(
      run.x + template.pixelRadius,
      run.y + template.pixelRadius,
      run.width,
      1
    );
  }

  pixelDiskCanvasCache.set(cacheKey, source);
  return source;
}

function drawPortals(): void {
  const colors = ["#72d9ff", "#ff78c8"];

  context.save();
  context.lineCap = "round";
  let index = 0;
  for (const pair of currentMapData.portals) {
    const color = colors[index % colors.length] ?? "#fff";
    drawPortal(pair.a, color);
    drawPortal(pair.b, color);
    index += 1;
  }
  context.restore();
}

function drawPortal(portal: Portal, color: string): void {
  const start = worldToScreen(portalEndpointA(portal));
  const end = worldToScreen(portalEndpointB(portal));

  context.strokeStyle = "rgba(0,0,0,0.42)";
  context.lineWidth = Math.max(8, 18 * PIXEL_BODY_UNIT * viewport.scale);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();

  context.strokeStyle = color;
  context.lineWidth = Math.max(4, 8 * PIXEL_BODY_UNIT * viewport.scale);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
}

function drawAim(now: number, proxies: readonly BodyProxy[]): void {
  const body = selectedBodyId
    ? gameState.bodies.find((candidate) => candidate.id === selectedBodyId)
    : undefined;
  const proxy = body ? selectedProxyForBody(body.id, proxies) : undefined;
  if (!body || !proxy || !pointerStart || !pointerCurrent) {
    return;
  }

  const drag = clampDrag(sub(pointerCurrent, pointerStart));
  const aimStrength = Math.min(1, length(drag) / maxDragDistance);
  const dragEnd = add(pointerStart, drag);
  const launchEnd = add(proxy.position, scale(drag, -1));
  const start = worldToScreen(proxy.position);
  const pull = worldToScreen(dragEnd);
  const launch = worldToScreen(launchEnd);
  const inDeadZone = isPointInShotDeadZone(proxy.position, proxy.radius, pointerCurrent);
  const bodyPixelRadius = pixelRadiusForWorldRadius(proxy.radius);
  const pixelUnit = bodyPixelUnitSize();

  context.save();
  context.lineCap = "round";
  context.lineWidth = 3;
  context.strokeStyle = inDeadZone ? cancelAimColor : "#fff";
  drawPixelDisk(
    start.x,
    start.y,
    bodyPixelRadius,
    pixelUnit,
    inDeadZone ? cancelAimColor : "#fff"
  );

  context.strokeStyle = "#fff";
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(pull.x, pull.y);
  context.stroke();

  context.fillStyle = "#fff";
  const pullMarker = Math.max(5, Math.round(6 * viewport.scale));
  context.fillRect(
    pull.x - pullMarker / 2,
    pull.y - pullMarker / 2,
    pullMarker,
    pullMarker
  );

  drawLaunchPreviewLine(start, launch, inDeadZone, aimStrength, now);
  context.restore();
}

function drawLaunchPreviewLine(
  start: Vec2,
  end: Vec2,
  inDeadZone: boolean,
  aimStrength: number,
  animationTimeMs: number
): void {
  const previewLength = distance(start, end);
  if (previewLength <= 1) {
    return;
  }

  const dashPattern = [10, 8];
  const dashCycleLength = dashPattern.reduce((sum, value) => sum + value, 0);
  const dashSpeed = 80 * aimStrength;
  const startAlpha = inDeadZone ? 0.28 : 0.88;
  const endAlpha = inDeadZone ? 0.02 : 0.05;
  const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
  gradient.addColorStop(0, `rgba(255,255,255,${startAlpha})`);
  gradient.addColorStop(0.55, `rgba(255,255,255,${startAlpha * 0.45})`);
  gradient.addColorStop(1, `rgba(255,255,255,${endAlpha})`);

  context.strokeStyle = gradient;
  context.setLineDash(dashPattern);
  context.lineDashOffset =
    -((animationTimeMs / 1000) * dashSpeed) % dashCycleLength;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
}

function drawBodies(proxies: readonly BodyProxy[]): void {
  for (const proxy of proxies) {
    const body = gameState.bodies.find((candidate) => candidate.id === proxy.bodyId);
    if (body) {
      drawBodyTrail(body, proxy);
    }
  }
  for (const proxy of proxies) {
    const body = gameState.bodies.find((candidate) => candidate.id === proxy.bodyId);
    if (body) {
      drawBodyProxy(body, proxy);
    }
  }
}

function bodyProxiesForRender(): BodyProxy[] {
  return buildBodyProxies(gameState.bodies, currentMapData).sort(
    (a, b) => a.radius - b.radius
  );
}

function recordBodyTrailSamples(proxies: readonly BodyProxy[]): void {
  const activeProxyIds = new Set<string>();

  for (const proxy of proxies) {
    activeProxyIds.add(proxy.proxyId);
    const speed = length(proxy.velocity);
    if (speed <= trailMinSpeed) {
      bodyTrailHistory.delete(proxy.proxyId);
      continue;
    }

    const samples = bodyTrailHistory.get(proxy.proxyId) ?? [];
    const lastSample = samples.at(-1);
    if (!lastSample || distance(lastSample.position, proxy.position) >= proxy.radius * 0.08) {
      samples.push({
        position: { ...proxy.position },
        speed
      });
    }

    const maxSamples = 10;
    if (samples.length > maxSamples) {
      samples.splice(0, samples.length - maxSamples);
    }
    bodyTrailHistory.set(proxy.proxyId, samples);
  }

  for (const proxyId of bodyTrailHistory.keys()) {
    if (!activeProxyIds.has(proxyId)) {
      bodyTrailHistory.delete(proxyId);
    }
  }
}

function drawBodyTrail(body: BodyState, proxy: BodyProxy): void {
  const speed = length(proxy.velocity);
  if (speed <= trailMinSpeed) {
    return;
  }

  const samples = bodyTrailHistory.get(proxy.proxyId);
  if (!samples || samples.length < 2) {
    return;
  }

  const bodyPixelRadius = pixelRadiusForWorldRadius(proxy.radius);
  const pixelUnit = bodyPixelUnitSize();
  const currentStrength = trailStrength(speed);
  const trailCount = Math.max(2, Math.round(2 + currentStrength * 6));
  const visibleSamples = samples.slice(-trailCount);
  const outerColor = bodyOuterColor(body);

  context.save();
  applyClipMask(proxy.clipMask);
  for (let index = 0; index < visibleSamples.length; index += 1) {
    const sample = visibleSamples[index];
    if (!sample) {
      continue;
    }
    const proximity = (index + 1) / visibleSamples.length;
    const sampleStrength = trailStrength(sample.speed);
    const trailPosition = worldToScreen(sample.position);
    const outerAlpha = quantizedAlpha(
      Math.pow(proximity, 1.15) * (0.1 + Math.max(currentStrength, sampleStrength) * 0.38)
    );
    const shrink = Math.min(3, Math.floor((visibleSamples.length - index - 1) / 2));

    drawPixelDisk(
      trailPosition.x,
      trailPosition.y,
      Math.max(1, bodyPixelRadius - 1 - shrink),
      pixelUnit,
      colorWithAlpha(outerColor, outerAlpha)
    );
  }
  context.restore();
}

function drawBodyProxy(body: BodyState, proxy: BodyProxy): void {
  const center = worldToScreen(proxy.position);
  const number = bodyNumber(body);
  const numberText = String(number);
  const bodyPixelRadius = pixelRadiusForWorldRadius(proxy.radius);
  const pixelUnit = bodyPixelUnitSize();
  const outerColorPixelRadius = Math.max(1, bodyPixelRadius - 1);
  const innerPixelRadius = innerCirclePixelRadius(
    numberText,
    pixelUnit,
    outerColorPixelRadius
  );
  const selected = body.id === selectedBodyId;

  context.save();
  applyClipMask(proxy.clipMask);

  drawPixelDisk(center.x, center.y, bodyPixelRadius, pixelUnit, selected ? "#fff" : "#020202");
  drawPixelDisk(center.x, center.y, outerColorPixelRadius, pixelUnit, bodyOuterColor(body));
  drawPixelDisk(center.x, center.y, innerPixelRadius, pixelUnit, "#f8f8f3");

  drawPixelNumber(numberText, center.x, center.y, "#101010");
  context.restore();
}

function applyClipMask(clipMask?: ClipMask): void {
  if (!clipMask?.halfPlanes?.length) {
    return;
  }

  const far = Math.max(mapWidth(), mapHeight()) * 4;
  for (const halfPlane of clipMask.halfPlanes) {
    const tangent = { x: -halfPlane.normal.y, y: halfPlane.normal.x };
    const worldPoints = [
      add(halfPlane.point, scale(tangent, far)),
      add(add(halfPlane.point, scale(tangent, far)), scale(halfPlane.normal, far)),
      add(add(halfPlane.point, scale(tangent, -far)), scale(halfPlane.normal, far)),
      add(halfPlane.point, scale(tangent, -far))
    ];
    const points = worldPoints.map(worldToScreen);
    const firstPoint = points[0];
    if (!firstPoint) {
      continue;
    }
    context.beginPath();
    context.moveTo(firstPoint.x, firstPoint.y);
    for (const point of points.slice(1)) {
      context.lineTo(point.x, point.y);
    }
    context.closePath();
    context.clip();
  }
}

function isPointInShotDeadZone(center: Vec2, radius: number, point: Vec2): boolean {
  return distance(point, center) <= radius;
}

function bodyPixelUnitSize(): number {
  return PIXEL_BODY_UNIT * viewport.scale;
}

function pixelRadiusForWorldRadius(radius: number): number {
  return Math.max(1, Math.round(radius / PIXEL_BODY_UNIT - 0.5));
}

function pixelCircleTemplate(pixelRadius: number): PixelCircleTemplate {
  const normalizedRadius = Math.max(1, Math.round(pixelRadius));
  const cached = pixelCircleTemplateCache.get(normalizedRadius);
  if (cached) {
    return cached;
  }

  const rowExtents = midpointCircleRowExtents(normalizedRadius);
  const runs = [...rowExtents.entries()]
    .sort(([rowA], [rowB]) => rowA - rowB)
    .map(([y, extent]) => ({
      x: extent.minX,
      y,
      width: extent.maxX - extent.minX + 1
    }));

  const template = { pixelRadius: normalizedRadius, runs };
  pixelCircleTemplateCache.set(normalizedRadius, template);
  return template;
}

function midpointCircleRowExtents(
  pixelRadius: number
): Map<number, { minX: number; maxX: number }> {
  const extents = new Map<number, { minX: number; maxX: number }>();
  let x = pixelRadius;
  let y = 0;
  let decision = 1 - pixelRadius;

  while (x >= y) {
    addSymmetricCircleExtents(extents, x, y);
    y += 1;
    if (decision < 0) {
      decision += 2 * y + 1;
    } else {
      x -= 1;
      decision += 2 * (y - x) + 1;
    }
  }

  return extents;
}

function addSymmetricCircleExtents(
  extents: Map<number, { minX: number; maxX: number }>,
  x: number,
  y: number
): void {
  addHorizontalExtent(extents, y, -x, x);
  addHorizontalExtent(extents, -y, -x, x);
  addHorizontalExtent(extents, x, -y, y);
  addHorizontalExtent(extents, -x, -y, y);
}

function addHorizontalExtent(
  extents: Map<number, { minX: number; maxX: number }>,
  y: number,
  minX: number,
  maxX: number
): void {
  const existing = extents.get(y);
  if (!existing) {
    extents.set(y, { minX, maxX });
    return;
  }
  existing.minX = Math.min(existing.minX, minX);
  existing.maxX = Math.max(existing.maxX, maxX);
}

function innerCirclePixelRadius(
  numberText: string,
  pixelUnit: number,
  outerPixelRadius: number
): number {
  const labelSize = pixelNumberSize(numberText.length >= 2 ? numberText : "88");
  const requiredRadius = Math.ceil(
    Math.max(labelSize.width * 0.5 + pixelUnit, labelSize.height * 0.5 + pixelUnit) /
      pixelUnit
  );
  const maxInnerRadius = Math.max(3, outerPixelRadius - 3);
  return Math.max(3, Math.min(maxInnerRadius, requiredRadius));
}

function drawPixelNumber(
  text: string,
  centerX: number,
  centerY: number,
  color: string
): void {
  const blockSize = bodyNumberBlockSize();
  const size = pixelNumberSize(text, blockSize);
  const left = Math.round(centerX - size.width / 2);
  const top = Math.round(centerY - size.height / 2);
  let cursorX = left;

  context.save();
  context.fillStyle = color;
  for (const character of text) {
    const glyph = digitGlyph(character);
    drawPixelGlyph(glyph, cursorX, top, blockSize);
    cursorX += (glyph[0]?.length ?? 0) * blockSize;
    cursorX += bodyNumberDigitGap * blockSize;
  }
  context.restore();
}

function drawPixelGlyph(
  glyph: readonly string[],
  left: number,
  top: number,
  blockSize: number
): void {
  for (let y = 0; y < glyph.length; y += 1) {
    const row = glyph[y] ?? "";
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === "1") {
        context.fillRect(
          left + x * blockSize,
          top + y * blockSize,
          blockSize,
          blockSize
        );
      }
    }
  }
}

function pixelNumberSize(
  text: string,
  blockSize = bodyNumberBlockSize()
): PixelBitmapSize {
  const glyphs = [...text].map(digitGlyph);
  const widthUnits = glyphs.reduce((sum, glyph, index) => {
    const glyphWidth = glyph[0]?.length ?? 0;
    return sum + glyphWidth + (index > 0 ? bodyNumberDigitGap : 0);
  }, 0);
  const heightUnits = Math.max(...glyphs.map((glyph) => glyph.length), 0);

  return {
    width: widthUnits * blockSize,
    height: heightUnits * blockSize
  };
}

function digitGlyph(character: string): readonly string[] {
  return digitGlyphs[character] ?? fallbackDigitGlyph;
}

function bodyNumberBlockSize(): number {
  return Math.max(0.5, bodyNumberPixelSize * bodyPixelUnitSize());
}

function selectedProxyForBody(
  bodyId: string,
  proxies: readonly BodyProxy[]
): BodyProxy | undefined {
  const selectedProxy =
    selectedProxyId !== undefined
      ? proxies.find((proxy) => proxy.proxyId === selectedProxyId && proxy.bodyId === bodyId)
      : undefined;
  return (
    selectedProxy ??
    proxies.find((proxy) => proxy.bodyId === bodyId && proxy.kind === "primary") ??
    proxies.find((proxy) => proxy.bodyId === bodyId)
  );
}

function pickBodyProxy(
  point: Vec2,
  proxies: readonly BodyProxy[],
  bodies: readonly BodyState[]
): PickedBodyProxy | undefined {
  return proxies
    .map((proxy) => ({
      proxy,
      body: bodies.find((candidate) => candidate.id === proxy.bodyId)
    }))
    .filter(
      (candidate): candidate is PickedBodyProxy =>
        candidate.body !== undefined &&
        candidate.body.alive &&
        candidate.body.sleep &&
        distance(point, candidate.proxy.position) <= candidate.proxy.radius &&
        pointPassesClipMask(point, candidate.proxy.clipMask)
    )
    .sort(
      (a, b) =>
        distance(point, a.proxy.position) - distance(point, b.proxy.position)
    )[0];
}

function pointPassesClipMask(point: Vec2, clipMask?: ClipMask): boolean {
  if (!clipMask?.halfPlanes?.length) {
    return true;
  }

  return clipMask.halfPlanes.every((halfPlane) => {
    const dx = point.x - halfPlane.point.x;
    const dy = point.y - halfPlane.point.y;
    return dx * halfPlane.normal.x + dy * halfPlane.normal.y >= -0.000001;
  });
}

function trailStrength(speed: number): number {
  return Math.min(1, Math.max(0, (speed - trailMinSpeed) / (trailFullSpeed - trailMinSpeed)));
}

function bodyOuterColor(body: BodyState): string {
  const colorTag = body.tags.find((tag) => tag.startsWith("outerColor:"));
  return colorTag ? colorTag.slice("outerColor:".length) : "#050505";
}

function colorWithAlpha(color: string, alpha: number): string {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) {
    return color;
  }
  const red = Number.parseInt(match[1] ?? "0", 16);
  const green = Number.parseInt(match[2] ?? "0", 16);
  const blue = Number.parseInt(match[3] ?? "0", 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

function quantizedAlpha(alpha: number): number {
  return Number(Math.max(0, Math.min(0.9, Math.round(alpha * 20) / 20)).toFixed(2));
}

function resetLocalState(nextState: typeof gameState, nextStateHash: string): void {
  gameState = nextState;
  stateHash = nextStateHash;
  outOfBoundsTracker = createOutOfBoundsTracker();
  selectedBodyId = undefined;
  selectedProxyId = undefined;
  pointerStart = undefined;
  pointerCurrent = undefined;
  bodyTrailHistory.clear();
}

function canShoot(): boolean {
  return (
    socket.connected &&
    localPlayerId !== undefined &&
    gameState.currentPlayerId === localPlayerId &&
    gameState.phase === "waiting_for_shot" &&
    allBodiesSleeping(gameState.bodies)
  );
}

function updateHud(): void {
  const aliveCount = gameState.bodies.filter((body) => body.alive).length;
  const activePlayer = playerLabel(gameState.currentPlayerId);
  const me = localPlayerId ? playerLabel(localPlayerId) : "?";
  const stateText =
    gameState.phase === "waiting_for_shot"
      ? canShoot()
        ? "Your turn"
        : "Waiting"
      : allBodiesSleeping(gameState.bodies)
        ? "Settled"
        : "Rolling";

  hud.textContent = `${connectionState} | You ${me} | Active ${activePlayer} | Turn ${gameState.turnIndex + 1} | ${stateText} | Balls ${aliveCount}`;
}

function applyRoomState(payload: RoomStatePayload): void {
  players = payload.players;
  currentMapData = payload.mapData;
  viewport = createViewport();
  pendingResolvedShot = undefined;
  localPredictionShotId = undefined;
  resetLocalState(payload.gameState, payload.stateHash);
}

function startPrediction(shotId: string, shotIntent: ShotIntent): void {
  localPredictionShotId = shotId;
  pendingResolvedShot = undefined;
  applyShotIntentToState(gameState, shotIntent, 0);
  gameState.phase = "simulating";
  outOfBoundsTracker = createOutOfBoundsTracker();
}

function applyResolvedShot(payload: ShotResolvedPayload): void {
  resetLocalState(payload.finalState, payload.resultHash);
  pendingResolvedShot = undefined;
  localPredictionShotId = undefined;
}

function createShotId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function playerLabel(playerId: string): string {
  const player = players.find((candidate) => candidate.playerId === playerId);
  return player ? `P${player.joinIndex}` : "-";
}

function bodyNumber(body: BodyState): number {
  const tag = body.tags.find((candidate) => candidate.startsWith("number:"));
  return tag ? Number(tag.slice("number:".length)) : 0;
}

function clampDrag(drag: Vec2): Vec2 {
  const dragLength = length(drag);
  if (dragLength <= maxDragDistance || dragLength === 0) {
    return drag;
  }
  return scale(drag, maxDragDistance / dragLength);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pointerPosition(event: MouseEvent): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function mapWidth(): number {
  if (currentMapData.tableBounds) {
    return currentMapData.tableBounds.right - currentMapData.tableBounds.left;
  }
  if (currentMapData.terrain) {
    return currentMapData.terrain.widthCells * currentMapData.terrain.cellSize;
  }
  return billiardsMapData.tableBounds?.right ?? 1;
}

function mapHeight(): number {
  if (currentMapData.tableBounds) {
    return currentMapData.tableBounds.bottom - currentMapData.tableBounds.top;
  }
  if (currentMapData.terrain) {
    return currentMapData.terrain.heightCells * currentMapData.terrain.cellSize;
  }
  return billiardsMapData.tableBounds?.bottom ?? 1;
}

function wallThicknessWorld(): number {
  return currentMapData.terrain
    ? currentMapData.terrain.cellSize * 0.82
    : 14 * PIXEL_BODY_UNIT;
}

function worldToScreen(point: Vec2): Vec2 {
  return {
    x: viewport.x + point.x * viewport.scale,
    y: viewport.y + point.y * viewport.scale
  };
}

function screenToWorld(point: Vec2): Vec2 {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale
  };
}

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  viewport = createViewport();
}

function createViewport() {
  const padding = 28;
  const scale = viewportFitScale(padding);

  return {
    x: (window.innerWidth - mapWidth() * scale) / 2,
    y: (window.innerHeight - mapHeight() * scale) / 2,
    scale
  };
}

function viewportFitScale(padding = 28): number {
  const width = window.innerWidth;
  const height = window.innerHeight;

  return Math.min(
    (width - padding * 2) / mapWidth(),
    (height - padding * 2) / mapHeight()
  );
}

function requiredElement<TElement extends Element>(selector: string): TElement {
  const element = document.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function requiredCanvasContext(
  targetCanvas: HTMLCanvasElement
): CanvasRenderingContext2D {
  const renderingContext = targetCanvas.getContext("2d");
  if (!renderingContext) {
    throw new Error("Canvas 2D context is unavailable.");
  }
  return renderingContext;
}
