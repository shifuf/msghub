# MsgHub · 消息推送平台

单管理员多渠道消息推送中台：统一接入 API、全局渠道、项目策略派发、站内必达、失败熔断、未读邮件兜底、SSE 实时通知。

适合个人 / 小团队把博客、运维告警、业务事件等推送到：

- **即时推送**：极光 (JPush)、Bark、Gotify、Server酱、PushPlus
- **IM 机器人**：飞书、钉钉、Discord、Telegram
- **通用通道**：Webhook、SMTP 邮件
- **站内**：Inbox + SSE 弹窗 / 桌面通知

---

## 功能特性

- **统一开放接入**：`/api/webhook`、`/api/bark`、`/api/gotify`、`/api/email`，Bearer 项目 API Key
- **项目策略派发**：调用方不选渠道；外发按绑定优先级熔断，失败后 SMTP / 站内兜底
- **静默时段**：低/普通优先级可延迟外发，早晨补发
- **未读邮件兜底**：设备推送超时未读，自动 SMTP 通知管理员
- **实时通知**：SSE 推送到管理后台铃铛与桌面通知
- **模板系统**：邮件 Handlebars 模板 + 推送模板 + 事件目录
- **可运维**：发送记录、设备推送历史、抑制名单、定时发送、配置导入导出
- **可配置后台入口**：`ADMIN_PATH` 控制登录路径，重启 web 容器即生效

---

## 架构一览

```
Client / Business App
        │  Bearer msg_xxx
        ▼
   Nginx (web)  ──/api/*──▶  NestJS API  ──▶  PostgreSQL
        │                         │
        │                         ├── Redis / BullMQ 发送队列
        │                         └── Adapters → JPush / Bark / SMTP / …
        ▼
   Vue3 Admin SPA  ◀── SSE ──┘
```

| 组件 | 技术 |
|---|---|
| 后端 | NestJS 10 · Prisma · PostgreSQL 16 · Redis 7 · BullMQ |
| 前端 | Vue 3 · Vite 6 · Naive UI · Pinia · Tailwind |
| 部署 | Docker Compose · 启动时自动执行初始化 SQL + seed |

---

## 快速部署（Docker，推荐）

### 1. 克隆并配置

```bash
git clone https://github.com/<your-name>/msghub.git
cd msghub
cp .env.example .env
```

编辑 `.env`，**至少修改**：

```env
APP_ENV=production
JWT_SECRET=请换成足够长的随机字符串
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请换成强密码
# 可选：对外域名（邮件退订完整链接）；不填则自动用浏览器当前域名/相对路径
# SITE_URL=https://notify.example.com
# 可选：后台入口 / 端口
# ADMIN_PATH=/admin
# WEB_PORT=8185
```

> 端口、CORS、API 基路径等会按 `APP_ENV` 自动识别，无需再配 `PORT` / `CORS_ORIGINS` / `VITE_*`。
### 2. 启动

```bash
docker compose up -d --build
```

等待健康检查通过后访问：

| 地址 | 说明 |
|---|---|
| `http://服务器IP:8185/` | 公开门户 |
| `http://服务器IP:8185/admin` | 管理后台登录（路径由 `ADMIN_PATH` 决定） |
| `http://服务器IP:8185/api/health` | API 健康检查（经 web 反代） |

首次登录账号为 `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`，**登录后请立即修改密码**。

### 3. 修改后台入口路径

```env
ADMIN_PATH=/your-secret-path
```

```bash
docker compose up -d web   # 仅重启 web 即可，无需重新 build
```

之后访问：`https://你的域名/your-secret-path`

### 4. 反向代理（可选）

将域名 HTTPS 反代到 `WEB_PORT`（默认 8185）。示例 Nginx：

```nginx
server {
  listen 443 ssl http2;
  server_name notify.example.com;

  # ssl_certificate ...;
  # ssl_certificate_key ...;

  location / {
    proxy_pass http://127.0.0.1:8185;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # SSE
    proxy_buffering off;
    proxy_read_timeout 3600s;
  }
}
```

---

## 本地开发

环境要求：Node.js ≥ 22.22、pnpm 9.15+、Docker（用于 Postgres + Redis；也可使用本机独立服务）。

```bash
# 1. 依赖
pnpm install

# 2. 启动数据库与 Redis
pnpm db:up
# APP_ENV=development：临时映射本机 5432/6379（不进仓库）
# APP_ENV=production / 服务器：不映射端口，不抢宿主机 5432/6379
# 生产全栈请用：docker compose up -d --build

# 3. 环境变量
cp .env.example .env
# 默认 APP_ENV=development，API 端口 3010

# 4. 迁移与种子
pnpm db:generate
pnpm --filter @msg/api exec prisma migrate deploy
pnpm db:seed

# 5. 启动
pnpm dev          # 同时启动 api + web
# 或
pnpm dev:api
pnpm dev:web
```

- 前端：http://localhost:5173
- 管理入口：http://localhost:5173/admin
- API：http://localhost:3010（经 vite 代理 `/api`）

---

## 开放接入

凭证：项目 **API Key**，Header：

```http
Authorization: Bearer msg_xxx
```

密钥仅在「创建 / 重置」时显示一次。

### Webhook（通用）

```bash
curl -X POST "https://你的域名/api/webhook" \
  -H "Authorization: Bearer msg_xxx" \
  -H "Content-Type: application/json" \
  -d '{"title":"部署完成","content":"v1.2.0 已上线","priority":"normal"}'
```

### Bark 兼容

```bash
curl -X POST "https://你的域名/api/bark" \
  -H "Authorization: Bearer msg_xxx" \
  -H "Content-Type: application/json" \
  -d '{"title":"告警","body":"磁盘使用率 90%"}'
```

### Gotify 兼容

```bash
curl -X POST "https://你的域名/api/gotify" \
  -H "Authorization: Bearer msg_xxx" \
  -H "Content-Type: application/json" \
  -d '{"title":"任务","message":"备份完成","priority":5}'
```

### 指定收件人邮件

```bash
curl -X POST "https://你的域名/api/email" \
  -H "Authorization: Bearer msg_xxx" \
  -H "Content-Type: application/json" \
  -d '{"to":"user@example.com","subject":"验证码","content":"123456"}'
```

### 派发顺序（项目策略）

1. **静默时段**（项目开启且 priority 为 low/normal）：立即站内 + 定时补发外发  
2. 项目已启用的**外发推送**渠道（按 priority 熔断）  
3. 失败 / 无外发 → **SMTP 到管理员邮箱**  
4. 再失败 / 无邮箱 → **站内 Inbox**（保证后台可见）  

`high` / `critical` 始终立即外发，不受静默限制。

更完整字段说明见 [`docs/对接开发文档.md`](./docs/对接开发文档.md)。

---

## 环境变量说明

2026-11-17 安全与可靠性升级请先阅读 [升级与验收](docs/升级与验收-2026-11-17.md) 和 [28项修复映射](docs/修复验收矩阵-2026-11-17.md)。

完整注释见 [`.env.example`](./.env.example)。常用项：

| 变量 | 说明 | 默认 |
|---|---|---|
| `APP_ENV` | `development` / `production`，决定 CORS、默认端口等 | 开发 `development`；Compose `production` |
| `JWT_SECRET` | JWT 签名密钥（生产必改） | — |
| `ADMIN_USERNAME` | seed 默认管理员用户名 | `admin` |
| `ADMIN_PASSWORD` | 生产首次初始化必填，至少12字符且不能使用示例密码 | 开发示例仅供本机使用 |
| `SITE_URL` | 对外 HTTPS 根地址，邮件退订及浏览器回执必须可访问 | 生产无自动域名 |
| `TOTP_ENCRYPTION_KEY` | 独立随机密钥，保护双因素认证配置；需要安全备份 | 未设时从 JWT_SECRET 派生 |
| `TRUST_PROXY` | 可信反向代理 IP/CIDR 清单 | 裸服务不信任代理；Compose 仅容器内网 |
| `CORS_ORIGINS` | 跨域管理页面的完整 origin，逗号分隔 | 生产仅同源 |
| `ADMIN_PATH` | 后台登录路径（Docker 重启 web 生效） | `/admin` |
| `WEB_PORT` | web 容器宿主机端口 | `8185` |

已内置、无需再写进 `.env` 的项：

- API 容器端口固定 `3010`（不映射宿主机；外网走 web 反代）
- 开发 CORS 自动放行 `localhost:5173` / `8185`
- 生产默认仅同源访问，跨域必须显式设置 `CORS_ORIGINS`
- 前端 API 基路径固定同源 `/api`

---

## 目录结构

```
.
├── apps/
│   ├── api/                 # NestJS 后端
│   │   ├── prisma/          # schema · 向前迁移 · 统一 seed
│   │   └── src/
│   │       ├── adapters/    # 渠道适配器
│   │       ├── messages/    # 发送核心 / 策略
│   │       ├── openapi/     # 开放接入控制器
│   │       └── ...
│   └── web/                 # Vue3 管理端
├── docs/                    # 对接文档
├── docker-compose.yml       # 唯一编排（pg/redis 默认不映射宿主机端口）
├── scripts/db-up.js         # 本机 db:up：按 APP_ENV 自动决定是否映射端口
├── .env.example
└── README.md
```

---

## 上线检查清单

- [ ] 设置 `APP_ENV=production`  
- [ ] 修改 `JWT_SECRET` 为高强度随机串  
- [ ] 修改 `ADMIN_PASSWORD`，登录后再次改密  
- [ ] 按需设置 `ADMIN_PATH`（仅入口定制，不替代鉴权）
- [ ] 配置 `SITE_URL=https://你的域名`（邮件退订完整链接及设备回执）
- [ ] 在后台配置至少一个外发渠道，并绑定到项目  
- [ ] 创建项目 API Key，用 curl 做一次连通测试  
- [ ] （可选）配置反向代理与 HTTPS  

重置管理员密码（会按 env 覆盖）：

```env
FORCE_RESET_ADMIN_PASSWORD=true
```

```bash
docker compose up -d api
# 生效后请改回 false，避免每次重启都重置
```

---

## 许可证

[MIT](./LICENSE)
