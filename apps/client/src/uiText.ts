import type { BonusKind, RoomErrorPayload } from "@disc-arena/core";
import type { ActionBonusKind } from "@disc-arena/core";

export const uiText = {
  app: {
    title: "Disc Arena 弹球竞技场",
    canvasLabel: "Disc Arena 弹球竞技场画布"
  },
  menu: {
    heading: "Disc Arena 弹球竞技场",
    playerNamePlaceholder: "玩家名称",
    playerNameAria: "玩家名称",
    roomCodePlaceholder: "房间号",
    roomCodeAria: "四位房间号",
    createRoom: "创建房间",
    currentRoom: "当前房间",
    joinRoom: "加入房间",
    returnToRoom: "回到房间",
    mapEditor: "地图编辑器"
  },
  play: {
    menu: "菜单",
    status: "状态",
    noRoom: "未加入",
    bonus: "道具",
    noChoices: "暂无选择",
    room: "房间",
    notJoined: "未加入",
    start: "开始",
    reset: "重置",
    importMap: "导入地图",
    addBot: "添加 AI",
    leave: "离开",
    map: "地图",
    useMap: "使用地图",
    shrink: "缩圈",
    apply: "应用"
  },
  room: {
    createOrJoin: "创建或加入房间。",
    createOrJoinHud: "创建或加入房间",
    creating: "正在创建房间...",
    enterCode: "请输入四位房间号。",
    joining: (code: string) => `正在加入 ${code}...`,
    selectingMap: "正在切换地图...",
    updating: "正在更新房间...",
    joined: (roomId: string) => `已加入房间 ${roomId}。`,
    importingMap: "正在导入地图...",
    importNeedRoom: "请先加入房间，再导入地图。",
    importReadFailed: "无法读取地图文件。",
    disconnected: "已与服务器断开连接。",
    lobbyStatus: (roomId: string, readyCount: number, message: string) =>
      `房间 ${roomId} | 大厅 | ${readyCount}/6 名玩家 | ${message}`,
    finishedStatus: (roomId: string, winner: string) => `房间 ${roomId} | 胜者：${winner}`,
    playingStatus: (roomId: string, message: string) => `房间 ${roomId} | 对局中 | ${message}`,
    lobbySummary: (roomId: string, count: number) => `${roomId} | 大厅 | ${count}/6`,
    winnerSummary: (roomId: string, winner: string) => `${roomId} | 胜者 ${winner}`,
    activeSummary: (roomId: string, activePlayer: string) => `${roomId} | ${activePlayer}`,
    readyToSwitchMap: (name: string) => `准备切换到「${name}」。`,
    currentCustomMap: (id: string) => `当前自定义地图：${id}`,
    customMapOption: (id: string) => `自定义：${id}`,
    officialMaps: {
      billiards_table: {
        name: "经典台球桌",
        description: "带有球袋和紧凑开局阵型的经典球桌。"
      },
      airbag_square: {
        name: "气囊方阵",
        description: "四周由一次性气囊墙包围的方形竞技场。"
      },
      portal_cloud_square: {
        name: "云洞传送场",
        description: "对向传送门搭配场内易碎云洞。"
      },
      elastic_pinball: {
        name: "弹力弹珠台",
        description: "弹性障碍、粘性刹车、冰道和沙地陷阱混合地图。"
      }
    },
    playerSlot: (index: number) => `P${index}`,
    ballCount: (count: number) => `${count} 球`,
    kick: "移出",
    badges: {
      bot: "AI",
      host: "房主",
      you: "你",
      offline: "离线",
      out: "出局"
    }
  },
  hud: {
    roundAction: (state: string, round: number, action: number) =>
      `${state} | 回合 ${round} | 行动 ${action}`,
    body: (
      roomId: string,
      connection: string,
      me: string,
      active: string,
      balls: number,
      details: readonly string[]
    ) => `房间 ${roomId} | ${connection} | 你：${me} | 当前：${active} | 球数：${balls}${details.join("")}`,
    power: (power: number) => ` | 力量 ${power}`,
    mode: (mode: string) => ` | 模式 ${mode}`,
    shrink: (progress: number) => ` | 缩圈 ${progress}%`,
    connection: {
      connecting: "连接中",
      connected: "已连接",
      disconnected: "已断开"
    },
    state: {
      playback: "回放中",
      resolving: "结算中",
      winner: (winner: string) => `胜者 ${winner}`,
      yourTurn: "你的行动",
      waiting: "等待中",
      settled: "已静止",
      rolling: "运动中"
    }
  },
  bonus: {
    noChoices: "暂无选择",
    resolving: "处理中...",
    count: (count: number) => `${count} 个候选`,
    keepOrWait: "可保留或等待",
    keep: "保留",
    labels: {
      power_stack: "永久力量上限 +600",
      trajectory_preview: "下一击长轨迹预览",
      single_power_boost: "下一击力量上限 +1000",
      mass_up: "来源球质量提升",
      size_up: "来源球体积增大",
      size_down: "来源球体积缩小",
      extra_action_any: "额外行动",
      shuriken: "手里剑行动",
      bomb: "炸弹行动",
      summon_half_ball: "发射半尺寸新球",
      teleport: "传送行动",
      anchor: "固定一个小球",
      extra_action_on_elimination: "出界后追加行动"
    } satisfies Record<BonusKind, string>
  },
  targeting: {
    selectTeleportBall: "请选择一个己方小球进行传送。",
    illegalTeleport: "这个传送位置不合法。",
    teleporting: "正在传送...",
    selectAnchorBall: "请选择一个要固定的小球。",
    anchoring: "正在固定..."
  },
  editor: {
    tabs: {
      menu: "菜单",
      tools: "工具",
      materials: "材质",
      special: "特殊",
      balls: "球体",
      resize: "尺寸"
    },
    tools: {
      add: "添加",
      remove: "移除",
      shape: "形状",
      drag: "拖拽"
    },
    brushes: {
      rect: "矩形",
      circleCell: "格内圆",
      circleGrid: "网格圆"
    },
    materials: {
      ground: "地面",
      void: "空洞",
      grass: "草地",
      ice: "冰面",
      sand: "沙地",
      cloud: "云层",
      obstacle: "障碍",
      wood: "木墙",
      elastic_wall: "弹性墙",
      sticky_wall: "粘性墙",
      airbag: "气囊"
    },
    special: {
      portals: "传送门",
      portal1: "传送门 1",
      portal2: "传送门 2"
    },
    balls: {
      size: "球尺寸",
      aria: (size: string) => `${size} 小球`
    },
    resize: {
      length: "长度",
      width: "宽度",
      lengthAria: "地图长度",
      widthAria: "地图宽度",
      done: "完成"
    },
    actions: {
      saveDraft: "保存草稿",
      export: "导出",
      import: "导入"
    },
    status: {
      ready: "就绪",
      ballSize: (size: string) => `球尺寸：${size}`,
      portalToggled: (portalId: string, exists: boolean) =>
        `${portalName(portalId)} 已${exists ? "添加" : "移除"}`,
      resized: (width: number, height: number) => `地图尺寸已调整为 ${width}x${height}`,
      draftSaved: "草稿已保存",
      exported: "地图代码已导出",
      shapeCancelled: "形状绘制已取消",
      dragPortal: "拖拽移动传送门",
      resizePortal: "拖拽端点调整传送门",
      invalidPortalAngle: "传送门角度无效",
      portalEdited: (portalId: string) => `${portalName(portalId)} 已编辑`,
      mapSize: (name: string, width: number, height: number) => `${name} | ${width}x${height}`,
      selectSecondPoint: "请选择第二点，右键取消",
      removedBall: (id: string) => `已移除 ${id}`,
      ballOutside: "小球位置在地图外",
      invalidBall: "小球位置不合法",
      addedBall: (number: number | string) => `已添加 ${number} 号球`,
      imported: "地图代码已导入",
      importFailed: "导入失败"
    },
    prompt: {
      portalAngle: "请输入传送门角度。0 = 向右，90 = 向下。"
    }
  },
  errors: {
    room_in_progress: "房间已经在对局中。",
    room_full: "房间已满。",
    already_in_room: "你已经在这个房间中。",
    not_room_owner: "只有房主可以执行这个操作。",
    cannot_kick_self: "房主不能移出自己。",
    map_has_no_balls: "当前地图至少需要一个小球。",
    invalid_map: "无法读取这个地图。",
    not_enough_players: "至少需要两名玩家。",
    unknown_player: "未知玩家。",
    state_hash_mismatch: "本地状态已过期，请等待同步。",
    not_bonus_player: "现在不能由该玩家选择增益。",
    invalid_bonus_option: "无效的增益选项。",
    actor_not_owned: "只能传送自己的小球。",
    invalid_teleport_target: "这个传送位置不合法。",
    invalid_anchor_target: "固定效果需要一个存活的小球。",
    room_not_waiting_for_shot: "当前不能行动。",
    not_current_player: "还没轮到你。",
    bodies_still_moving: "请等待所有小球停下。",
    player_not_active: "该玩家当前不能行动。",
    wrong_action_mode: "当前没有激活这个道具行动。",
    action_requires_target: "这个道具需要先选择目标。",
    kicked: "你已被移出房间。"
  } satisfies Record<string, string>
} as const;

export function actionBonusLabel(kind: ActionBonusKind): string {
  return uiText.bonus.labels[kind];
}

export function roomErrorText(payload: RoomErrorPayload): string {
  const errors = uiText.errors as Readonly<Record<string, string>>;
  return errors[payload.reason] ?? payload.message ?? payload.reason;
}

export function officialMapText(summary: { readonly id: string; readonly name: string; readonly description: string }) {
  return uiText.room.officialMaps[summary.id as keyof typeof uiText.room.officialMaps] ?? {
    name: summary.name,
    description: summary.description
  };
}

function portalName(portalId: string): string {
  if (portalId === "portal1") {
    return uiText.editor.special.portal1;
  }
  if (portalId === "portal2") {
    return uiText.editor.special.portal2;
  }
  return portalId;
}
