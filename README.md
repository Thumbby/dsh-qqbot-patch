# dsh-qqbot 消息体验补丁

本项目是基于https://github.com/tencent-connect/dsh-qqbot优化的一个DeepSeek Harness二次插件补丁，完全使用DeepSeek Harness开发，仅允许个人使用。

## 补丁介绍

让 QQ 机器人像真人一样聊天：

1. **你连发几条消息**（比如先发图、再发文字），它只当成一件事，回一次
2. **它自己回话时，按换行拆成多条发**，不再一大坨

适配版本（打补丁时实测）：

| 项 | 版本 |
|---|---|
| `@tencent-connect/dsh-qqbot` | 0.5.3 |
| Node | v26.13.0 |
| DSH | 0.2.1-rc.5 |

新版插件大概率也能用，但**升级后必须重跑 `apply.mjs`**（见下文）。

---

## 一、它改了什么

### 1. 连续消息合并（debounceMerge）

新增中间件 `gateway/debounce-merge.js`，注册在 `gateway/middleware-setup.js` 里、`concurrencyGuard` 之前：

- 同一会话（私聊 / 群）收到消息后先等 **1.5 秒** 窗口
- 窗口内后续消息追加到同一轮，图片附件也一起合并
- 窗口结束只处理一次 → 只回一次

> 原来插件自带的 `concurrencyGuard(strategy: 'merge')` 只在「正在处理中」才合并，机器人空闲时第一条会立刻处理，所以「发图 + 发文字」会被拆成两轮。这个补丁补上了空闲时的合并窗口。

### 2. 回复按换行拆条（splitMessageBlocks）

新增 `transport/split-message.js`，替换 `outbound.js` 和 `outbound-buffer.js` 里的 `chunkMarkdownText`：

- 每个非空行单独发一条 QQ 消息
- 代码块（``` 包裹）整体保留，不拆
- 单行超过 `textChunkLimit`（默认 4500）时回退到原来的切分逻辑

配套配置：profile 的 `cordis.patch.yml` 里 `im-qqbot.streaming: false`（关掉流式，否则私聊走流式会重新变成一大条）。

---

## 二、目录结构

```
.
├── apply.mjs                # 补丁脚本（幂等，可重复跑）
├── debounce-merge.js        # 新中间件源码（会被复制进插件 dist）
├── split-message.js         # 拆条函数源码（会被复制进插件 dist）
├── README.md                # 就是本文件
├── version.json             # 打补丁时的版本快照
├── original/                # 打补丁前的原始文件（来自 .dshbak）
│   ├── gateway/middleware-setup.js
│   └── transport/outbound.js、outbound-buffer.js
├── patched/                 # 打补丁后的完整文件（含新增的两个模块）
│   ├── gateway/debounce-merge.js、middleware-setup.js
│   └── transport/split-message.js、outbound.js、outbound-buffer.js
└── diff/                    # 三个原文件的 unified diff
```

**日常只需要 `apply.mjs` 和两个 `*.js` 新模块**；`original/`、`patched/`、`diff/` 是给「脚本失效时手动改」用的对照。

---

## 三、怎么用

插件装在哪里（按 DSH 官方布局）：

```
~/.dsh/profiles/web/node_modules/@tencent-connect/dsh-qqbot/dist
```

### 正常应用

```bash
cd qqbot-patch-export
node apply.mjs            # 打补丁（已打过会跳过）
node apply.mjs --dry-run  # 只看会改什么
node apply.mjs --revert   # 还原到备份
```

改完不需要手动重启 `dsh web`——实测插件目录被 watch，保存后自动热重载。不放心就重启一次。

### 插件升级后

升级（`pnpm install` / `dsh plugin`）会把 `dist` 覆盖回原版：

```bash
cd qqbot-patch-export
node apply.mjs
```

脚本靠文件内的 `DSH-QQBOT-PATCH` 标记判断是否已打过补丁，所以重复跑是安全的。

**如果新版本改动了 `middleware-setup.js` / `outbound.js` / `outbound-buffer.js` 的关键行**，脚本会报 `FAILED: no change ...`，这时拿 `diff/` 下的三个 patch 手工对一下新版文件，再把对应的 import 和调用替换掉（改动很小，基本就 3 处）。

### 手工应用（脚本不适用时）

对照 `diff/*.patch` 手工做 5 步：

1. 把 `debounce-merge.js` 放到 `dist/gateway/`
2. 把 `split-message.js` 放到 `dist/transport/`
3. `gateway/middleware-setup.js`：加一行 `import { debounceMerge } from "./debounce-merge.js";`，并在 `bot.use(questionAnswer(manager));` 后面加 `bot.use(debounceMerge({ windowMs: 1500 }));`
4. `transport/outbound.js`：加 import，把 `chunkMarkdownText(text, this.config.textChunkLimit)` 换成 `splitMessageBlocks(text, this.config.textChunkLimit)`
5. `transport/outbound-buffer.js`：加 import，把 `chunkMarkdownText(this.buffer, this.limit)` 换成 `splitMessageBlocks(this.buffer, this.limit)`

另外 profile `cordis.patch.yml` 的 `im-qqbot` 段加一行：

```yaml
    streaming: false # 私聊关流式，改用逐条发送
```

---

## 四、验证

1. **拆条**：让机器人回一句带换行的话，应该看到多个气泡，一行一个
2. **合并**：发一张图，紧接着 2 秒内再发一段文字，应该只回一次
3. 代码块里的换行不应该被拆成多条

## 五、注意 / 已知限制

- 合并窗口 1.5 秒：超过这个时间才发第二条，还是会分成两轮
- 消息条数变多，可能撞 QQ 的发送频率限制（插件内置 `replyLimiter`，超了会丢）
- 群聊同样生效（拆条 + 合并）
- 改的是 `node_modules` 产物，不是源码包；`pnpm install` 后需重跑脚本
- 备份文件后缀 `.dshbak` 在插件目录里，升级时可能被清掉，所以这里保留 `original/` 副本

## 六、回滚

```bash
node apply.mjs --revert
```

或直接把 `original/` 下三个文件覆盖回插件目录，并删掉 `debounce-merge.js`、`split-message.js`、以及 profile 里的 `streaming: false`。
