import {
  add,
  allBodiesSleeping,
  applyShotIntentToState,
  createOutOfBoundsTracker,
  createTestMapGameState,
  distance,
  hashGameState,
  length,
  PHYSICS_POWER_SCALE,
  scale,
  stepWorld,
  sub,
  TEST_MAP_HEIGHT,
  TEST_MAP_PHYSICS_SCALE,
  TEST_MAP_WIDTH,
  testMapData,
  updateOutOfBoundsBodies
} from "@disc-arena/core";
import type {
  BodyState,
  ClientToServerEvents,
  RoomPlayer,
  RoomStatePayload,
  ServerToClientEvents,
  ShotIntent,
  ShotResolvedPayload,
  SimulationOptions,
  Vec2
} from "@disc-arena/core";
import { io, type Socket } from "socket.io-client";
import { createMapEditor } from "./mapEditor";
import "./styles.css";

const canvas = requiredElement<HTMLCanvasElement>("#game");
const hud = requiredElement<HTMLDivElement>("#hud");
const resetButton = requiredElement<HTMLButtonElement>("#reset");
const playModeButton = requiredElement<HTMLButtonElement>("#mode-play");
const editorModeButton = requiredElement<HTMLButtonElement>("#mode-editor");
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

const maxDragDistance = 180 * TEST_MAP_PHYSICS_SCALE;
const maxShotPower = 520 * PHYSICS_POWER_SCALE;
const cancelAimColor = "rgba(255,255,255,0.32)";
const bodyNumberFontSize = 16;
const socketUrl = import.meta.env.VITE_SOCKET_URL ?? "http://127.0.0.1:3000";
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketUrl);
type AppMode = "play" | "editor";
let appMode: AppMode = "play";
let gameState = createTestMapGameState();
let stateHash = hashGameState(gameState, true);
let localPlayerId: string | undefined;
let players: readonly RoomPlayer[] = [];
let selectedBodyId: string | undefined;
let pointerStart: Vec2 | undefined;
let pointerCurrent: Vec2 | undefined;
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
    resetLocalState(createTestMapGameState(), hashGameState(createTestMapGameState(), true));
  }
});

playModeButton.addEventListener("click", () => setAppMode("play"));
editorModeButton.addEventListener("click", () => setAppMode("editor"));

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
setAppMode("play");
requestAnimationFrame(tick);

function tick(now: number): void {
  const frameDt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += frameDt;

  if (appMode === "play") {
    while (accumulator >= simulationOptions.fixedDt) {
      stepWorld(gameState, testMapData, simulationOptions, 0);
      updateOutOfBoundsBodies(
        gameState.bodies,
        testMapData,
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
  } else {
    accumulator = 0;
    editor.render();
  }
  requestAnimationFrame(tick);
}

function handlePointerDown(event: PointerEvent): void {
  if (appMode === "editor") {
    editor.handlePointerDown(event, pointerPosition(event));
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  if (!canShoot()) {
    return;
  }

  const worldPoint = screenToWorld(pointerPosition(event));
  const body = pickBody(worldPoint, gameState.bodies);
  if (!body || !body.alive) {
    return;
  }

  selectedBodyId = body.id;
  pointerStart = worldPoint;
  pointerCurrent = worldPoint;
  canvas.setPointerCapture(event.pointerId);
}

function handlePointerMove(event: PointerEvent): void {
  if (appMode === "editor") {
    editor.handlePointerMove(event, pointerPosition(event));
    return;
  }

  if (!selectedBodyId || !pointerStart) {
    return;
  }
  pointerCurrent = screenToWorld(pointerPosition(event));
}

function handlePointerUp(event: PointerEvent): void {
  if (appMode === "editor") {
    editor.handlePointerUp(event);
    releasePointer(event);
    return;
  }

  if (!selectedBodyId || !pointerStart || !pointerCurrent) {
    clearPointer();
    return;
  }

  const selectedBody = gameState.bodies.find((body) => body.id === selectedBodyId);
  if (!selectedBody || isPointerInShotDeadZone(selectedBody, pointerCurrent)) {
    releasePointer(event);
    clearPointer();
    return;
  }

  const drag = clampDrag(sub(pointerCurrent, pointerStart));
  const power = (length(drag) / maxDragDistance) * maxShotPower;
  if (power > 0) {
    const direction = scale(drag, -1);
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
  selectedBodyId = undefined;
  pointerStart = undefined;
  pointerCurrent = undefined;
}

function handleWheel(event: WheelEvent): void {
  if (appMode !== "editor") {
    return;
  }

  editor.handleWheel(event, pointerPosition(event));
}

function setAppMode(nextMode: AppMode): void {
  appMode = nextMode;
  selectedBodyId = undefined;
  pointerStart = undefined;
  pointerCurrent = undefined;
  editor.handlePointerCancel();
  editorPanel.hidden = nextMode !== "editor";
  hud.hidden = nextMode !== "play";
  resetButton.hidden = nextMode !== "play";
  playModeButton.classList.toggle("is-active", nextMode === "play");
  editorModeButton.classList.toggle("is-active", nextMode === "editor");
}

function render(now: number): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawTable();
  drawWalls();
  drawAim(now);
  drawBodies();
  updateHud();
}

function drawTable(): void {
  context.save();
  context.fillStyle = "#23754c";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#1b5f3e";
  context.fillRect(
    viewport.x,
    viewport.y,
    TEST_MAP_WIDTH * viewport.scale,
    TEST_MAP_HEIGHT * viewport.scale
  );

  context.strokeStyle = "rgba(255,255,255,0.18)";
  context.lineWidth = 2;
  context.strokeRect(
    viewport.x,
    viewport.y,
    TEST_MAP_WIDTH * viewport.scale,
    TEST_MAP_HEIGHT * viewport.scale
  );
  context.restore();
}

function drawWalls(): void {
  context.save();
  context.lineCap = "round";
  context.strokeStyle = "#111";
  context.lineWidth = 10 * TEST_MAP_PHYSICS_SCALE * viewport.scale;

  for (const collider of testMapData.colliders) {
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

function drawAim(now: number): void {
  const body = selectedBodyId
    ? gameState.bodies.find((candidate) => candidate.id === selectedBodyId)
    : undefined;
  if (!body || !pointerStart || !pointerCurrent) {
    return;
  }

  const drag = clampDrag(sub(pointerCurrent, pointerStart));
  const aimStrength = Math.min(1, length(drag) / maxDragDistance);
  const dragEnd = add(pointerStart, drag);
  const launchEnd = add(body.position, scale(drag, -1));
  const start = worldToScreen(body.position);
  const pull = worldToScreen(dragEnd);
  const launch = worldToScreen(launchEnd);
  const inDeadZone = isPointerInShotDeadZone(body, pointerCurrent);

  context.save();
  context.lineCap = "round";
  context.lineWidth = 3;
  context.strokeStyle = inDeadZone ? cancelAimColor : "#fff";
  context.beginPath();
  context.arc(start.x, start.y, body.radius * viewport.scale, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = "#fff";
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(pull.x, pull.y);
  context.stroke();

  context.beginPath();
  context.arc(pull.x, pull.y, Math.max(4, 5 * viewport.scale), 0, Math.PI * 2);
  context.fillStyle = "#fff";
  context.fill();

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

function drawBodies(): void {
  const bodies = gameState.bodies
    .filter((body) => body.alive)
    .sort((a, b) => a.radius - b.radius);
  for (const body of bodies) {
    drawBody(body);
  }
}

function drawBody(body: BodyState): void {
  const center = worldToScreen(body.position);
  const radius = body.radius * viewport.scale;
  const number = bodyNumber(body);
  const numberText = String(number);
  const innerRadius = innerCircleRadius(numberText);
  const selected = body.id === selectedBodyId;

  context.save();
  if (selected) {
    context.beginPath();
    context.arc(center.x, center.y, radius + Math.max(4, radius * 0.22), 0, Math.PI * 2);
    context.strokeStyle = "#fff";
    context.lineWidth = Math.max(3, radius * 0.14);
    context.stroke();
  }

  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.fillStyle = "#050505";
  context.fill();

  context.beginPath();
  context.arc(center.x, center.y, innerRadius, 0, Math.PI * 2);
  context.fillStyle = "#f8f8f3";
  context.fill();

  context.fillStyle = "#101010";
  context.font = numberFont();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(numberText, center.x, center.y + bodyNumberFontSize * 0.04);
  context.restore();
}

function isPointerInShotDeadZone(body: BodyState, point: Vec2): boolean {
  return distance(point, body.position) <= body.radius;
}

function innerCircleRadius(numberText: string): number {
  context.save();
  context.font = numberFont();
  const textWidth = context.measureText(numberText).width;
  context.restore();
  return Math.max(bodyNumberFontSize * 0.58, textWidth * 0.5 + 3);
}

function numberFont(): string {
  return `${bodyNumberFontSize}px ui-sans-serif, system-ui, sans-serif`;
}

function pickBody(point: Vec2, bodies: readonly BodyState[]): BodyState | undefined {
  return bodies
    .filter((body) => body.alive && body.sleep && distance(point, body.position) <= body.radius)
    .sort((a, b) => distance(point, a.position) - distance(point, b.position))[0];
}

function resetLocalState(nextState: typeof gameState, nextStateHash: string): void {
  gameState = nextState;
  stateHash = nextStateHash;
  outOfBoundsTracker = createOutOfBoundsTracker();
  selectedBodyId = undefined;
  pointerStart = undefined;
  pointerCurrent = undefined;
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

function pointerPosition(event: MouseEvent): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
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
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scale = Math.min(
    (width - padding * 2) / TEST_MAP_WIDTH,
    (height - padding * 2) / TEST_MAP_HEIGHT
  );

  return {
    x: (width - TEST_MAP_WIDTH * scale) / 2,
    y: (height - TEST_MAP_HEIGHT * scale) / 2,
    scale
  };
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
