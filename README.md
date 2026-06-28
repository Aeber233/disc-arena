# Disc Arena

Disc Arena 是一个基于 Web 的回合制 2D 圆盘物理竞技原型。当前版本已经包含可运行的桌球式试玩地图、Canvas 前端、本地地图编辑器、Socket.IO 测试房间，以及可复用的纯 TypeScript 核心逻辑包。

项目仍处于原型阶段。它已经能验证核心物理、地图编辑、多人回合同步和传送门交互，但还没有完整账号系统、正式匹配、持久化存档、完整道具规则或生产级部署脚本。

## 当前功能

### Play 模式

- 主菜单提供 `Play` 和 `Edit` 两个入口。
- Play 模式加载默认 `Billiards Table` 地图，使用一颗白球和一组三角排列的目标球。
- Canvas 渲染桌面、木质边框、洞口、球体编号、运动拖尾、瞄准线和传送门影子代理。
- 玩家通过拖拽球体蓄力并松开发射；拖拽距离会映射为 `ShotIntent.power`。
- 支持滚轮缩放视图，中键或右键拖动画面。
- HUD 显示连接状态、本地玩家编号、当前行动玩家、回合数、运动状态和剩余球数。
- 客户端会先做本地预测播放，服务端结算完成后再用权威结果校正状态。
- 离线或服务端不可用时，Reset 仍可重置本地测试状态；联网状态下 Reset 会广播房间重置。

### 地图编辑器

- Edit 模式提供可视化网格地图编辑。
- 支持最大 `128x128` 单元格的地图尺寸调整。
- 地面材料支持 `void`、`grass`、`ice`、`sand`，并在物理中映射到不同阻尼倍率。
- 障碍层当前支持 `wood`，会在核心层转换为静态墙碰撞线段。
- 单元格形状支持整格和四种斜三角形，用于绘制斜边地形或障碍。
- 笔刷支持 `1x1`、`2x2`、`4x4`、矩形区域和圆形区域。
- 工具支持添加、删除、切换形状和拖动画布。
- 支持两组可编辑传送门；可拖动端点移动、拖动端帽调整长度、长按后旋转方向。
- 支持保存草稿到浏览器 `localStorage`。
- 支持导出 `.damap` 文本编码，以及导入相同编码的地图文件。
- 地图编码当前为 `DAEM2`，并保留对旧 `DAEM1` 编码的解析兼容。

### 多人测试房间

- `apps/server` 提供一个 Socket.IO 公共测试房间。
- 连接后按加入顺序分配 `player-1`、`player-2` 等玩家编号。
- 房间广播 `room:joined`、`room:state`、`shot:started`、`shot:resolved` 和 `shot:rejected`。
- 服务端校验提交的回合号、状态哈希、当前行动玩家、房间阶段和物体静止状态。
- 每次合法击球由服务端权威模拟，随后推进回合并切换到下一个在线玩家。
- 玩家断开连接时，房间会保留玩家记录但标记为离线；若当前行动玩家离线，会推进到下一个在线玩家。

### 核心物理和规则

- `packages/core` 是无 DOM、无网络依赖的纯 TypeScript 逻辑库，供服务端、客户端回放和 bot 评估复用。
- 游戏状态通过 `GameState`、`BodyState`、`MapData`、`ShotIntent` 和 `SimulationResult` 等结构表达。
- 物理单位采用 `PHYSICS_UNIT_SCALE` 放大比例，前端像素半径通过固定 tier 映射到世界半径。
- 固定步长仿真管线包括效果钩子、旋转曲线、速度积分、位置积分、碰撞代理、碰撞求解、触发器、阻尼、休眠和传送门提交。
- 圆形物体碰撞使用一维法线分解的弹性碰撞模型。
- 静态墙碰撞支持线段最近点检测、穿透修正和 restitution 反弹。
- 地形会影响阻尼：冰面更滑，沙地更慢，虚空不可通行。
- 洞口触发器会淘汰球体；力场和拾取触发器已有事件路径。
- 出界规则通过采样球体面积判断是否大比例离开可玩区域，并在持续一段时间后淘汰。
- 状态哈希使用稳定 stringify 和 FNV-1a，支持量化后比较，便于客户端和服务端核对。

### 传送门系统

- 地图支持 `PortalPair`，每对包含 A/B 两个入口。
- 核心提供传送门坐标变换、速度变换、端点计算和孔径检测。
- 仿真中会为穿过传送门边界的球生成 `portal_shadow` 代理，允许跨门碰撞反馈。
- 主代理和影子代理都有 clip mask，避免不可见半边产生错误碰撞。
- 球心穿越传送门平面后会提交传送，位置和速度按入口/出口方向转换。
- 传送后有短暂 cooldown，避免刚出门的球立刻反向重复触发。

### Bot 与评估

- core 中包含第一版 bot 搜索逻辑。
- `generateCandidates` 会围绕敌方目标角度和伪随机角度生成候选击球。
- `chooseBotShot` 使用 `fast_eval` 仿真配置在时间预算内选择最佳候选。
- `scoreShot` 根据淘汰自己、淘汰队友、淘汰敌方和危险区位置进行启发式评分。

## 代码架构

```text
apps/
  client/
    index.html          # Canvas、菜单、Play HUD、编辑器面板
    src/main.ts         # 前端入口、渲染、输入、Socket.IO 同步和本地预测
    src/mapEditor.ts    # 地图编辑器交互、绘制、导入导出和草稿保存
    src/colors.ts       # 材质边缘色辅助函数
    src/styles.css      # 页面、菜单、HUD 和编辑器样式
  server/
    src/server.ts       # HTTP + Socket.IO 服务器入口
    src/room.ts         # 公共测试房间、玩家状态、击球校验和权威结算
packages/
  core/
    src/types/          # 游戏、地图、物体、网络、传送门和仿真契约
    src/math/           # Vec2 数学工具
    src/map/            # 默认地图、桌球地图、可编辑地图和像素半径 tier
    src/physics/        # 固定步长物理管线、碰撞、阻尼、休眠、传送门代理
    src/rules/          # 出界等规则模块
    src/simulation/     # 击球应用、整回合模拟和状态哈希
    src/effects/        # 效果钩子派发
    src/bot/            # 候选生成、快速评估和启发式评分
config/
  network.local.env
  network.production.env.example
```

### 数据流

1. 客户端连接服务端并加入公共测试房间。
2. 服务端返回 `RoomStatePayload`，包含玩家列表、地图、游戏状态和状态哈希。
3. 当前玩家在 Canvas 中拖拽球体，客户端生成 `ShotSubmitPayload`。
4. 客户端立即应用本地预测，让画面先滚动起来。
5. 服务端校验状态哈希和回合权限，通过 `simulateShot` 做权威结算。
6. 服务端广播 `ShotResolvedPayload`，客户端在本地物体静止后切换到权威最终状态。

### 仿真管线

`simulateShot` 负责一整次击球结算：

```text
onBeforeShot effect hooks
applyShotIntentToState
onAfterShotApplied effect hooks
repeat stepWorld until all bodies sleep or maxSteps is reached
updateOutOfBoundsBodies
onSimulationEnd effect hooks
hashGameState
```

`stepWorld` 负责单帧固定步长：

```text
continuous effects
spin curve
velocity integration
position integration
build body proxies
solve body and wall collisions
map proxy impulses back to bodies
resolve triggers
terrain-aware damping
sleep state update
commit portal transitions
```

## 开发命令

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

类型检查：

```bash
npm run typecheck
```

构建所有 workspace：

```bash
npm run build
```

本地开发通常需要两个终端：

```bash
npm run server:dev
npm run client:dev
```

默认服务地址：

- Server: `http://127.0.0.1:3000`
- Client: `http://127.0.0.1:5173`

## 网络配置

本地默认配置在 `config/network.local.env`：

```env
PORT=3000
CLIENT_ORIGIN=http://127.0.0.1:5173
VITE_SOCKET_URL=http://127.0.0.1:3000
```

生产占位配置在 `config/network.production.env.example`。部署时需要根据实际域名填写：

- 服务端读取 `PORT` 和 `CLIENT_ORIGIN`。
- 客户端读取 `VITE_SOCKET_URL`。

## 测试覆盖

当前测试集中在共享核心和房间逻辑：

- 向量数学和状态哈希基础。
- 击球仿真、阻尼休眠和出界淘汰。
- 圆形碰撞、墙碰撞和传送门代理。
- 传送门坐标变换、穿越提交和 stepWorld 集成。
- 可编辑地图编码、解码、校验、笔刷、尺寸调整和地图转换。
- 桌球地图的洞口、球体布局和可玩区域。
- Bot 候选搜索与快速评估。
- Socket.IO 房间的回合权限、断线处理和低带宽结算 payload。

## 当前边界

- 当前 Play 模式是测试原型，不是完整游戏规则。
- 客户端 UI 还没有正式道具栏、计分板、房间列表或匹配流程。
- `ShotIntent.spinOffset` 已在核心中支持，但当前前端发射交互暂时提交 `0`。
- effect hook 目前主要记录派发事件，具体道具和技能行为仍待接入。
- 地图编辑器可以导出地图文档，但 Play 模式当前仍加载内置 `Billiards Table`。
