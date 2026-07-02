# Disc Arena

Disc Arena 是一个 Web 回合制二维圆盘物理竞技游戏原型。玩家在自己的回合选择一个己方球体，像愤怒的小鸟一样拖拽瞄准并发射；服务端负责权威结算，客户端使用共享核心逻辑和服务端返回的关键结果播放动画并校正状态。

当前项目已经从最初的核心骨架推进到可本地联机测试的原型版本，但仍然不是完整商业游戏。它包含 Canvas 前端、Socket.IO 房间服务、地图编辑器、传送门、像素风渲染、多种地图材质、bot 输入接口、缩圈规则和一套共享 TypeScript 核心逻辑。

## 当前状态

- 支持创建房间、加入房间、房主开局、房主导入地图、房主添加 bot。
- 最大房间人数为 6，bot 也占用房间人数。
- 开局时地图上的球会尽量均分给玩家，并按玩家颜色显示外环。
- 玩家只能击打自己的存活球体。
- 如果一名玩家场上没有球，该玩家出局。
- 当场上只剩一名玩家拥有存活球体时，该玩家胜利。
- 服务端使用权威模拟，客户端不接收逐帧网络流，只接收击球意图、事件、最终状态和必要的最终地图。
- 当前 bot 使用与真人完全一致的 `ShotIntent` 输入接口，只是输入由服务器脚本生成。临时逻辑会提交零力度击球，相当于跳过回合。

## 技术栈

- TypeScript
- Node.js
- Vite
- Canvas 2D
- Socket.IO
- Vitest
- npm workspaces

## 项目结构

```text
apps/
  client/
    index.html
    src/main.ts          # Canvas 渲染、输入、房间 UI、播放和校正
    src/mapEditor.ts     # 地图编辑器
    src/colors.ts        # 材质边缘色辅助
    src/styles.css
  server/
    src/server.ts        # HTTP + Socket.IO 入口
    src/roomManager.ts   # 多房间和 socket 归属
    src/room.ts          # 单房间大厅、开局、回合、胜负和权威模拟
    src/botInput.ts      # 临时 bot 输入提供器
packages/
  core/
    src/types/           # 游戏、地图、网络、模拟、传送门等共享类型
    src/math/            # Vec2 工具
    src/map/             # 默认地图、可编辑地图、动态材质、像素球半径档位
    src/physics/         # 固定步长物理、碰撞、阻尼、传送门代理
    src/rules/           # 出界、对局分配、缩圈
    src/simulation/      # 击球应用、整回合模拟、状态 hash
    src/bot/             # bot 候选和快速评估骨架
config/
  network.local.env
  network.production.env.example
```

## 快速启动

安装依赖：

```bash
npm install
```

启动服务端：

```bash
npm run server:dev
```

另开一个终端启动前端：

```bash
npm run client:dev
```

默认地址：

- Server: `http://127.0.0.1:3000`
- Client: `http://127.0.0.1:5173`

## 常用命令

```bash
npm run typecheck
npm test
npm run build
```

工作区脚本：

```bash
npm run server:dev
npm run client:dev
npm run server:build
npm run client:build
```

## 本地游玩流程

1. 运行服务端和前端。
2. 打开前端页面。
3. 在主菜单输入玩家名并创建房间，或者输入房间码加入房间。
4. 房主可以在大厅导入地图、添加 bot、配置缩圈。
5. 房主点击 Start 开局。
6. 当前玩家选择己方球体，按住鼠标拖拽并松开发射。
7. 所有球停止后进入下一回合。

## 地图编辑器

主菜单中进入 Map Editor。编辑器使用最小网格作为世界单位，支持缩放和平移，最大地图尺寸为 `128 x 128`。

地图包含多个图层：

- Ground: 地面层
- Portal: 传送门专用层
- Obstacle: 障碍物层
- Balls: 初始球体摆放

编辑工具：

- Add: 添加当前材质
- Remove: 移除当前图层材质
- Shape: 在整格和四种三角形之间循环
- Drag: 平移视图
- Rectangle: 用两个点填充矩形区域
- Circle Cell: 以格子中心为圆心画圆
- Circle Grid: 以网格交点为圆心画圆

地图可以导出为 `.damap` 文本文件，也可以在 Play 房间大厅由房主导入。导入房间的地图会同步给房间内所有玩家。

## 地面材质

| 材质 | 类型 | 表现 |
| --- | --- | --- |
| `void` | 地面 | 虚空区域，球体持续离开可玩区域后会出界 |
| `grass` | 地面 | 默认桌面材质 |
| `ice` | 地面 | 低阻尼，球更滑 |
| `sand` | 地面 | 高阻尼，球更快慢下来 |
| `cloud` | 地面 | 近白淡蓝色云层，球滚过后会消散并变成 `void` |

云层消散由核心模拟处理，基于球体从上一帧到当前帧的扫过路径和球半径计算。服务端权威模拟产生 `terrain_changed` 事件，并在需要时通过 `shot:resolved.finalMapData` 同步最终地图。

## 障碍物材质

| 材质 | 类型 | 反弹系数 | 表现 |
| --- | --- | --- | --- |
| `wood` | 障碍物 | `1.0` | 普通红棕木墙 |
| `elastic_wall` | 障碍物 | `1.6` | 弹力墙，反弹更强 |
| `sticky_wall` | 障碍物 | `0.4` | 粘性板，反弹明显更弱 |
| `airbag` | 障碍物 | `1.0` | 气囊，第一次被撞后局部消失 |

气囊碰撞会产生 `obstacle_changed` 事件。消失区域以碰撞点为中心，沿被撞墙段方向向两侧各延长 `球半径 * 0.4`，随后重建该地图的静态墙体碰撞线段。

## 传送门

当前支持最多两对传送门。传送门严格成对出现，球体穿越入口后会从另一端出现，并按出口方向转换速度。球体半穿越时会生成 `portal_shadow` 代理，让入口端和出口端都能参与碰撞反馈。

地图编辑器中可以添加或移除 Portal 1 和 Portal 2，移动端点、调整长度，并通过角度输入控制方向。

## 房间和对局规则

- 房间只存在于内存中，当前没有数据库和账号系统。
- 房间码用于多人加入同一局。
- 大厅阶段允许加入玩家、导入地图、添加 bot、配置缩圈。
- 进行中普通加入会被拒绝，同浏览器 rejoin token 可用于重连。
- 开局时所有球按 seed 确定性随机分配给玩家。
- 拥有球更少的玩家行动顺序更靠前。
- 离线玩家会保留球，但回合会被跳过。
- bot 和真人都走同一个击球校验入口。

## 缩圈规则

房主可在大厅开启缩圈，并设置参数 `x`。开启后，缩圈会在所有玩家都完成过一轮行动后开始，毒圈外区域会用半透明粉色覆盖，并在 `x` 轮后完全覆盖地图。

如果某个球在其所属玩家一次行动开始时和结束时都完全处于毒圈外，该球会被判定出界。

## 同步策略

项目目标是适配低带宽服务器，因此不发送每帧运动轨迹。

服务端广播的关键消息包括：

- `room:joined`
- `room:state`
- `shot:started`
- `shot:resolved`
- `shot:rejected`

一次合法击球的流程：

1. 客户端提交 `ShotIntent`。
2. 服务端校验当前玩家、回合号、状态 hash、球体归属和静止状态。
3. 服务端运行 `simulateShot` 做权威结算。
4. 服务端返回初始状态、事件、可选帧、最终状态、结果 hash 和可选最终地图。
5. 客户端根据权威数据播放本回合动画，最后应用最终状态。

## 核心物理

`packages/core` 是纯逻辑库，不依赖 DOM、Canvas、Socket.IO、浏览器 API 或 Node 文件系统。

核心约束：

- 物理状态统一使用 `Vec2` 表示位置和速度。
- `ShotIntent` 使用 `angle + power + spinOffset`，进入模拟时转换为速度和旋转变化。
- `power` 按力处理，同样力度击打轻球会获得更高速度。
- 圆形 body-body 碰撞使用动量和动能守恒的一维法线分解模型。
- 静态墙体使用线段最近点、穿透修正和 restitution 反弹。
- 阻尼、睡眠、地面材质、传送门、出界和动态材质都在核心模拟管线中处理。

单步管线大致为：

```text
continuous effects
spin curve
velocity integration
position integration
dynamic terrain updates
body proxies
body and wall collisions
dynamic obstacle updates
proxy feedback
triggers
damping
sleep
portal transitions
events
```

## 测试覆盖

当前测试覆盖核心逻辑和服务端房间逻辑，包括：

- Vec2 数学
- 击球转换
- 阻尼和休眠
- 圆形碰撞和墙体碰撞
- 传送门转换、影子代理和穿越提交
- 出界规则
- 缩圈规则
- 对局分球、出局和胜利
- 地图编码、压缩、导入导出、画刷和材质转换
- 云层消散和气囊消失
- bot 候选和快速评估骨架
- 房间创建、加入、开局、导入地图、添加 bot、回合校验和断线处理

运行：

```bash
npm test
```

## 网络配置

本地配置占位文件：

```text
config/network.local.env
```

生产配置占位文件：

```text
config/network.production.env.example
```

当前生产配置只是模板，需要部署时填写真实域名和服务地址。

## 当前边界

- 房间是内存房间，服务重启后状态会丢失。
- 没有账号、匹配、持久化地图库或排行榜。
- bot 目前只有临时输入脚本，还不是完整 AI 玩家。
- 地图编辑器只做本地编辑和房间导入，不做服务器保存。
- 碰撞系统仍是原型级，暂不包含复杂多边形 SAT/GJK 或大型物理引擎。
- 美术仍是 Canvas 像素风原型，不是最终资源管线。

