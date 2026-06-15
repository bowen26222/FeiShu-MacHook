# FeiShu-MacHook · 飞书 → Mac MC 服务器控制机器人

一个常驻在 macOS 上的飞书机器人，监听指定群中的 `/mc` 指令，对本机的 Minecraft 服务器进行 **status / stop / kill / restart** 操作。

- 使用飞书官方 SDK 的 **长连接（WebSocket）模式**，Mac 不需要公网映射、不需要回调 URL。
- MC 进程托管在固定名称的 `screen` 会话中；机器人通过 `screen -X stuff` 向控制台注入命令，`stop` 走优雅关闭，`kill` 走 `screen quit` + `pkill` 兜底。
- 双层鉴权：群 `chat_id` 白名单 + 管理员 `open_id` 白名单。
- 提供 `launchd` 守护配置，实现开机自启与崩溃重启。

---

## 1. 前置条件

| 项目          | 要求                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| 操作系统      | macOS（Intel / Apple Silicon 均可）                                                                                 |
| Node.js       | ≥ 18                                                                                                                |
| `screen`      | macOS 自带；如缺失 `brew install screen`                                                                            |
| MC 启动脚本   | 一个可执行的 shell 脚本，例如 `~/mc-server/start.sh`，内部会以前台方式 `exec java -jar server.jar nogui ...` 启动 MC |
| 飞书企业账号  | 能在「飞书开放平台」创建自建应用并将其拉进目标群                                                                    |

> ⚠️ **MC 启动脚本必须前台运行**（用 `exec java ...` 或不要 `&` 放后台），否则 `screen` 会立即退出。

示例 [`~/mc-server/start.sh`](file:~/mc-server/start.sh:1)：

```bash
#!/usr/bin/env bash
cd "$(dirname "$0")"
exec java -Xms4G -Xmx8G -jar server.jar nogui
```

记得 `chmod +x ~/mc-server/start.sh`。

---

## 2. 飞书开放平台配置

1. 打开 https://open.feishu.cn/ → **开发者后台 → 创建企业自建应用**。
2. 「凭证与基础信息」中拿到 **App ID** 和 **App Secret**，待会儿填到 `.env`。
3. 「添加应用能力 → 机器人」开启机器人能力；把头像、名字设好。
4. 「权限管理」开启以下权限（含 v6 / 历史命名两种，按平台显示勾选）：
   - `im:message`
   - `im:message:send_as_bot`
   - `im:message.group_at_msg`（接收 @机器人 的群消息）
   - `im:message.group_at_msg:readonly`
5. 「事件与回调 → 事件订阅」：
   - **传输方式**：选 **「长连接」**（无需公网回调地址）。
   - **订阅事件**：添加 `im.message.receive_v1`（接收消息）。
6. 「版本管理与发布」→ 创建版本 → 提交发布 → 等待企业管理员审批通过。
7. 把机器人拉到目标群里（群设置 → 群机器人 → 添加机器人 → 选你的应用）。
8. 获取 **群 `chat_id`** 与 **管理员 `open_id`**：
   - **`chat_id`**：在群里 @机器人 发送任意消息，先把 `ALLOWED_CHAT_IDS` 留空启动机器人，查看日志 `Ignoring message: chat not in whitelist`，里面会打印当前消息的 `chatId`；或在「开发文档」用「获取用户所在的群列表」API 查询。
   - **`open_id`**：同理，启动后看日志中 `senderOpenId` 字段；或在飞书开放平台 → 调试台调用「通过手机号/邮箱获取用户 ID」。

---

## 3. 项目安装与运行

```bash
git clone <你的仓库地址> feishu-mc-bot
cd feishu-mc-bot
npm install
cp .env.example .env
# 用编辑器把 .env 里的 APP_ID / APP_SECRET / 白名单 / 启动脚本路径填好
```

### 开发模式（热重载）

```bash
npm run dev
```

### 生产模式

```bash
npm run build   # tsc 编译到 dist/
npm start       # node dist/index.js
```

启动成功的日志类似：

```
{"level":"info",...,"msg":"Starting feishu-mc-bot"}
{"level":"info",...,"msg":"WSClient started, awaiting Feishu events..."}
```

---

## 4. 指令使用

在已加入白名单的群里，由白名单内的管理员发送：

| 指令          | 行为                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| `/mc status`  | 查询服务器运行状态（基于 `screen` 会话是否存在）                                  |
| `/mc stop`    | 向 MC 控制台发送 `stop`，等待最长 `MC_GRACEFUL_TIMEOUT_MS` 毫秒；超时建议改用 kill |
| `/mc kill`    | `screen -X quit` 强制关闭会话 + `pkill -9 -f <启动脚本绝对路径>` 兜底             |
| `/mc restart` | 自动 stop（失败则 kill）后启动；启动后会校验 `screen` 会话出现                    |
| `/mc help`    | 显示帮助                                                                          |

> 群里 @机器人 也行，比如「@机器人 /mc status」会被正确识别。

权限规则：

- 群不在 `ALLOWED_CHAT_IDS` 中 → **完全静默**，不回复。
- 群在白名单但发送者不在 `ADMIN_USER_IDS` 中 → 回复「⛔ 无权限」。
- 指令拼错 → 回复帮助文本。

---

## 5. 守护进程（launchd）

参考 [`scripts/com.user.feishu-mc-bot.plist`](scripts/com.user.feishu-mc-bot.plist:1)，替换其中的占位符：

| 占位符            | 替换为                                          |
| ----------------- | ----------------------------------------------- |
| `{{USERNAME}}`    | 你的 macOS 用户名（`whoami` 输出）              |
| `{{PROJECT_DIR}}` | 项目绝对路径（`pwd`）                           |
| `{{NODE_BIN}}`    | `which node` 的输出，例如 `/opt/homebrew/bin/node` |

安装：

```bash
npm run build
# 把模板里的占位符替换好后：
cp scripts/com.user.feishu-mc-bot.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.user.feishu-mc-bot.plist 2>/dev/null
launchctl load -w ~/Library/LaunchAgents/com.user.feishu-mc-bot.plist
```

日志：

```bash
tail -f /tmp/feishu-mc-bot.out.log /tmp/feishu-mc-bot.err.log
```

停止 / 重启：

```bash
launchctl unload ~/Library/LaunchAgents/com.user.feishu-mc-bot.plist
launchctl load   -w ~/Library/LaunchAgents/com.user.feishu-mc-bot.plist
```

---

## 6. 故障排查

| 现象                                                          | 排查方向                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 启动报 `APP_ID is required` / zod 错误                        | `.env` 没填或路径不对。也可直接通过 `EnvironmentVariables` 在 plist 里注入。                                   |
| 启动报 `Illegal screen session name`                          | `SCREEN_SESSION` 只允许 `[A-Za-z0-9_-]+`。                                                                     |
| 群里发消息没反应                                              | 看日志里有没有该消息的 `chatId`；若日志显示 `Ignoring`，把对应 ID 加进 `ALLOWED_CHAT_IDS`。                  |
| 回复「⛔ 无权限」                                              | 把日志里的 `senderOpenId` 加进 `ADMIN_USER_IDS`。                                                              |
| `/mc restart` 报「启动脚本不存在」                            | `MC_START_SCRIPT` 路径错了，或脚本无可执行权限。                                                              |
| launchd 启动后立刻退出，`/tmp/feishu-mc-bot.err.log` 报 `screen: command not found` | plist 里的 `PATH` 没包含 `/opt/homebrew/bin`（M 系列）或 `/usr/local/bin`（Intel），按模板补上。           |
| `/mc stop` 总是超时                                           | MC 在加载世界时无法响应 stop；可调大 `MC_GRACEFUL_TIMEOUT_MS`，或直接用 `/mc kill`。                          |
| 长连接频繁断开                                                | 确认机器所在网络能访问 `wss://*.feishu.cn`；SDK 自带重连，偶发断开属正常现象。                                |

调试小技巧：

```bash
# 列出当前的 screen 会话
screen -ls

# 进入 MC 控制台
screen -r mc      # 退出：Ctrl-A 然后按 D

# 强制结束 mc 会话（同 /mc kill）
screen -S mc -X quit
```

---

## 7. 项目结构

```
.
├── plans/feishu-mc-bot-plan.md          # 设计方案
├── scripts/com.user.feishu-mc-bot.plist # launchd 守护模板
├── src/
│   ├── index.ts          # 入口
│   ├── config.ts         # zod 配置校验
│   ├── logger.ts         # pino 日志
│   ├── feishu/
│   │   ├── client.ts     # lark.Client + WSClient + replyText
│   │   └── handler.ts    # 事件订阅、鉴权、指令解析与分发
│   └── mc/
│       ├── screen.ts     # screen 原子操作封装
│       └── service.ts    # status / stop / kill / restart 业务
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 8. 安全注意事项

- `.env` 永远不要提交到 Git（仓库已在 [`.gitignore`](.gitignore:1) 排除）。
- `APP_SECRET` 泄露 = 你的飞书机器人被冒用；如怀疑泄露，在开放平台重置 secret。
- 所有外部命令均用 `execFile + 参数数组` 调用，杜绝 shell 注入。
- `pkill -9 -f` 使用启动脚本的**绝对路径**作为匹配关键字，避免误杀其他 java 进程；但仍建议机器上不要有同名脚本路径冲突。

---

## 9. License

MIT
