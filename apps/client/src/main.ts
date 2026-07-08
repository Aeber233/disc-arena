import {
  actionKindLabel,
  add,
  allBodiesSleeping,
  billiardsMapData,
  buildBodyProxies,
  createBilliardsGameState,
  distance,
  hasTrajectoryPreviewCharge,
  hashGameState,
  isBodyTeleportTargetLegal,
  length,
  OFFICIAL_MAP_SUMMARIES,
  PHYSICS_POWER_SCALE,
  PIXEL_BODY_UNIT,
  portalEndpointA,
  portalEndpointB,
  scale,
  shotPowerLimitForPlayer,
  simulateShot,
  sub,
  TELEPORT_RANGE,
  transformVector
} from "@disc-arena/core";
import type {
  BonusKind,
  BodyState,
  BodyProxy,
  ClientToServerEvents,
  ClipMask,
  GameState,
  GroundMaterial,
  MapObstacleData,
  MapCellShape,
  MapData,
  ObstacleMaterial,
  Portal,
  RoomErrorPayload,
  RoomMember,
  RoomPhase,
  RoomStatePayload,
  ServerToClientEvents,
  ShotIntent,
  ShotResolvedPayload,
  ShrinkCircleState,
  SimulationFrame,
  SimulationOptions,
  StaticWallCollider,
  Vec2
} from "@disc-arena/core";
import { io, type Socket } from "socket.io-client";
import { materialEdgeColor } from "./colors";
import { createMapEditor } from "./mapEditor";
import "./styles.css";

const canvas = requiredElement<HTMLCanvasElement>("#game");
const hud = requiredElement<HTMLElement>("#hud");
const hudSummary = requiredElement<HTMLElement>("#hud-summary");
const hudBody = requiredElement<HTMLDivElement>("#hud-body");
const bonusPanel = requiredElement<HTMLElement>("#bonus-panel");
const bonusSummary = requiredElement<HTMLElement>("#bonus-summary");
const bonusBody = requiredElement<HTMLDivElement>("#bonus-body");
const resetButton = requiredElement<HTMLButtonElement>("#reset");
const playPanel = requiredElement<HTMLDivElement>("#play-panel");
const roomPanel = requiredElement<HTMLDivElement>("#room-panel");
const roomSummary = requiredElement<HTMLElement>("#room-summary");
const roomMembers = requiredElement<HTMLDivElement>("#room-members");
const roomStatus = requiredElement<HTMLDivElement>("#room-status");
const roomCreateButton = requiredElement<HTMLButtonElement>("#room-create");
const roomJoinButton = requiredElement<HTMLButtonElement>("#room-join");
const roomLeaveButton = requiredElement<HTMLButtonElement>("#room-leave");
const roomStartButton = requiredElement<HTMLButtonElement>("#room-start");
const roomImportButton = requiredElement<HTMLButtonElement>("#room-import");
const roomImportFile = requiredElement<HTMLInputElement>("#room-import-file");
const roomOfficialMapSelect = requiredElement<HTMLSelectElement>("#room-official-map");
const roomUseMapButton = requiredElement<HTMLButtonElement>("#room-use-map");
const roomMapDescription = requiredElement<HTMLDivElement>("#room-map-description");
const roomAddBotButton = requiredElement<HTMLButtonElement>("#room-add-bot");
const roomShrinkEnabledInput = requiredElement<HTMLInputElement>("#room-shrink-enabled");
const roomShrinkRoundsInput = requiredElement<HTMLInputElement>("#room-shrink-rounds");
const roomShrinkApplyButton = requiredElement<HTMLButtonElement>("#room-shrink-apply");
const roomCodeInput = requiredElement<HTMLInputElement>("#room-code");
const playerNameInput = requiredElement<HTMLInputElement>("#player-name");
const mainMenu = requiredElement<HTMLDivElement>("#main-menu");
const menuStatus = requiredElement<HTMLDivElement>("#menu-status");
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

const trajectoryPreviewOptions: SimulationOptions = {
  mode: "fast_eval",
  fixedDt: 1 / 60,
  maxSteps: 900,
  collisionIterations: 3,
  recordFrames: true,
  frameIntervalSteps: 4,
  quantize: false
};

const maxDragDistance = 180 * PIXEL_BODY_UNIT;
const maxShotPower = 1500 * PHYSICS_POWER_SCALE;
const cancelAimColor = "rgba(255,255,255,0.32)";
const bodyNumberPixelSize = 3;
const bodyNumberDigitGap = 1;
const pickupVisualSizePx = 18;
const pickupBorderPx = 2;
const pickupQuestionBlockPx = 2;
const tableSurroundColor = "#23754c";
const tableSurfaceColor = "#1b5f3e";
const voidSurfaceColor = "#303238";
const playMinZoomFactor = 0.65;
const playMaxZoomFactor = 12;
const groundColors: Record<GroundMaterial, string> = {
  void: voidSurfaceColor,
  grass: tableSurfaceColor,
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
const pixelWallFill = obstacleColors.wood;
const pixelTableBorderColor = materialEdgeColor(tableSurfaceColor);
const trailMinSpeed = 25 * PIXEL_BODY_UNIT;
const trailFullSpeed = 520 * PIXEL_BODY_UNIT;
const defaultShrinkCollapseRounds = 10;
const shrinkVisualAnimationRate = 7;
const shrinkVisualSnapEpsilon = PIXEL_BODY_UNIT * 0.25;
const socketUrl = import.meta.env.VITE_SOCKET_URL ?? "http://127.0.0.1:3000";
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketUrl);
const rejoinSessionKey = "disc-arena-rejoin-token";
const defaultShrinkCircleState: ShrinkCircleState = {
  enabled: false,
  active: false,
  collapseRounds: defaultShrinkCollapseRounds,
  startTurnIndex: 0,
  endTurnIndex: 0,
  progress: 0,
  center: { x: 0, y: 0 },
  safeRadius: 0
};
for (const summary of OFFICIAL_MAP_SUMMARIES) {
  const option = document.createElement("option");
  option.value = summary.id;
  option.textContent = summary.name;
  roomOfficialMapSelect.append(option);
}
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

interface PlaybackKeyframe {
  readonly step: number;
  readonly state: GameState;
}

interface AuthoritativePlayback {
  readonly shotId: string;
  readonly keyframes: readonly PlaybackKeyframe[];
  readonly resolved: ShotResolvedPayload;
  readonly appliedMapEventKeys: Set<string>;
  elapsedSeconds: number;
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
let selectedOfficialMapId = billiardsMapData.id;
let gameState = createBilliardsGameState();
let stateHash = hashGameState(gameState, true);
let localPlayerId: string | undefined;
let roomId: string | null = null;
let ignoredRoomId: string | null = null;
let roomPhase: RoomPhase = "lobby";
let ownerPlayerId: string | undefined;
let winnerPlayerId: string | undefined;
let players: readonly RoomMember[] = [];
let shrinkCircle: ShrinkCircleState = defaultShrinkCircleState;
let visualShrinkCircle: ShrinkCircleState = defaultShrinkCircleState;
let shrinkCircleControlsDirty = false;
let selectedBodyId: string | undefined;
let selectedProxyId: string | undefined;
let pointerStart: Vec2 | undefined;
let pointerCurrent: Vec2 | undefined;
let playPanPointerId: number | undefined;
let playPanLastPoint: Vec2 | undefined;
let authoritativePlayback: AuthoritativePlayback | undefined;
let pendingRoomState: RoomStatePayload | undefined;
const pendingResolvedShots: ShotResolvedPayload[] = [];
let awaitingShotId: string | undefined;
let connectionState = "connecting";
let roomMessage = "Create or join a room.";
let hudCollapsed = false;
let bonusCollapsed = false;
let roomCollapsed = false;
let bonusPanelRenderKey: string | undefined;
let bonusResolving = false;
let bonusMessage = "";
let lastTime = performance.now();
let accumulator = 0;
let viewport = createViewport();

resetButton.addEventListener("click", () => {
  if (socket.connected && roomId) {
    socket.emit("room:reset");
  } else {
    const nextState = createBilliardsGameState();
    resetLocalState(nextState, hashGameState(nextState, true));
  }
});

roomCreateButton.addEventListener("click", () => {
  ignoredRoomId = null;
  if (roomId) {
    setAppMode("play");
    return;
  }
  roomMessage = "Creating room...";
  const playerName = playerNameInput.value.trim();
  socket.emit("room:create", {
    ...(playerName ? { playerName } : {})
  });
  renderRoomPanel();
});

roomJoinButton.addEventListener("click", () => {
  ignoredRoomId = null;
  if (roomId) {
    setAppMode("play");
    return;
  }
  const code = normalizeRoomCode(roomCodeInput.value);
  if (!code) {
    roomMessage = "Enter a four digit room code.";
    renderRoomPanel();
    return;
  }
  roomMessage = `Joining ${code}...`;
  const playerName = playerNameInput.value.trim();
  const rejoinToken = rejoinTokenForRoom(code);
  socket.emit("room:join", {
    roomId: code,
    ...(playerName ? { playerName } : {}),
    ...(rejoinToken ? { rejoinToken } : {})
  });
  renderRoomPanel();
});

roomStartButton.addEventListener("click", () => {
  socket.emit("room:start");
});

roomImportButton.addEventListener("click", () => {
  roomImportFile.click();
});

roomImportFile.addEventListener("change", () => {
  void importRoomMap(roomImportFile);
});

roomOfficialMapSelect.addEventListener("change", () => {
  selectedOfficialMapId = roomOfficialMapSelect.value;
  renderRoomPanel();
});

roomUseMapButton.addEventListener("click", () => {
  if (!isOfficialMapOption(selectedOfficialMapId)) {
    return;
  }
  roomMessage = "Selecting map...";
  renderRoomPanel();
  socket.emit("room:select_official_map", { mapId: selectedOfficialMapId });
});

roomAddBotButton.addEventListener("click", () => {
  socket.emit("room:add_bot", {});
});

roomShrinkEnabledInput.addEventListener("change", () => {
  shrinkCircleControlsDirty = true;
});

roomShrinkRoundsInput.addEventListener("input", () => {
  shrinkCircleControlsDirty = true;
});

roomShrinkApplyButton.addEventListener("click", () => {
  const collapseRounds = Number(roomShrinkRoundsInput.value);
  socket.emit("room:update_shrink_circle", {
    enabled: roomShrinkEnabledInput.checked,
    collapseRounds: Number.isFinite(collapseRounds) ? collapseRounds : defaultShrinkCollapseRounds
  });
});

roomLeaveButton.addEventListener("click", () => {
  const leavingRoomId = roomId;
  if (roomId) {
    socket.emit("room:leave");
  }
  clearRejoinToken();
  clearRoomState();
  ignoredRoomId = leavingRoomId;
  setAppMode("menu");
});

roomMembers.addEventListener("click", (event) => {
  const button = eventButton(event.target)?.closest<HTMLButtonElement>(
    "button[data-kick-player]"
  );
  const playerId = button?.dataset.kickPlayer;
  if (!playerId) {
    return;
  }
  roomMessage = "Updating room...";
  renderRoomPanel();
  socket.emit("room:kick", { playerId });
});

bonusBody.addEventListener("click", (event) => {
  const button = eventButton(event.target)?.closest<HTMLButtonElement>(
    "button[data-bonus-action]"
  );
  if (
    !(button instanceof HTMLButtonElement) ||
    button.disabled ||
    bonusResolving ||
    !canResolveBonus()
  ) {
    return;
  }
  const action = button.dataset.bonusAction;
  const optionId = action === "option" ? button.dataset.bonusOptionId : undefined;
  if (action !== "keep" && !optionId) {
    return;
  }
  bonusResolving = true;
  bonusMessage = "Resolving...";
  invalidateBonusPanel();
  renderBonusPanel();
  socket.emit("bonus:resolve", {
    knownStateHash: stateHash,
    ...(optionId ? { optionId } : {})
  });
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const panel = target.closest<HTMLElement>("[data-collapse-panel]");
  const panelId = panel?.dataset.collapsePanel;
  if (panelId === "hud") {
    hudCollapsed = !hudCollapsed;
    renderCollapsiblePanels();
  }
  if (panelId === "bonus") {
    bonusCollapsed = !bonusCollapsed;
    renderCollapsiblePanels();
  }
  if (panelId === "room") {
    roomCollapsed = !roomCollapsed;
    renderCollapsiblePanels();
  }
});

menuEditorButton.addEventListener("click", () => setAppMode("editor"));
playMenuButton.addEventListener("click", () => setAppMode("menu"));
editorMenuButton.addEventListener("click", () => setAppMode("menu"));

socket.on("connect", () => {
  connectionState = "connected";
  renderRoomPanel();
});

socket.on("disconnect", () => {
  connectionState = "disconnected";
  renderRoomPanel();
});

socket.on("room:joined", (payload) => {
  ignoredRoomId = null;
  localPlayerId = payload.playerId;
  roomMessage = `Joined room ${payload.roomId ?? ""}.`;
  if (payload.roomId) {
    roomCodeInput.value = payload.roomId;
    saveRejoinToken(payload.roomId, payload.rejoinToken);
  }
  applyRoomState(payload);
  setAppMode("play");
});

socket.on("room:state", (payload) => {
  if (!roomId && payload.roomId && payload.roomId === ignoredRoomId) {
    return;
  }
  if (isAuthoritativePlaybackBusy()) {
    pendingRoomState = payload;
    return;
  }
  applyRoomState(payload);
});

socket.on("room:error", (payload) => {
  handleRoomError(payload);
});

socket.on("shot:started", (payload) => {
  if (authoritativePlayback || pendingResolvedShots.length > 0) {
    return;
  }
  awaitingShotId = payload.shotId;
  gameState.phase = "simulating";
  renderRoomPanel();
});

socket.on("shot:resolved", (payload) => {
  playOrQueueResolvedShot(payload);
});

socket.on("shot:rejected", (payload) => {
  awaitingShotId = undefined;
  authoritativePlayback = undefined;
  pendingRoomState = undefined;
  pendingResolvedShots.length = 0;
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
    updateAuthoritativePlayback(frameDt);
    updateVisualShrinkCircle(frameDt);
    accumulator = 0;
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

  if (isTeleportMode()) {
    handleTeleportPointerDown(screenPoint);
    return;
  }
  if (isAnchorMode()) {
    handleAnchorPointerDown(screenPoint);
    return;
  }

  if (!canShoot()) {
    return;
  }

  const worldPoint = screenToWorld(screenPoint);
  const picked = pickBodyProxy(worldPoint, bodyProxiesForRender(), gameState.bodies);
  if (!picked || !canSelectBody(picked.body)) {
    return;
  }

  selectedBodyId = picked.body.id;
  selectedProxyId = picked.proxy.proxyId;
  pointerStart = { ...picked.proxy.position };
  pointerCurrent = worldPoint;
  canvas.setPointerCapture(event.pointerId);
}

function handleTeleportPointerDown(screenPoint: Vec2): void {
  if (!canShoot()) {
    return;
  }
  const worldPoint = screenToWorld(screenPoint);
  const picked = pickBodyProxy(worldPoint, bodyProxiesForRender(), gameState.bodies);
  if (picked && canTeleportBody(picked.body)) {
    selectedBodyId = picked.body.id;
    selectedProxyId = picked.proxy.proxyId;
    pointerStart = undefined;
    pointerCurrent = undefined;
    return;
  }
  if (!selectedBodyId) {
    roomMessage = "Select one of your balls to teleport.";
    renderRoomPanel();
    return;
  }
  if (!isBodyTeleportTargetLegal(gameState, currentMapData, selectedBodyId, worldPoint)) {
    roomMessage = "That teleport spot is not legal.";
    renderRoomPanel();
    return;
  }
  roomMessage = "Teleporting...";
  renderRoomPanel();
  socket.emit("bonus:teleport", {
    knownStateHash: stateHash,
    bodyId: selectedBodyId,
    position: worldPoint
  });
}

function handleAnchorPointerDown(screenPoint: Vec2): void {
  if (!canShoot()) {
    return;
  }
  const worldPoint = screenToWorld(screenPoint);
  const picked = pickBodyProxy(worldPoint, bodyProxiesForRender(), gameState.bodies);
  if (!picked?.body.alive) {
    roomMessage = "Select a ball to anchor.";
    renderRoomPanel();
    return;
  }
  roomMessage = "Anchoring...";
  renderRoomPanel();
  socket.emit("bonus:anchor", {
    knownStateHash: stateHash,
    bodyId: picked.body.id
  });
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

  if (isTeleportMode() || isAnchorMode()) {
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
  const power = (length(drag) / maxDragDistance) * currentShotPowerLimit();
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
    awaitingShotId = shotId;
    gameState.phase = "simulating";
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
  renderRoomPanel();
}

function renderMenu(): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.fillStyle = "#101613";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255,255,255,0.035)";
  const grid = Math.max(24, Math.round(32 * window.devicePixelRatio));
  for (let x = 0; x < canvas.width + grid; x += grid) {
    context.fillRect(x, 0, 2, canvas.height);
  }
  for (let y = 0; y < canvas.height + grid; y += grid) {
    context.fillRect(0, y, canvas.width, 2);
  }
  context.restore();
}

function render(now: number): void {
  const proxies = bodyProxiesForRender();
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawTable();
  drawPortals();
  drawWalls();
  drawShrinkCircleOverlay();
  drawPickups();
  drawAim(now, proxies);
  drawActionTargetHints(proxies);
  drawAnchorFields();
  drawBodies(proxies);
  drawPlaybackEffects();
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

function drawShrinkCircleOverlay(): void {
  const circle = visualShrinkCircle;
  if (!circle.enabled || !circle.active) {
    return;
  }

  const bounds = currentMapBounds();
  const topLeft = worldToScreen({ x: bounds.left, y: bounds.top });
  const bottomRight = worldToScreen({ x: bounds.right, y: bounds.bottom });
  const center = worldToScreen(circle.center);
  const safeRadius = circle.safeRadius * viewport.scale;

  context.save();
  context.beginPath();
  context.rect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y
  );
  if (safeRadius > 0.5 && circle.progress < 1) {
    context.moveTo(center.x + safeRadius, center.y);
    context.arc(center.x, center.y, safeRadius, 0, Math.PI * 2);
  }
  context.fillStyle = "rgba(255, 92, 168, 0.32)";
  context.fill("evenodd");

  if (safeRadius > 0.5 && circle.progress < 1) {
    context.beginPath();
    context.arc(center.x, center.y, safeRadius, 0, Math.PI * 2);
    context.strokeStyle = "rgba(255, 174, 214, 0.72)";
    context.lineWidth = Math.max(2, Math.round(3 * window.devicePixelRatio));
    context.stroke();
  }
  context.restore();
}

function updateVisualShrinkCircle(frameDt: number): void {
  if (!shrinkCircle.enabled || !shrinkCircle.active) {
    visualShrinkCircle = shrinkCircle;
    return;
  }

  if (!visualShrinkCircle.enabled || !visualShrinkCircle.active) {
    visualShrinkCircle = visualShrinkCircleFromInitialRadius(shrinkCircle);
    return;
  }

  const radiusDelta = shrinkCircle.safeRadius - visualShrinkCircle.safeRadius;
  const progressDelta = shrinkCircle.progress - visualShrinkCircle.progress;
  if (
    Math.abs(radiusDelta) <= shrinkVisualSnapEpsilon &&
    Math.abs(progressDelta) <= 0.001
  ) {
    visualShrinkCircle = shrinkCircle;
    return;
  }

  const alpha = 1 - Math.exp(-shrinkVisualAnimationRate * frameDt);
  const nextSafeRadius = visualShrinkCircle.safeRadius + radiusDelta * alpha;
  const nextProgress = visualShrinkCircle.progress + progressDelta * alpha;
  visualShrinkCircle = {
    ...shrinkCircle,
    progress: nextProgress,
    safeRadius: nextSafeRadius
  };
}

function setShrinkCircle(next: ShrinkCircleState, animate: boolean): void {
  const shouldSnap =
    !animate ||
    !next.enabled ||
    !next.active ||
    shrinkCircle.enabled !== next.enabled ||
    distance(shrinkCircle.center, next.center) > PIXEL_BODY_UNIT;

  shrinkCircle = next;
  if (shouldSnap) {
    visualShrinkCircle = next;
    return;
  }

  if (!visualShrinkCircle.enabled || !visualShrinkCircle.active) {
    visualShrinkCircle = visualShrinkCircleFromInitialRadius(next);
    return;
  }

  visualShrinkCircle = {
    ...next,
    progress: visualShrinkCircle.progress,
    safeRadius: visualShrinkCircle.safeRadius
  };
}

function visualShrinkCircleFromInitialRadius(target: ShrinkCircleState): ShrinkCircleState {
  const initialRadius = Math.max(target.safeRadius, initialShrinkSafeRadius());
  const fullRadius = target.progress < 1
    ? target.safeRadius / Math.max(0.001, 1 - target.progress)
    : initialShrinkSafeRadius();
  const progress = 1 - initialRadius / Math.max(1, fullRadius);
  return {
    ...target,
    progress: Math.max(0, Math.min(target.progress, progress)),
    safeRadius: initialRadius
  };
}

function initialShrinkSafeRadius(): number {
  const bounds = currentMapBounds();
  return Math.hypot(bounds.right - bounds.left, bounds.bottom - bounds.top) / 2;
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

function drawPickups(): void {
  const pickups = gameState.pickups ?? [];
  if (pickups.length === 0) {
    return;
  }

  context.save();
  for (const pickup of pickups) {
    const center = worldToScreen(pickup.position);
    const size = pickupVisualSizePx;
    const left = Math.round(center.x - size / 2);
    const top = Math.round(center.y - size / 2);
    const innerSize = size - pickupBorderPx * 2;

    context.fillStyle = "#3a2600";
    context.fillRect(left, top, size, size);
    context.fillStyle = "#f7c547";
    context.fillRect(left + pickupBorderPx, top + pickupBorderPx, innerSize, innerSize);
    context.fillStyle = "#fff1a8";
    context.fillRect(left + 4, top + 4, size - 8, 2);
    context.fillRect(left + 4, top + 4, 2, size - 8);
    context.fillStyle = "#101010";
    drawPixelQuestionMark(center.x, center.y, pickupQuestionBlockPx);
  }
  context.restore();
}

function drawPixelQuestionMark(centerX: number, centerY: number, blockSize: number): void {
  const glyph = ["1110", "0001", "0110", "0100", "0000", "0100"];
  const width = glyph[0]!.length * blockSize;
  const height = glyph.length * blockSize;
  const left = Math.round(centerX - width / 2);
  const top = Math.round(centerY - height / 2);
  for (let row = 0; row < glyph.length; row += 1) {
    const line = glyph[row]!;
    for (let column = 0; column < line.length; column += 1) {
      if (line[column] !== "1") {
        continue;
      }
      context.fillRect(left + column * blockSize, top + row * blockSize, blockSize, blockSize);
    }
  }
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
      if (!cell) {
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
        obstacleColors[cell.material]
      );
    }
  }
}

function drawObstacleBoundaryLines(): void {
  const outline = Math.max(2, Math.round(4 * viewport.scale));

  context.save();
  clipToObstacleLayer();
  context.lineWidth = outline * 2;
  context.lineCap = "square";

  for (const collider of currentMapData.colliders) {
    if (collider.type !== "static_wall") {
      continue;
    }
    const start = worldToScreen(collider.start);
    const end = worldToScreen(collider.end);
    context.strokeStyle = materialEdgeColor(obstacleColor(collider.material));
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
      if (!cell) {
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
  const fill = obstacleColor(collider.material);
  const outlineColor = materialEdgeColor(fill);

  context.save();
  context.translate(start.x, start.y);
  context.rotate(Math.atan2(dy, dx));
  context.fillStyle = fill;
  context.fillRect(0, top, lengthPx, thickness);

  context.save();
  context.beginPath();
  context.rect(0, top, lengthPx, thickness);
  context.clip();
  context.strokeStyle = outlineColor;
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

function obstacleColor(material: ObstacleMaterial | undefined): string {
  return material ? obstacleColors[material] : pixelWallFill;
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
  if (!inDeadZone && playerHasTrajectoryPreview()) {
    drawTrajectoryPreview(body, proxy, drag);
  }
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

function drawTrajectoryPreview(body: BodyState, proxy: BodyProxy, drag: Vec2): void {
  const power = (length(drag) / maxDragDistance) * currentShotPowerLimit();
  if (power <= 0) {
    return;
  }

  const direction = transformVector(scale(drag, -1), proxy.transformToBody);
  const shotIntent: ShotIntent = {
    actorBodyId: body.id,
    angle: Math.atan2(direction.y, direction.x),
    power,
    spinOffset: 0
  };
  const previewState = cloneGameState(gameState);
  previewState.phase = "waiting_for_shot";
  const result = simulateShot(
    previewState,
    currentMapData,
    shotIntent,
    trajectoryPreviewOptions
  );
  const collisionStep = result.events.find(
    (event) =>
      event.type === "collision" &&
      event.bodyIds?.includes(body.id) &&
      event.bodyIds.length > 1
  )?.step ?? Number.POSITIVE_INFINITY;
  const points = [
    body.position,
    ...(result.frames ?? [])
      .filter((frame) => frame.step <= collisionStep)
      .map((frame) => frame.state.bodies.find((candidate) => candidate.id === body.id)?.position)
      .filter((point): point is Vec2 => point !== undefined)
  ];
  if (points.length < 2) {
    return;
  }

  context.save();
  context.lineWidth = 2;
  context.lineCap = "round";
  context.setLineDash([6, 7]);
  context.strokeStyle = "rgba(247, 197, 71, 0.9)";
  context.beginPath();
  const first = worldToScreen(points[0]!);
  context.moveTo(first.x, first.y);
  for (const point of points.slice(1)) {
    const screenPoint = worldToScreen(point);
    context.lineTo(screenPoint.x, screenPoint.y);
  }
  context.stroke();
  context.restore();
}

function drawActionTargetHints(proxies: readonly BodyProxy[]): void {
  if (isTeleportMode()) {
    const selectedBody = selectedBodyId
      ? gameState.bodies.find((body) => body.id === selectedBodyId)
      : undefined;
    const selectedProxy = selectedBody
      ? selectedProxyForBody(selectedBody.id, proxies)
      : undefined;
    context.save();
    context.lineWidth = 2;
    context.setLineDash([8, 8]);
    context.strokeStyle = "rgba(255,255,255,0.74)";
    if (selectedProxy) {
      const center = worldToScreen(selectedProxy.position);
      context.beginPath();
      context.arc(center.x, center.y, TELEPORT_RANGE * viewport.scale, 0, Math.PI * 2);
      context.stroke();
    } else {
      for (const proxy of proxies) {
        const body = gameState.bodies.find((candidate) => candidate.id === proxy.bodyId);
        if (!body || !canTeleportBody(body)) {
          continue;
        }
        const center = worldToScreen(proxy.position);
        context.beginPath();
        context.arc(center.x, center.y, proxy.radius * viewport.scale + 5, 0, Math.PI * 2);
        context.stroke();
      }
    }
    context.restore();
    return;
  }

  if (isAnchorMode()) {
    context.save();
    context.lineWidth = 2;
    context.setLineDash([3, 5]);
    context.strokeStyle = "rgba(255,255,255,0.58)";
    for (const proxy of proxies) {
      const body = gameState.bodies.find((candidate) => candidate.id === proxy.bodyId);
      if (!body?.alive) {
        continue;
      }
      const center = worldToScreen(proxy.position);
      context.beginPath();
      context.arc(center.x, center.y, proxy.radius * viewport.scale + 6, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }
}

function drawAnchorFields(): void {
  context.save();
  context.lineWidth = 2;
  context.setLineDash([6, 6]);
  context.strokeStyle = "rgba(255,255,255,0.42)";
  for (const body of gameState.bodies) {
    if (!body.alive) {
      continue;
    }
    for (const modifier of body.modifiers) {
      if (modifier.kind !== "anchor") {
        continue;
      }
      const origin = vec2FromUnknown(modifier.data?.origin);
      const radius = typeof modifier.data?.radius === "number"
        ? modifier.data.radius
        : body.radius * 2;
      if (!origin || radius <= 0) {
        continue;
      }
      const center = worldToScreen(origin);
      context.beginPath();
      context.arc(center.x, center.y, radius * viewport.scale, 0, Math.PI * 2);
      context.stroke();
    }
  }
  context.restore();
}

function drawPlaybackEffects(): void {
  const playback = authoritativePlayback;
  if (!playback) {
    return;
  }
  const currentStep = playback.elapsedSeconds / simulationOptions.fixedDt;
  for (const event of playback.resolved.events) {
    if (event.type !== "bomb_exploded") {
      continue;
    }
    const position = vec2FromUnknown(event.data?.position);
    const radius = typeof event.data?.radius === "number" ? event.data.radius : 0;
    if (!position || radius <= 0) {
      continue;
    }
    const durationSteps = 24;
    const age = currentStep - event.step;
    if (age < 0 || age > durationSteps) {
      continue;
    }
    const progress = clampNumber(age / durationSteps, 0, 1);
    drawPixelShockwave(position, radius * progress, 1 - progress);
  }
}

function drawPixelShockwave(position: Vec2, radius: number, alpha: number): void {
  const center = worldToScreen(position);
  const pixelRadius = radius * viewport.scale;
  if (pixelRadius <= 1) {
    return;
  }
  const block = 2;
  const segments = Math.max(24, Math.ceil(pixelRadius * 2.2));
  context.save();
  context.fillStyle = `rgba(255,255,255,${Math.max(0, alpha)})`;
  for (let index = 0; index < segments; index += 1) {
    const angle = (Math.PI * 2 * index) / segments;
    const x = center.x + Math.cos(angle) * pixelRadius;
    const y = center.y + Math.sin(angle) * pixelRadius;
    context.fillRect(Math.round(x - block / 2), Math.round(y - block / 2), block, block);
  }
  context.restore();
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
  selectedBodyId = undefined;
  selectedProxyId = undefined;
  pointerStart = undefined;
  pointerCurrent = undefined;
  awaitingShotId = undefined;
  authoritativePlayback = undefined;
  bodyTrailHistory.clear();
  clearBonusInteractionState();
}

function canShoot(): boolean {
  const member = localMember();
  return (
    socket.connected &&
    roomId !== null &&
    localPlayerId !== undefined &&
    awaitingShotId === undefined &&
    authoritativePlayback === undefined &&
    member !== undefined &&
    member.connected &&
    !member.eliminated &&
    gameState.currentPlayerId === localPlayerId &&
    gameState.phase === "waiting_for_shot" &&
    allBodiesSleeping(gameState.bodies)
  );
}

function canSelectBody(body: BodyState): boolean {
  if (!canShoot() || body.ownerPlayerId !== localPlayerId) {
    return false;
  }
  const constraint = gameState.activeActionConstraint;
  if (!constraint || constraint.ownerPlayerId !== localPlayerId) {
    return true;
  }
  return !constraint.actorBodyId || constraint.actorBodyId === body.id;
}

function isTeleportMode(): boolean {
  return Boolean(
    localPlayerId &&
    gameState.activeActionConstraint?.kind === "teleport" &&
    gameState.activeActionConstraint.ownerPlayerId === localPlayerId
  );
}

function isAnchorMode(): boolean {
  return Boolean(
    localPlayerId &&
    gameState.activeActionConstraint?.kind === "anchor" &&
    gameState.activeActionConstraint.ownerPlayerId === localPlayerId
  );
}

function canTeleportBody(body: BodyState): boolean {
  return Boolean(canShoot() && body.alive && body.ownerPlayerId === localPlayerId);
}

function canResolveBonus(): boolean {
  const hasOwnedOptions = Boolean(
    localPlayerId &&
    gameState.playerBonuses?.some(
      (bonus) => bonus.playerId === localPlayerId && bonus.options.length > 0
    )
  );
  return Boolean(
    socket.connected &&
    roomId !== null &&
    localPlayerId !== undefined &&
    (
      hasOwnedOptions ||
      (gameState.phase === "choosing_bonus" &&
        gameState.pendingBonusChoice?.playerId === localPlayerId) ||
      (gameState.phase === "waiting_for_shot" &&
        gameState.currentPlayerId === localPlayerId)
    )
  );
}

function currentShotPowerLimit(): number {
  return localPlayerId ? shotPowerLimitForPlayer(gameState, localPlayerId) : maxShotPower;
}

function playerHasTrajectoryPreview(): boolean {
  return Boolean(localPlayerId && hasTrajectoryPreviewCharge(gameState, localPlayerId));
}

function updateHud(): void {
  renderRoomPanel();
  renderBonusPanel();
  if (!roomId) {
    hudSummary.textContent = connectionState;
    hudBody.textContent = "Create or join a room";
    return;
  }

  const aliveCount = gameState.bodies.filter((body) => body.alive).length;
  const activePlayer = playerLabel(gameState.currentPlayerId);
  const me = localPlayerId ? playerLabel(localPlayerId) : "?";
  const stateText = hudStateText();
  const shrinkDisplay = visualShrinkCircle.enabled ? visualShrinkCircle : shrinkCircle;
  const shrinkText = shrinkCircle.enabled
    ? ` | Shrink ${Math.round(shrinkDisplay.progress * 100)}%`
    : "";
  const actionText = gameState.activeActionConstraint
    ? ` | Mode ${actionKindLabel(gameState.activeActionConstraint.kind)}`
    : "";
  const powerText = localPlayerId
    ? ` | Power ${Math.round(currentShotPowerLimit() / PHYSICS_POWER_SCALE)}`
    : "";

  hudSummary.textContent = `${stateText} | Round ${currentRoundNumber()} | Action ${gameState.turnIndex + 1}`;
  hudBody.textContent = `Room ${roomId} | ${connectionState} | You ${me} | Active ${activePlayer} | Balls ${aliveCount}${powerText}${actionText}${shrinkText}`;
}

function currentRoundNumber(): number {
  if (typeof gameState.roundIndex === "number") {
    return gameState.roundIndex + 1;
  }
  const orderLength = Math.max(1, gameState.players.length || players.length || 1);
  const slotIndex = gameState.roundSlotIndex ?? gameState.turnIndex;
  return Math.floor(slotIndex / orderLength) + 1;
}

function hudStateText(): string {
  if (authoritativePlayback) {
    return "Playback";
  }
  if (awaitingShotId) {
    return "Resolving";
  }
  if (gameState.phase === "finished") {
    return `Winner ${winnerPlayerId ? playerLabel(winnerPlayerId) : "-"}`;
  }
  if (gameState.phase === "waiting_for_shot") {
    return canShoot() ? "Your turn" : "Waiting";
  }
  return allBodiesSleeping(gameState.bodies) ? "Settled" : "Rolling";
}

function renderBonusPanel(): void {
  const bonusState = localPlayerId
    ? gameState.playerBonuses?.find((bonus) => bonus.playerId === localPlayerId)
    : undefined;
  const options = bonusState?.options ?? [];
  const activeChoice = canResolveBonus();
  const buttonsEnabled = activeChoice && !bonusResolving;
  const showPanel =
    options.length > 0 ||
    gameState.phase === "choosing_bonus" ||
    bonusResolving ||
    bonusMessage.length > 0;
  const renderKey = bonusPanelKey(options, showPanel, buttonsEnabled);
  if (bonusPanelRenderKey === renderKey) {
    return;
  }
  bonusPanelRenderKey = renderKey;
  bonusPanel.hidden = !showPanel;
  if (!showPanel) {
    bonusBody.replaceChildren();
    bonusSummary.textContent = "No choices";
    renderCollapsiblePanels();
    return;
  }

  bonusSummary.textContent = bonusResolving
    ? "Resolving..."
    : options.length > 0
      ? `${options.length} choice${options.length === 1 ? "" : "s"}`
      : "Keep or wait";
  const optionButtons = options.map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bonus-option";
    button.dataset.bonusAction = "option";
    button.dataset.bonusOptionId = option.id;
    button.disabled = !buttonsEnabled;
    button.textContent = bonusLabel(option.kind);
    return button;
  });
  const keep = document.createElement("button");
  keep.type = "button";
  keep.className = "bonus-keep";
  keep.dataset.bonusAction = "keep";
  keep.disabled =
    !buttonsEnabled || (options.length === 0 && gameState.phase !== "choosing_bonus");
  keep.textContent = "Keep";
  const wrapper = document.createElement("div");
  wrapper.className = "bonus-options";
  const children: HTMLElement[] = [...optionButtons, keep];
  if (bonusMessage) {
    const message = document.createElement("div");
    message.className = `bonus-message${bonusResolving ? "" : " is-error"}`;
    message.textContent = bonusMessage;
    children.push(message);
  }
  wrapper.replaceChildren(...children);
  bonusBody.replaceChildren(wrapper);
  renderCollapsiblePanels();
}

function bonusPanelKey(
  options: readonly { readonly id: string; readonly kind: BonusKind }[],
  showPanel: boolean,
  buttonsEnabled: boolean
): string {
  return [
    showPanel ? "show" : "hide",
    buttonsEnabled ? "enabled" : "disabled",
    bonusResolving ? "resolving" : "idle",
    bonusMessage,
    roomId ?? "",
    localPlayerId ?? "",
    gameState.phase,
    gameState.currentPlayerId,
    gameState.pendingBonusChoice?.playerId ?? "",
    options.map((option) => `${option.id}:${option.kind}`).join("|")
  ].join("\n");
}

function invalidateBonusPanel(): void {
  bonusPanelRenderKey = undefined;
}

function clearBonusInteractionState(): void {
  bonusResolving = false;
  bonusMessage = "";
  invalidateBonusPanel();
}

function bonusLabel(kind: BonusKind): string {
  switch (kind) {
    case "power_stack":
      return "Power cap +600";
    case "trajectory_preview":
      return "Long trajectory preview";
    case "single_power_boost":
      return "Next shot power +1000";
    case "mass_up":
      return "Source ball mass up, same size";
    case "size_up":
      return "Source ball bigger";
    case "size_down":
      return "Source ball smaller";
    case "extra_action_any":
      return "Extra action";
    case "shuriken":
      return "Shuriken action";
    case "bomb":
      return "Bomb action";
    case "summon_half_ball":
      return "Launch new half ball";
    case "teleport":
      return "Teleport action";
    case "anchor":
      return "Anchor a ball";
    case "extra_action_on_elimination":
      return "Extra action on ring-out";
  }
}

function applyRoomState(payload: RoomStatePayload): void {
  const previousRoomId = roomId;
  const previousMapId = currentMapData.id;
  roomId = payload.roomId;
  roomPhase = payload.roomPhase;
  ownerPlayerId = payload.ownerPlayerId;
  winnerPlayerId = payload.winnerPlayerId;
  if (payload.playerId) {
    localPlayerId = payload.playerId;
  }
  players = payload.players;
  currentMapData = payload.mapData;
  if (previousRoomId !== payload.roomId || previousMapId !== payload.mapData.id) {
    selectedOfficialMapId = payload.mapData.id;
  }
  setShrinkCircle(
    payload.shrinkCircle,
    previousRoomId === payload.roomId && previousMapId === payload.mapData.id
  );
  shrinkCircleControlsDirty = false;
  if (previousRoomId !== payload.roomId || previousMapId !== payload.mapData.id) {
    viewport = createViewport();
  }
  resetLocalState(payload.gameState, payload.stateHash);
  renderRoomPanel();
}

function playOrQueueResolvedShot(payload: ShotResolvedPayload): void {
  if (authoritativePlayback) {
    pendingResolvedShots.push(payload);
    return;
  }
  startAuthoritativePlayback(payload);
}

function startAuthoritativePlayback(payload: ShotResolvedPayload): void {
  if (payload.shrinkCircle) {
    setShrinkCircle(payload.shrinkCircle, true);
  }
  const keyframes = buildPlaybackKeyframes(payload);
  if (keyframes.length < 2) {
    applyResolvedShot(payload);
    return;
  }

  awaitingShotId = undefined;
  authoritativePlayback = {
    shotId: payload.shotId,
    keyframes,
    resolved: payload,
    appliedMapEventKeys: new Set(),
    elapsedSeconds: 0
  };
  gameState = cloneGameState(keyframes[0]!.state);
  gameState.phase = "simulating";
  applyPlaybackMapEventsUpToStep(0);
  bodyTrailHistory.clear();
}

function applyResolvedShot(payload: ShotResolvedPayload): void {
  if (payload.shrinkCircle) {
    setShrinkCircle(payload.shrinkCircle, true);
  }
  if (payload.finalMapData) {
    currentMapData = payload.finalMapData;
  }
  resetLocalState(payload.finalState, payload.resultHash);
  roomPhase = phaseFromGameState(payload.finalState);
  winnerPlayerId = winnerPlayerIdFromState(payload.finalState);
  players = syncMemberSnapshots(players, payload.finalState);
  awaitingShotId = undefined;
  authoritativePlayback = undefined;
  renderRoomPanel();
  drainAuthoritativePlaybackQueue();
}

function updateAuthoritativePlayback(frameDt: number): void {
  if (!authoritativePlayback) {
    return;
  }

  authoritativePlayback.elapsedSeconds += frameDt;
  const elapsedStep = authoritativePlayback.elapsedSeconds / simulationOptions.fixedDt;
  applyPlaybackMapEventsUpToStep(elapsedStep);
  const frames = authoritativePlayback.keyframes;
  const lastFrame = frames[frames.length - 1]!;
  if (elapsedStep >= lastFrame.step) {
    applyResolvedShot(authoritativePlayback.resolved);
    return;
  }

  const nextIndex = frames.findIndex((frame) => frame.step >= elapsedStep);
  const to = frames[Math.max(1, nextIndex)] ?? lastFrame;
  const from = frames[Math.max(0, Math.max(1, nextIndex) - 1)] ?? frames[0]!;
  const span = Math.max(1, to.step - from.step);
  const t = clampNumber((elapsedStep - from.step) / span, 0, 1);
  gameState = interpolateGameState(from.state, to.state, t);
  gameState.phase = "simulating";
}

function applyPlaybackMapEventsUpToStep(step: number): void {
  const playback = authoritativePlayback;
  if (!playback) {
    return;
  }

  playback.resolved.events.forEach((event, index) => {
    if (!isMapChangeEvent(event.type) || event.step > step) {
      return;
    }
    const key = `${event.type}:${event.step}:${index}`;
    if (playback.appliedMapEventKeys.has(key)) {
      return;
    }
    currentMapData = applyMapChangeEvent(currentMapData, event);
    playback.appliedMapEventKeys.add(key);
  });
}

function applyMapChangeEvent(
  mapData: MapData,
  event: ShotResolvedPayload["events"][number]
): MapData {
  const cells = mapPatchCells(event.data?.cells);
  if (cells.length === 0) {
    return mapData;
  }

  const next = cloneMapData(mapData);
  if (event.type === "terrain_changed" && next.terrain) {
    const terrain = next.terrain as unknown as {
      cells: Array<{ material: GroundMaterial; shape: MapCellShape }>;
    };
    for (const cell of cells) {
      if (cell.material === null || typeof cell.material !== "string") {
        continue;
      }
      const index = cell.y * next.terrain.widthCells + cell.x;
      if (index >= 0 && index < terrain.cells.length) {
        terrain.cells[index] = {
          material: cell.material as GroundMaterial,
          shape: cell.shape
        };
      }
    }
  }
  if (event.type === "obstacle_changed" && next.obstacles) {
    const obstacles = next.obstacles as unknown as {
      cells: Array<{ material: ObstacleMaterial; shape: MapCellShape } | null>;
    };
    for (const cell of cells) {
      const index = cell.y * next.obstacles.widthCells + cell.x;
      if (index < 0 || index >= obstacles.cells.length) {
        continue;
      }
      obstacles.cells[index] =
        cell.material === null
          ? null
          : {
              material: cell.material as ObstacleMaterial,
              shape: cell.shape
            };
    }
  }
  return next;
}

function isMapChangeEvent(type: string): boolean {
  return type === "terrain_changed" || type === "obstacle_changed";
}

interface MapPatchCell {
  readonly x: number;
  readonly y: number;
  readonly material: string | null;
  readonly shape: MapCellShape;
}

function mapPatchCells(value: unknown): MapPatchCell[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): MapPatchCell[] => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.x !== "number" ||
      typeof record.y !== "number" ||
      !Number.isInteger(record.x) ||
      !Number.isInteger(record.y)
    ) {
      return [];
    }
    const shape = typeof record.shape === "number" && isMapCellShape(record.shape)
      ? record.shape
      : 0;
    if (record.material === null) {
      return [{ x: record.x, y: record.y, material: null, shape }];
    }
    if (typeof record.material === "string") {
      return [{ x: record.x, y: record.y, material: record.material, shape }];
    }
    return [];
  });
}

function isMapCellShape(value: number): value is MapCellShape {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

function drainAuthoritativePlaybackQueue(): void {
  if (authoritativePlayback) {
    return;
  }
  const nextShot = pendingResolvedShots.shift();
  if (nextShot) {
    startAuthoritativePlayback(nextShot);
    return;
  }
  const roomState = pendingRoomState;
  pendingRoomState = undefined;
  if (roomState) {
    applyRoomState(roomState);
  }
}

function isAuthoritativePlaybackBusy(): boolean {
  return (
    authoritativePlayback !== undefined ||
    pendingResolvedShots.length > 0 ||
    awaitingShotId !== undefined
  );
}

function buildPlaybackKeyframes(payload: ShotResolvedPayload): PlaybackKeyframe[] {
  const initialState = payload.initialState ?? gameState;
  const fullFrames = (payload.frames ?? []).map((frame) => ({
    step: frame.step,
    state: cloneGameState(frame.state)
  }));
  const rawFrames: PlaybackKeyframe[] = [
    { step: 0, state: cloneGameState(initialState) },
    ...fullFrames,
    ...eventSnapshotFrames(payload, initialState, fullFrames)
  ];
  const finalStep = playbackFinalStep(payload, rawFrames);
  rawFrames.push({ step: finalStep, state: cloneGameState(payload.finalState) });

  const byStep = new Map<number, PlaybackKeyframe>();
  for (const frame of rawFrames.sort((a, b) => a.step - b.step)) {
    byStep.set(frame.step, frame);
  }

  return [...byStep.values()].sort((a, b) => a.step - b.step);
}

function eventSnapshotFrames(
  payload: ShotResolvedPayload,
  initialState: GameState,
  fullFrames: readonly PlaybackKeyframe[]
): PlaybackKeyframe[] {
  const frames: PlaybackKeyframe[] = [];
  const frameByStep = new Map<number, GameState>();

  for (const event of payload.events) {
    if (!event.bodySnapshots?.length) {
      continue;
    }
    const stateAtStep =
      frameByStep.get(event.step) ??
      cloneGameState(closestFullFrameState(event.step, initialState, fullFrames));
    for (const snapshot of event.bodySnapshots) {
      const body = stateAtStep.bodies.find((candidate) => candidate.id === snapshot.id);
      if (!body) {
        continue;
      }
      body.position = { ...snapshot.position };
      body.velocity = { ...snapshot.velocity };
      body.spin = snapshot.spin;
      body.alive = snapshot.alive;
      body.sleep = snapshot.sleep;
    }
    frameByStep.set(event.step, stateAtStep);
  }

  for (const [step, state] of frameByStep) {
    frames.push({ step, state });
  }
  return frames;
}

function closestFullFrameState(
  step: number,
  initialState: GameState,
  fullFrames: readonly PlaybackKeyframe[]
): GameState {
  let best: GameState = initialState;
  for (const frame of fullFrames) {
    if (frame.step > step) {
      break;
    }
    best = frame.state;
  }
  return best;
}

function playbackFinalStep(
  payload: ShotResolvedPayload,
  frames: readonly PlaybackKeyframe[]
): number {
  const frameStep = Math.max(0, ...frames.map((frame) => frame.step));
  const eventStep = Math.max(0, ...payload.events.map((event) => event.step));
  return Math.max(1, frameStep, eventStep);
}

function interpolateGameState(from: GameState, to: GameState, t: number): GameState {
  const state = cloneGameState(to);
  state.bodies = to.bodies.map((toBody) => {
    const fromBody = from.bodies.find((candidate) => candidate.id === toBody.id);
    if (!fromBody) {
      return cloneBody(toBody);
    }
    const body = cloneBody(toBody);
    body.position = {
      x: lerp(fromBody.position.x, toBody.position.x, t),
      y: lerp(fromBody.position.y, toBody.position.y, t)
    };
    body.velocity = {
      x: lerp(fromBody.velocity.x, toBody.velocity.x, t),
      y: lerp(fromBody.velocity.y, toBody.velocity.y, t)
    };
    body.spin = lerp(fromBody.spin, toBody.spin, t);
    body.alive = t < 1 ? fromBody.alive : toBody.alive;
    body.sleep = t < 1 ? fromBody.sleep : toBody.sleep;
    return body;
  });
  return state;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function cloneMapData(mapData: MapData): MapData {
  return JSON.parse(JSON.stringify(mapData)) as MapData;
}

function cloneBody(body: BodyState): BodyState {
  return JSON.parse(JSON.stringify(body)) as BodyState;
}

function createShotId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function eventButton(target: EventTarget | null): HTMLElement | undefined {
  if (target instanceof HTMLElement) {
    return target;
  }
  if (target instanceof Node && target.parentElement) {
    return target.parentElement;
  }
  return undefined;
}

function playerLabel(playerId: string): string {
  const player = players.find((candidate) => candidate.playerId === playerId);
  return player ? player.name || `P${player.joinIndex}` : "-";
}

function renderRoomPanel(): void {
  const inRoom = roomId !== null;
  const isOwner = localPlayerId !== undefined && localPlayerId === ownerPlayerId;
  const activeMemberCount = players.filter((player) => player.connected || player.kind === "bot").length;
  const canStart =
    inRoom &&
    isOwner &&
    roomPhase === "lobby" &&
    activeMemberCount >= 2;
  const canEditLobby = inRoom && isOwner && roomPhase === "lobby";

  roomCreateButton.textContent = inRoom ? "Current Room" : "Create Room";
  roomJoinButton.textContent = inRoom ? "Return to Room" : "Join Room";
  roomCreateButton.disabled = !socket.connected && !inRoom;
  roomJoinButton.disabled = !socket.connected && !inRoom;
  roomCodeInput.disabled = inRoom;
  playerNameInput.disabled = inRoom;
  roomStartButton.disabled = !canStart;
  resetButton.disabled = !socket.connected || !inRoom || !isOwner;
  roomImportButton.disabled = !socket.connected || !canEditLobby;
  roomOfficialMapSelect.disabled = !socket.connected || !canEditLobby;
  roomUseMapButton.disabled =
    !socket.connected || !canEditLobby || !isOfficialMapOption(selectedOfficialMapId);
  roomAddBotButton.disabled = !socket.connected || !canEditLobby || players.length >= 6;
  roomShrinkEnabledInput.disabled = !socket.connected || !canEditLobby;
  roomShrinkRoundsInput.disabled = !socket.connected || !canEditLobby;
  roomShrinkApplyButton.disabled = !socket.connected || !canEditLobby;
  roomLeaveButton.disabled = !inRoom;

  if (!shrinkCircleControlsDirty && document.activeElement !== roomShrinkEnabledInput) {
    roomShrinkEnabledInput.checked = shrinkCircle.enabled;
  }
  if (!shrinkCircleControlsDirty && document.activeElement !== roomShrinkRoundsInput) {
    roomShrinkRoundsInput.value = String(shrinkCircle.collapseRounds);
  }
  menuStatus.textContent = roomStatusText();
  roomSummary.textContent = roomSummaryText();
  roomStatus.textContent = roomStatusText();
  syncOfficialMapSelect();
  roomUseMapButton.disabled =
    !socket.connected || !canEditLobby || !isOfficialMapOption(selectedOfficialMapId);
  roomMembers.replaceChildren(...players.map((player) => renderRoomMember(player, isOwner)));
  renderCollapsiblePanels();
}

function renderRoomMember(player: RoomMember, localIsOwner: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = "room-member";

  const color = document.createElement("span");
  color.className = "room-member-color";
  color.style.setProperty("--member-color", player.color);

  const name = document.createElement("span");
  name.className = "room-member-name";
  const badges = [
    player.kind === "bot" ? "Bot" : "",
    player.isOwner ? "Host" : "",
    player.playerId === localPlayerId ? "You" : "",
    player.connected || player.kind === "bot" ? "" : "Offline",
    player.eliminated ? "Out" : ""
  ].filter(Boolean);
  name.textContent = `${player.name}${badges.length ? ` (${badges.join(", ")})` : ""}`;

  const meta = document.createElement("span");
  meta.className = "room-member-meta";
  if (
    localIsOwner &&
    roomPhase === "lobby" &&
    player.playerId !== localPlayerId
  ) {
    const kick = document.createElement("button");
    kick.type = "button";
    kick.dataset.kickPlayer = player.playerId;
    kick.textContent = "Kick";
    meta.append(kick);
  } else {
    meta.textContent = roomPhase === "lobby" ? `P${player.joinIndex}` : `${player.ballCount} balls`;
  }

  row.append(color, name, meta);
  return row;
}

function roomStatusText(): string {
  if (!socket.connected) {
    return "Disconnected from server.";
  }
  if (!roomId) {
    return roomMessage;
  }
  if (roomPhase === "lobby") {
    const readyCount = players.filter((player) => player.connected || player.kind === "bot").length;
    return `Room ${roomId} | Lobby | ${readyCount}/6 players | ${roomMessage}`;
  }
  if (roomPhase === "finished") {
    return `Room ${roomId} | Winner: ${winnerPlayerId ? playerLabel(winnerPlayerId) : "-"}`;
  }
  return `Room ${roomId} | Playing | ${roomMessage}`;
}

function roomSummaryText(): string {
  if (!roomId) {
    return "Not joined";
  }
  const activePlayer = gameState.currentPlayerId ? playerLabel(gameState.currentPlayerId) : "-";
  if (roomPhase === "lobby") {
    return `${roomId} | Lobby | ${players.length}/6`;
  }
  if (roomPhase === "finished") {
    return `${roomId} | Winner ${winnerPlayerId ? playerLabel(winnerPlayerId) : "-"}`;
  }
  return `${roomId} | ${activePlayer}`;
}

function syncOfficialMapSelect(): void {
  const currentIsOfficial = isOfficialMapOption(currentMapData.id);
  setCustomMapOptionVisible(!currentIsOfficial);
  if (!optionExists(selectedOfficialMapId)) {
    selectedOfficialMapId = currentIsOfficial
      ? currentMapData.id
      : OFFICIAL_MAP_SUMMARIES[0]?.id ?? "";
  }
  roomOfficialMapSelect.value = selectedOfficialMapId;
  const selectedSummary =
    OFFICIAL_MAP_SUMMARIES.find((summary) => summary.id === selectedOfficialMapId);
  if (selectedSummary) {
    roomMapDescription.textContent =
      selectedSummary.id === currentMapData.id
        ? selectedSummary.description
        : `Ready to switch to ${selectedSummary.name}.`;
    return;
  }
  roomMapDescription.textContent = `Current custom map: ${currentMapData.id}`;
}

function isOfficialMapOption(mapId: string): boolean {
  return OFFICIAL_MAP_SUMMARIES.some((summary) => summary.id === mapId);
}

function optionExists(value: string): boolean {
  return [...roomOfficialMapSelect.options].some((option) => option.value === value);
}

function setCustomMapOptionVisible(visible: boolean): void {
  const existing = roomOfficialMapSelect.querySelector<HTMLOptionElement>(
    "option[data-custom-map]"
  );
  if (!visible) {
    existing?.remove();
    return;
  }
  if (existing) {
    existing.value = currentMapData.id;
    existing.textContent = `Custom: ${currentMapData.id}`;
    return;
  }
  const option = document.createElement("option");
  option.dataset.customMap = "true";
  option.value = currentMapData.id;
  option.textContent = `Custom: ${currentMapData.id}`;
  roomOfficialMapSelect.prepend(option);
}

function renderCollapsiblePanels(): void {
  hud.classList.toggle("is-collapsed", hudCollapsed);
  bonusPanel.classList.toggle("is-collapsed", bonusCollapsed);
  roomPanel.classList.toggle("is-collapsed", roomCollapsed);
}

async function importRoomMap(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = "";
  if (!file) {
    return;
  }
  if (!roomId) {
    roomMessage = "Join a room before importing a map.";
    renderRoomPanel();
    return;
  }

  try {
    const encodedMap = await file.text();
    roomMessage = "Importing map...";
    socket.emit("room:import_map", { encodedMap });
  } catch {
    roomMessage = "Could not read map file.";
  }
  renderRoomPanel();
}

function handleRoomError(payload: RoomErrorPayload): void {
  roomMessage = payload.message ?? payload.reason;
  bonusResolving = false;
  if (isBonusResolveError(payload.reason)) {
    bonusMessage = payload.message ?? payload.reason;
  }
  invalidateBonusPanel();
  if (payload.reason === "kicked") {
    const kickedRoomId = roomId ?? payload.roomId ?? null;
    clearRejoinToken();
    clearRoomState();
    ignoredRoomId = kickedRoomId;
    setAppMode("menu");
  }
  renderRoomPanel();
  renderBonusPanel();
}

function isBonusResolveError(reason: string): boolean {
  return reason === "state_hash_mismatch" ||
    reason === "not_bonus_player" ||
    reason === "invalid_bonus_option" ||
    reason === "wrong_action_mode" ||
    reason === "invalid_teleport_target" ||
    reason === "invalid_anchor_target" ||
    reason === "action_requires_target";
}

function clearRoomState(): void {
  awaitingShotId = undefined;
  authoritativePlayback = undefined;
  pendingRoomState = undefined;
  pendingResolvedShots.length = 0;
  roomId = null;
  roomPhase = "lobby";
  ownerPlayerId = undefined;
  winnerPlayerId = undefined;
  localPlayerId = undefined;
  players = [];
  setShrinkCircle(defaultShrinkCircleState, false);
  shrinkCircleControlsDirty = false;
  roomMessage = "Create or join a room.";
  currentMapData = billiardsMapData;
  selectedOfficialMapId = billiardsMapData.id;
  const nextState = createBilliardsGameState();
  nextState.phase = "lobby";
  nextState.currentPlayerId = "";
  resetLocalState(nextState, hashGameState(nextState, true));
  renderRoomPanel();
}

function localMember(): RoomMember | undefined {
  return players.find((player) => player.playerId === localPlayerId);
}

function phaseFromGameState(state: typeof gameState): RoomPhase {
  if (state.phase === "lobby") {
    return "lobby";
  }
  if (state.phase === "finished") {
    return "finished";
  }
  return "playing";
}

function winnerPlayerIdFromState(state: typeof gameState): string | undefined {
  if (!state.winnerTeamId) {
    return undefined;
  }
  return state.players.find((player) => player.teamId === state.winnerTeamId)?.id;
}

function syncMemberSnapshots(
  currentMembers: readonly RoomMember[],
  state: typeof gameState
): readonly RoomMember[] {
  const counts = new Map(currentMembers.map((player) => [player.playerId, 0]));
  for (const body of state.bodies) {
    if (body.alive && body.ownerPlayerId && counts.has(body.ownerPlayerId)) {
      counts.set(body.ownerPlayerId, (counts.get(body.ownerPlayerId) ?? 0) + 1);
    }
  }

  return currentMembers.map((member) => {
    const playerState = state.players.find((player) => player.id === member.playerId);
    return {
      ...member,
      connected: playerState?.connected ?? member.connected,
      eliminated: playerState?.eliminated ?? member.eliminated,
      ballCount: counts.get(member.playerId) ?? member.ballCount
    };
  });
}

function normalizeRoomCode(value: string): string | undefined {
  const code = value.trim().toUpperCase();
  return /^\d{4}$/.test(code) ? code : undefined;
}

function rejoinTokenForRoom(code: string): string | undefined {
  const saved = readRejoinToken();
  return saved?.roomId === code ? saved.token : undefined;
}

function saveRejoinToken(code: string, token: string): void {
  sessionStorage.setItem(rejoinSessionKey, JSON.stringify({ roomId: code, token }));
}

function clearRejoinToken(): void {
  sessionStorage.removeItem(rejoinSessionKey);
}

function readRejoinToken(): { readonly roomId: string; readonly token: string } | undefined {
  try {
    const raw = sessionStorage.getItem(rejoinSessionKey);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.roomId !== "string" || typeof record.token !== "string") {
      return undefined;
    }
    if (!/^\d{4}$/.test(record.roomId)) {
      return undefined;
    }
    return { roomId: record.roomId, token: record.token };
  } catch {
    return undefined;
  }
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

function vec2FromUnknown(value: unknown): Vec2 | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    "y" in value
  ) {
    const x = (value as { x?: unknown }).x;
    const y = (value as { y?: unknown }).y;
    if (typeof x === "number" && typeof y === "number") {
      return { x, y };
    }
  }
  return undefined;
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

function currentMapBounds(): { left: number; top: number; right: number; bottom: number } {
  if (currentMapData.tableBounds) {
    return currentMapData.tableBounds;
  }
  if (currentMapData.terrain) {
    return {
      left: currentMapData.terrain.origin.x,
      top: currentMapData.terrain.origin.y,
      right:
        currentMapData.terrain.origin.x +
        currentMapData.terrain.widthCells * currentMapData.terrain.cellSize,
      bottom:
        currentMapData.terrain.origin.y +
        currentMapData.terrain.heightCells * currentMapData.terrain.cellSize
    };
  }
  return { left: 0, top: 0, right: mapWidth(), bottom: mapHeight() };
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
