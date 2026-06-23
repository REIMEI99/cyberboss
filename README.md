<div align="center">

# cyberboss-pulse
### 一个微信桥接的、给 ADHD 的生活语境型轻度提醒系统

> 它不替代你的 Todo List，它只做 Todo List 做不到的事。

[![Node >=22](https://img.shields.io/badge/Node-22%2B-3C873A)](./package.json)
[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-b31b1b)](./LICENSE)
[![Runtime-Codex%20%7C%20ClaudeCode](https://img.shields.io/badge/Runtime-Codex%20%7C%20ClaudeCode-111827)](#技术栈)
[![Bridge-Weixin](https://img.shields.io/badge/Bridge-Weixin-07C160)](#技术栈)

<p>
  <a href="#它想解决什么">为什么</a> ·
  <a href="#核心模块">核心模块</a> ·
  <a href="#触发模型">触发模型</a> ·
  <a href="#快速上手">快速上手</a> ·
  <a href="#微信命令">微信命令</a> ·
  <a href="#agent-工具">Agent 工具</a> ·
  <a href="#本地数据">本地数据</a> ·
  <a href="#架构">架构</a>
</p>

</div>

<p align="center">
  <img src="./docs/images/chat-example-1.jpg" alt="对话示例 1" width="31%" />
  <img src="./docs/images/chat-example-2.jpg" alt="对话示例 2" width="31%" />
  <img src="./docs/images/chat-example-3.jpg" alt="对话示例 3" width="31%" />
</p>

cyberboss-pulse 把一个本地运行的编程型 Agent（Codex 或 Claude Code）桥接进微信，让它变成一个常驻在线、记得你这一天发生了什么、并且会在合适的时机主动把你拉回来的生活陪伴体。你不用「开始一个会话」——它就活在那个你本来每天都会打开的聊天界面里。

它的底层代码来自 [WenXiaoWendy/Cyberboss](https://github.com/WenXiaoWendy/Cyberboss)，但相比于原项目，它收窄到一件更具体的事。

## 它是为哪一类事准备的

不是「忘了开会」「作业赶due」那种——开会会有人把你拉进会议室，完不成的due会有严重后果。

它管的是另一类：**不做也没人会来追究你**的事。

- 椅子上堆了一周的衣服，没有任何后果逼你收，所以你不会收。
- 想种草某个东西，念头一闪而过，三天后百无聊赖时依旧不知道自己要做什么。
- 洗碗、扔垃圾、回一条不紧急的消息：每件都不难，但好像也没有一定要现在开始的理由；即便设置了提醒，往往也演变成TODO软件里一堆红字的过期任务。

这类事没有硬性的时间点，也没有严重的外部后果去 Push 你去执行——而恰恰是它们，最容易在 ADHD 的生活里一直拖着，直到某天蓦然回首才意识到，「天哪，我这些天到底在干什么？」

pulse 做的，是把这类事的管理权从你手里挪走一点，交给一个始终在线、保持记忆、能跨时间行动的本地 Agent：基于你当下的生活语境，用对话式、个性化的方式提醒和督促你。

## 它不打算取代你的 Todo List

这是刻意的。

任何由大模型驱动的 Todo List 都是不稳定的：它可能漏掉一条、可能误判优先级、可能在你最需要它的时候恰好压错了判断。把「必须做、不做有后果」的事交给一个不稳定的系统，风险太高——那类事还是该留在你本来就在用的、确定性的工具里。

pulse 只做 Todo List 做不到的那部分：

- 每天用不一样的方式、基于你当时的生活状态给出习惯提醒，防止同一个提醒在反复出现后对你彻底失效。
- 快速梳理手头几件家务，然后引导你一件件完成，而不是甩给你一张清单让你自己看着办。
- 你随口说一句「种草了 xx」，几天后你百无聊赖时，它主动建议你去做 xx，还能借助模型自己的知识和网络搜索能力给你指路。
- 你一句话记下的愿景、想法、没展开的念头，由它（而不是你自己）去收集整理，并在之后提醒你回顾、考虑执行。

## 核心模块

四个主模块构成了 pulse 的日常运转。

### reminder — 不断把你拉回来

提醒不是主要给用户看的闹钟，而是「模型给未来的自己留的指令」。模型用它来把自己从当前对话里抽身、在稍后某个时间点重新醒来、把一件还没闭环的事再推一步。

- 支持相对延迟（`30m`、`1h30m`、`2d`）和绝对时间（`2026-04-07T21:30+08:00`）。
- 到点后，模型把提醒转化成当下最有用的动作：发一条消息、记一笔日记、更新状态，或再排一个跟进提醒——而不是机械复读提醒文本。
- 默认闭合原则：只要存在未来检查点、可能拖延、未闭环的线索、容易忘的事，就倾向于创建提醒，而不是「嘴上说记得」。

### habit — 轻量温柔的习惯追踪

比 todo 软、比随手提醒硬一点的习惯追踪，刻意不做愧疚机器，不靠连胜压力。

- 每个习惯每天只有一个状态：`done` / `incomplete` / `abandoned`。
- 可配置偏好时段、适用语境、回避语境、最小可行版本、nudge 冷却时间。
- 习惯的默认运作通道是 reminder：时机好就现在提醒，时机不好就给自己排一个稍后再看的提醒，而不是「注意到然后什么都不做」。
- 内置建议引擎会基于当前语境给习惯打分，挑出当下最值得 nudge 的那一个，并要求模型用新鲜的、低羞耻的措辞，附带一个「最小可行版本」让启动门槛降到最低。

### pool — 上下文里的速记短清单

对应代码里的 title-pool。用于那些非常短、还没决定怎么处理的当下动作标题，比如「去洗碗」「把书拿出来」「回消息」。

- 在活跃对话里，用户随口抛出一句短动作，如果还不确定要不要排提醒，先写进 pool，别让它丢掉。
- 在 pulse/安静回顾时，模型先 review pool，再决定每一条是删掉、提升成 reminder、还是提升成 memory。
- 这是一个转瞬即逝的缓冲层，上限 20 条，避免短念头在「要不要正式记录」的犹豫里消失。

## 触发模型

三种触发共用一套运作逻辑，区别只在于「义务有多强」。

1. `user_message`（主动对话）：先回答用户，再判断是否产生跟进锚点、习惯状态变更、记忆保存或长期记忆。
2. `pulse`（随机唤醒）：不是「必须说话」的义务，而是「检查一下」的义务。默认顺序是 review 语境 → 判断要不要发一条短消息 → 不发就做一个小的私下动作 → 做一次跟进决策。即便选择沉默，也优先做一件小事（排提醒、标记习惯、查一条 Obsidian 信号、存记忆等），不能用沉默偷懒。
3. `reminder`（到期义务）：现在就行动的义务。把提醒文本转化成当下最有用的动作，不要假设用户已经做了。

> 命名说明：模型侧语义叫 `pulse`，宿主侧调度/配置/微信命令里仍叫 `checkin`，指的是同一个随机唤醒机制。

## 可选模块

主模块之外，pulse 还接了几个按需启用的能力。

- **timeline**：把碎片化的聊天重构成结构化的个人时间线，记录事件何时开始、何时结束、持续多久。基于独立项目 [timeline-for-agent](https://github.com/WenXiaoWendy/timeline-for-agent)，可单独使用，也可在这里生成中文/英文时间线看板和截图。
- **obsidian**：把本地 Obsidian vault 当语境源，按「最近日记 → 定向搜索 → 最近笔记 → 读单条」的顺序按需取用，不会扫整个库。
- **diary**：零 token 日记，直接写本地文件，不依赖云笔记、不额外烧模型上下文。不等待触发词，一天里有值得留的东西就记，睡前做一次收尾。
- **whereabouts**：内置位置/电量/触发语境的 HTTP 摄入服务（`whereabouts-mcp`），让模型知道你在哪、在家还是在公司、电量多少。
- **memory**：持久的事实、偏好、原则、关系、项目语境、自我规则，也存放跨对话留存的 wishseed（种草/待办）和 concern（担忧/风险）。决策前先搜记忆，只在信息需要活过今天时才存。wishseed 和 concern 有生命周期，完成后用 `cyberboss_memory_complete` 关闭。
- **embedding**：memory 的语义检索后端。配置 `CYBERBOSS_EMBEDDING_*` 后，写入时自动算向量，`search` 走余弦相似度；未配置时退回子串匹配。老数据用 `cyberboss_memory_reindex` 补算一次即可。
- **sticker**：表情包标签化存取，情绪/休闲场景里用贴纸代替纯文字。
- **vision**：对不支持原生图片输入的模型，用 OpenAI 兼容的视觉描述 API 做兜底；`auto` 模式下原生可用就用原生。

## 技术栈

- **核心**：一个可插拔的 runtime 层，同一套微信命令面和共享线程工作流同时支持 Codex 和 Claude Code。
- **桥接**：微信 HTTP bridge，长轮询同步收消息、发回复、传文件、处理状态转换。
- **队列与触发**：本地提醒队列、pulse/check-in 触发队列、时间线截图任务队列，加上 title-pool / memory 等内部存储。
- **能力层**：timeline、diary、随机 check-in、文件投递、习惯追踪、Obsidian 取语境等。
- **可选工具**：MCP 或其它本地硬件/软件集成可按需接入，非必需。
- **本地优先**：所有状态都在 `${HOME}/.cyberboss`，持续处理高度敏感的私人聊天与生活轨迹，因此采用 `AGPL-3.0-only`。

## 快速上手

### 前置要求

- Node.js `>= 22`
- 本地装好 `codex` 或 `claude`
- 想用截图功能则需要 Chrome / Chromium / Edge

### 获取源码并安装

本项目不发布到 npm，clone 后在项目目录内安装：

```bash
git clone https://github.com/WenXiaoWendy/cyberboss.git
cd cyberboss
npm install
```

### 配置环境变量

从 `.env`（当前目录）、`${HOME}/.cyberboss/.env`、当前 shell 环境读取。首次运行前至少设好：

```dotenv
CYBERBOSS_USER_NAME=你的名字
CYBERBOSS_USER_GENDER=female
CYBERBOSS_ALLOWED_USER_IDS=你的微信用户id
CYBERBOSS_WORKSPACE_ROOT=/absolute/path/to/your/project
```

常用可选项（完整列表见 [.env.example](./.env.example)）：

```dotenv
CYBERBOSS_RUNTIME=codex            # 或 claudecode，命令面不变
CYBERBOSS_CODEX_ENDPOINT=          # 复用已有 shared Codex app-server
CYBERBOSS_CODEX_MODEL=             # 指定模型，留空用默认
CYBERBOSS_CODEX_MODEL_PROVIDER=    # 如 ollama 走本地模型
CYBERBOSS_CLAUDE_MODEL=
CYBERBOSS_CLAUDE_CONTEXT_WINDOW=200000
CYBERBOSS_VISION_MODE=auto         # auto / caption / native / off
CYBERBOSS_OBSIDIAN_VAULT_ROOT=     # 启用 Obsidian 语境
CYBERBOSS_ENABLE_LOCATION_SERVER=false
CYBERBOSS_EMBEDDING_API_BASE_URL=  # 启用语义检索（OpenAI 兼容 embeddings 端点）
CYBERBOSS_EMBEDDING_API_KEY=
CYBERBOSS_EMBEDDING_MODEL=text-embedding-3-small
```

为什么要先设用户名和性别：第一条 `cyberboss` 命令会自动生成 `~/.cyberboss/weixin-instructions.md` 人设文件，先设好能避免一开始就跑偏。想拿到最强的 push 效果，别一上来就手改人设模板，先让 Agent 在真实对话里养出节奏，再只改明显不对的地方。

### 终端命令

- `npm run login` — 登录微信，本地保存 bot 账号
- `npm run accounts` — 列出已保存账号
- `npm run shared:start` — 默认启动：shared runtime bridge + shared 微信 bridge（保持前台运行）
- `npm run shared:open` — 默认接入：在终端打开绑定的 shared 线程
- `npm run shared:status` — 检查 shared runtime、bridge 和 `readyz`
- `npm run doctor` — 检查配置、channel/runtime 边界、线程状态
- `npm run help` — 显示稳定命令入口

shared 模式是推荐用法：微信和本地终端挂在同一条 shared 线程上，两边看到的是同一段对话。`npm run start` / `start:checkin` 仅用于最小本地调试，不建议用来观察真实 bridge 工作流。不要同时开多个 `cyberboss` bridge 进程。

## 微信命令

- `/bind /absolute/path` — 把当前聊天绑定到某个项目工作区
- `/status` — 当前工作区、线程、模型、上下文状态
- `/new` — 切到新线程草稿
- `/reread` — 重新加载最新人设模板和操作模板
- `/compact` — 让当前线程压缩上下文，并向微信回报开始/完成
- `/switch <threadId>` — 切到指定线程
- `/stop` — 停止当前运行中的 turn
- `/checkin <min>-<max>` — 调整当前项目的随机 pulse 唤醒区间
- `/chunk <number>` — 调整微信短回复片段的最小合并大小
- `/yes` — 本次批准放行
- `/always` — 当前项目内持续放行同类命令
- `/no` — 拒绝本次批准
- `/model` / `/model <id>` — 查看 / 切换模型
- `/star` — 在微信里显示 GitHub star 引导
- `/help` — 显示微信命令帮助

纯文本消息直接进绑定的线程。还没绑定就先 `/bind /absolute/path`。

## Agent 工具

模型不通过本地 CLI 调用能力，而是用项目原生的结构化工具。Claude Code 通过 workspace-local `.mcp.json`（启动时由 pulse 注入并带 `--mcp-config`）发现这些工具；Codex 通过 runtime 侧的 Cyberboss MCP bridge 加载。

统一回顾与决策：
`cyberboss_pulse_review` · `cyberboss_followup_decide`

Pool（title pool）：
`cyberboss_title_pool_add` · `cyberboss_title_pool_list` · `cyberboss_title_pool_review` · `cyberboss_title_pool_remove` · `cyberboss_title_pool_promote_to_reminder` · `cyberboss_title_pool_promote_to_memory`

Memory：
`cyberboss_memory_remember` · `cyberboss_memory_search` · `cyberboss_memory_list` · `cyberboss_memory_update` · `cyberboss_memory_forget` · `cyberboss_memory_complete`
` · `cyberboss_memory_reindex`

Reminder：
`cyberboss_reminder_create` · `cyberboss_reminder_list` · `cyberboss_reminder_complete`

Habit：
`cyberboss_habit_upsert` · `cyberboss_habit_list` · `cyberboss_habit_status_today` · `cyberboss_habit_history` · `cyberboss_habit_mark_done` · `cyberboss_habit_mark_incomplete` · `cyberboss_habit_mark_abandoned` · `cyberboss_habit_mark_skipped` · `cyberboss_habit_log_event` · `cyberboss_habit_suggest_next_action`

Diary / Timeline / 通道：
`cyberboss_diary_append` · `cyberboss_timeline_read` · `cyberboss_timeline_categories` · `cyberboss_timeline_proposals` · `cyberboss_timeline_write` · `cyberboss_timeline_build` · `cyberboss_timeline_serve` · `cyberboss_timeline_dev` · `cyberboss_timeline_screenshot` · `cyberboss_channel_send_file` · `cyberboss_system_send`

Obsidian：
`cyberboss_obsidian_status` · `cyberboss_obsidian_search` · `cyberboss_obsidian_recent` · `cyberboss_obsidian_read` · `cyberboss_obsidian_random_daily_excerpt`

Sticker：
`cyberboss_sticker_tags` · `cyberboss_sticker_pick` · `cyberboss_sticker_send` · `cyberboss_sticker_delete` · `cyberboss_sticker_save_from_inbox` · `cyberboss_sticker_update`

Whereabouts：
`whereabouts_current_stay` · `whereabouts_recent_stays` · `whereabouts_recent_moves` · `whereabouts_snapshot` · `whereabouts_summary`

Memory 数据模型说明：`type` 包括 `preference` / `fact` / `principle` / `relationship` / `project` / `wishseed` / `concern` 等。`wishseed` 和 `concern` 有生命周期——完成后加 `completedAt`，活动项只暴露 `id` / `type` / `subject` / `content` / `tags` / `source` / `createdAt` / `updatedAt`。其他类型用 `status: archived` 归档。

## 本地数据

默认状态目录：`${HOME}/.cyberboss`

- `accounts/` — 微信 bot 账号数据
- `sessions.json` — 工作区、线程、模型、批准状态
- `weixin-config.json` — 微信回复片段配置
- `sync-buffers/` — 微信长轮询同步缓冲
- `inbox/` — 收到的微信图片和附件
- `reminder-queue.json` — 提醒队列
- `title-pool.json` — pool 速记短清单
- `system-message-queue.json` — 系统/pulse 触发队列
- `deferred-system-replies.json` — 等待下一个可用微信 context token 的回复
- `checkin-config.json` — 保存的 pulse/check-in 唤醒区间
- `agent-memories.json` — 记忆
- `habit-definitions.json` / `habit-events.jsonl` / `habit-state.json` / `habit-heatmap.json` — 习惯定义、事件流、当日状态、热力图
- `stickers/`（`assets/`、`index.json`、`tags.json`）— 表情包资源与标签
- `weixin-instructions.md` — 首次运行生成的人设文件
- `diary/` — 本地日记
- `timeline/` — 时间线数据、站点、截图
- `locations.json` — whereabouts 位置数据
- `logs/` — shared bridge 与 shared runtime 日志

这是运行时状态目录，不是你的项目工作区。微信线程和终端线程仍应指向你真正的项目目录。

## 架构

- **core**：读配置、选 channel/runtime/集成、编排能力而非实现具体协议、own 触发语义（user message / pulse / reminder / approval）。
- **adapters/channel/**：收发消息、typing/media/context token，不碰 Codex/Claude 线程逻辑，也不碰 reminder/habit/memory/timeline/diary。
- **adapters/runtime/**：把消息送进具体 Agent runtime，处理线程/会话/批准/stop，注入模型侧指令层和项目原生工具。
- **services + habit**：reminder、habit、title-pool、memory、diary、obsidian、timeline、sticker、vision 等本地行为/状态模块，由 app/runtime 流程协调，而非各自独立成产品。
- **integrations/**：timeline、whereabouts 等外部集成，尽量依赖独立项目而非折回主仓库。

## 与原项目的差异

相对 [WenXiaoWendy/Cyberboss](https://github.com/WenXiaoWendy/Cyberboss)，本发行版（cyberboss-pulse）的重心从「全天候强外部监督的 ADHD Coach」收窄到「生活语境型轻度提醒」：保留 reminder / habit / timeline / diary / 微信桥接 / 双 runtime 等基础设施，但新增并强化了 memory（含 wishseed 种草/concern 担忧留存）、title-pool（上下文速记）、pulse 统一回顾、习惯建议引擎与最小可行版本、Obsidian 语境接入，并把默认闭合原则改成「未闭环就倾向于排提醒 / 存 pool，而不是嘴上记得」。它明确不竞争 Todo List，只补 Todo List 的盲区。

## License

本项目面向本地优先的个人部署，会持续处理高度敏感的私人聊天、提醒和生活轨迹。我不希望这套工作流被重新打包成隐藏代码路径和数据路径的闭源云服务，因此采用 `AGPL-3.0-only`：如果你修改、扩展并通过网络向用户提供，必须按 AGPL 条款公开全部对应源代码。

