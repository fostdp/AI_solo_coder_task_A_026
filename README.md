# 🌊 城市内涝监测预警系统

基于 Node.js + Express + PostgreSQL + PostGIS 的全栈城市内涝监测预警系统。

## 系统架构

```
┌──────────────────┐   HTTP POST    ┌───────────────────────┐   SQL    ┌───────────────────────┐
│                  │───────────────▶│                       │────────▶│                       │
│   数据模拟器      │  /api/water-level│    Express 后端       │         │  PostgreSQL + PostGIS  │
│ data-simulator.js│  /api/rainfall  │                       │◀────────│                       │
│                  │                │  ┌─────────────────┐  │         │  ┌─────────────────┐  │
│  MODE=normal     │                │  │  DataIngestor   │  │         │  │ water_level_data │  │
│  MODE=storm      │                │  │  (校验+入库)     │  │         │  │ rainfall_data    │  │
└──────────────────┘                │  └────────┬────────┘  │         │  │ alerts           │  │
                                    │  EventBus│           │         │  │ predictions      │  │
┌──────────────────┐   GET /api/*   │  ┌────────▼────────┐  │         │  │ monitoring_points│  │
│                  │◀──────────────│  │  FloodPredictor  │  │         │  └─────────────────┘  │
│   前端浏览器      │                │  │  (预测计算)      │  │         │                       │
│  Canvas 地图      │  轮询 10s/5s   │  └────────┬────────┘  │         │  按月分区 + 8索引      │
│  告警面板         │◀──────────────│  EventBus│           │         │  定时备份(每日)         │
│  详情弹窗         │                │  ┌────────▼────────┐  │         │                       │
│  浏览器通知/降级   │                │  │  AlarmEvaluator  │  │         │                       │
└──────────────────┘                │  │  (告警评估)      │  │         │                       │
                                    │  └─────────────────┘  │         │                       │
                                    └───────────────────────┘         └───────────────────────┘
```

### 事件流

```
水位上报 → DataIngestor.ingestWaterLevel()
              ├─ validateWaterLevel()     跳变滤波(>20cm丢弃)
              ├─ INSERT water_level_data
              └─ emit WATER_LEVEL_VALIDATED
                    → FloodPredictor.onWaterLevelValidated()
                        ├─ calculateChangeRate()
                        ├─ checkRainStopped()
                        ├─ predictWaterLevel()
                        ├─ INSERT predictions
                        └─ emit PREDICTION_COMPLETED
                              → AlarmEvaluator.evaluate()
                                  ├─ _resolveStaleAlerts()   含预测告警恢复
                                  ├─ _triggerNewAlerts()
                                  └─ emit ALERT_TRIGGERED
                                        → onNotification() → 浏览器通知/页面横幅
```

## 快速部署

### Docker Compose（推荐）

```bash
# 一键启动全部服务
docker compose up -d

# 暴雨模式模拟器
MODE=storm docker compose up -d simulator

# 查看日志
docker compose logs -f app
```

服务启动后访问 http://localhost:3000

### 手动部署

**环境要求**：Node.js ≥ 16、PostgreSQL ≥ 12 + PostGIS

```bash
# 1. 安装依赖
npm install

# 2. 初始化数据库
psql -U postgres -f init.sql

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 中的数据库连接信息

# 4. 启动服务
npm start

# 5. 启动模拟器（另开终端）
npm run simulate          # 正常模式
MODE=storm npm run simulate  # 暴雨模式
```

## Docker 服务说明

| 服务 | 端口 | 说明 |
|------|------|------|
| `app` | 3000 | Node.js 应用服务器 |
| `postgres` | 5432 | PostgreSQL + PostGIS 数据库 |
| `backup` | - | 定时备份（每日全量，保留7天） |
| `simulator` | - | 数据模拟器（默认正常模式） |

备份文件存储在 `./backup/` 目录，格式为 `flood_monitoring_YYYYMMDD_HHMMSS.dump`。

## 点位配置格式

新增/修改监测点位只需编辑 `points-config.json`：

```json
{
  "points": [
    {
      "id": 21,
      "code": "P021",
      "name": "新增点位名称",
      "address": "详细地址",
      "lng": 116.401,
      "lat": 39.910,
      "thresholdOrange": 15,
      "thresholdRed": 30
    }
  ],
  "mapBounds": {
    "minLng": 116.365,
    "maxLng": 116.440,
    "minLat": 39.880,
    "maxLat": 39.935
  },
  "prediction": {
    "orangePredictionThreshold": 25,
    "predictionTimeMinutes": 30,
    "rainfallInfluence": 0.3,
    "rateInfluence": 0.7,
    "decayFactor": 0.3
  }
}
```

**新增点位步骤**：
1. 在 `points-config.json` 的 `points` 数组中添加新点位
2. 在数据库 `monitoring_points` 表中插入对应记录
3. 如需扩大地图范围，修改 `mapBounds`
4. 前端自动从 `GET /api/config` 加载，无需改代码

## 模拟器用法

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MODE` | `normal` | 模拟模式：`normal`（正常）或 `storm`（暴雨） |
| `API_BASE_URL` | `http://localhost:3000/api` | 后端 API 地址 |
| `TICK_MS` | `60000` | 采集间隔（毫秒），调试时可缩短如 `10000` |

### 两种模式对比

| 参数 | 正常模式 | 暴雨模式 |
|------|---------|---------|
| 降雨起始概率 | 4%/分钟 | 25%/分钟 |
| 降雨强度 | 3~20 mm/h | 25~80 mm/h |
| 降雨持续 | 10~45 分钟 | 30~120 分钟 |
| 涝灾风险倍率 | ×1.0 | ×1.8 |
| 排水速率倍率 | ×1.0 | ×0.4（排水受阻） |

### 使用示例

```bash
# 本地正常模式
npm run simulate

# 本地暴雨模式
MODE=storm npm run simulate

# Docker 暴雨模式
MODE=storm docker compose up -d simulator

# 调试快速模式（10秒一跳）
TICK_MS=10000 MODE=storm npm run simulate
```

模拟器内置限流感知：收到 429 响应时自动跳过，不会崩溃。

## API 限流

| 接口 | 限制 | 策略 |
|------|------|------|
| `POST /api/water-level` | 120次/分钟 | 按点位编号限流 |
| `POST /api/rainfall` | 120次/分钟 | 按点位编号限流 |
| `GET /api/*` | 300次/分钟 | 按 IP 限流 |

超出限制返回 `429 Too Many Requests`，响应头含 `RateLimit-*` 信息。

## 告警规则

| 级别 | 条件 | 通知方式 |
|------|------|---------|
| 🟠 橙色（实际） | 水位 ≥ 15cm | 浏览器通知 → 降级页面横幅 |
| 🔴 红色（实际） | 水位 ≥ 30cm | 浏览器通知 → 降级页面横幅 |
| 🟠 橙色（预测） | 预测峰值 ≥ 25cm | 浏览器通知 → 降级页面横幅 |

### 通知降级策略

```
1. 浏览器支持 Notification 且用户已授权 → 系统通知
2. 用户拒绝授权或不支持 → 页面顶部红色横幅（8秒自动消失）
3. 通知创建异常 → 降级为页面横幅
```

## 项目结构

```
├── lib/                        # 后端业务模块
│   ├── event-bus.js           # 事件总线（8种事件）
│   ├── data-ingestor.js       # 数据校验+入库
│   ├── flood-predictor.js     # 预测计算+降雨检测
│   └── alarm-evaluator.js     # 告警评估+推送
├── public/                     # 前端静态文件
│   ├── index.html             # 主页面
│   ├── style.css              # 样式（含通知降级横幅）
│   └── app.js                 # Canvas地图 + 交互
├── Dockerfile                  # 应用镜像
├── docker-compose.yml          # 编排（4服务）
├── init.sql                    # 数据库初始化（分区+索引）
├── server.js                   # Express 路由组装
├── data-simulator.js           # 双模式模拟器
├── points-config.json          # 点位配置
├── package.json                # 依赖
└── .env                        # 环境变量
```

## 数据库设计

### 分区策略

`water_level_data` 和 `rainfall_data` 按 `recorded_at` 按月分区，预建至 2026 年 12 月。查询时 PostgreSQL 自动裁剪无关分区。

### 索引

| 索引 | 表 | 类型 | 用途 |
|------|-----|------|------|
| `idx_water_level_point_time` | water_level_data | B-tree | 点位+时间查询 |
| `idx_water_level_recorded_at` | water_level_data | B-tree | 分区裁剪 |
| `idx_rainfall_point_time` | rainfall_data | B-tree | 点位+时间查询 |
| `idx_alerts_active` | alerts | Partial B-tree | 活动告警查询 |
| `idx_predictions_valid` | predictions | Partial B-tree | 有效预测查询 |
| `idx_monitoring_points_location` | monitoring_points | GiST | 地理查询 |

## 许可证

MIT
