#!/usr/bin/env node
/**
 * DSH QQ 插件补丁脚本
 *
 * 1) 连续消息合并：同一 peer 窗口期内的消息并成一条处理（debounceMerge）
 * 2) 回复按换行拆条：每个非空行单独发一条消息（splitMessageBlocks，代码块不拆）
 * 3) 私聊关闭流式输出，让回复走静态逐条发送
 *
 * 用法：
 *   node apply.mjs            # 打补丁
 *   node apply.mjs --dry-run  # 只看会改什么
 *   node apply.mjs --revert   # 还原（.dshbak 备份）
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME;
const PLUGIN_DIST = join(HOME, '.dsh/profiles/web/node_modules/@tencent-connect/dsh-qqbot/dist');
const PROFILE_YML = join(HOME, '.dsh/profiles/web/cordis.patch.yml');
const MARK = 'DSH-QQBOT-PATCH';

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry-run');
const revert = args.has('--revert');

const fails = [];
function check(cond, msg) { if (!cond) fails.push(msg); return cond; }

function backup(path) {
  const bak = `${path}.dshbak`;
  if (!existsSync(bak)) copyFileSync(path, bak);
}

function patchFile(relPath, marker, apply) {
  const path = join(PLUGIN_DIST, relPath);
  if (!check(existsSync(path), `missing ${path}`)) return;
  const src = readFileSync(path, 'utf8');
  if (revert) {
    const bak = `${path}.dshbak`;
    if (existsSync(bak)) {
      if (!dry) copyFileSync(bak, path);
      console.log(`revert ${relPath}`);
    }
    return;
  }
  if (src.includes(marker)) {
    console.log(`skip   ${relPath} (already patched)`);
    return;
  }
  const next = apply(src);
  if (!check(typeof next === 'string' && next !== src, `no change ${relPath}`)) return;
  if (!dry) { backup(path); writeFileSync(path, next); }
  console.log(`patch  ${relPath}`);
}

// 1) 新增两个模块文件
function installModule(from, toRel) {
  const to = join(PLUGIN_DIST, toRel);
  if (revert) { console.log(`revert ${toRel}`); return; }
  if (dry) { console.log(`write  ${toRel}`); return; }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(here, from), to);
  console.log(`write  ${toRel}`);
}

installModule('debounce-merge.js', 'gateway/debounce-merge.js');
installModule('split-message.js', 'transport/split-message.js');

// 2) middleware-setup：注册 debounceMerge
patchFile('gateway/middleware-setup.js', `${MARK}: debounce`, (src) => {
  const importLine = `import { debounceMerge } from "./debounce-merge.js"; // ${MARK}: debounce\n`;
  let out = src.replace(
    `import { getHistoryStore, historyGroupKey } from "../features/history-store.js";`,
    `import { getHistoryStore, historyGroupKey } from "../features/history-store.js";\n${importLine.trim()}`,
  );
  out = out.replace(
    '    bot.use(questionAnswer(manager));\n',
    '    bot.use(questionAnswer(manager));\n    // DSH-QQBOT-PATCH: 同 peer 窗口期内的连续消息合并成一条\n    bot.use(debounceMerge({ windowMs: 10000, attachmentWindowMs: 20000 }));\n',
  );
  return out;
});

// 3) outbound：静态发送按行拆条
patchFile('transport/outbound.js', `${MARK}: split`, (src) => {
  let out = src.replace(
    `import { chunkMarkdownText } from "./chunker.js";`,
    `import { chunkMarkdownText } from "./chunker.js";\nimport { splitMessageBlocks } from "./split-message.js"; // ${MARK}: split`,
  );
  out = out.replace(
    'const chunks = chunkMarkdownText(text, this.config.textChunkLimit);',
    'const chunks = splitMessageBlocks(text, this.config.textChunkLimit);',
  );
  return out;
});

// 4) outbound-buffer：流式 flush 降级路径同样拆条
patchFile('transport/outbound-buffer.js', `${MARK}: split`, (src) => {
  let out = src.replace(
    `import { chunkMarkdownText } from "./chunker.js";`,
    `import { chunkMarkdownText } from "./chunker.js";\nimport { splitMessageBlocks } from "./split-message.js"; // ${MARK}: split`,
  );
  out = out.replace(
    'const chunks = chunkMarkdownText(this.buffer, this.limit);',
    'const chunks = splitMessageBlocks(this.buffer, this.limit);',
  );
  return out;
});

// 5) profile 配置：私聊关闭流式
if (existsSync(PROFILE_YML)) {
  const src = readFileSync(PROFILE_YML, 'utf8');
  if (revert) {
    if (src.includes('streaming: false')) {
      const next = src.replace(/\n\s*streaming: false[^\n]*\n/, '\n');
      if (!dry) writeFileSync(PROFILE_YML, next);
      console.log('revert profile streaming');
    }
  } else if (src.includes('streaming: false')) {
    console.log('skip   profile (streaming: false already set)');
  } else {
    const next = src.replace(
      /(\n\s*requireMention: false\n)/,
      '$1    streaming: false # DSH-QQBOT-PATCH: 私聊关流式，改用逐条发送\n',
    );
    if (next !== src) {
      if (!dry) writeFileSync(PROFILE_YML, next);
      console.log('patch  profile streaming: false');
    } else {
      fails.push('profile: requireMention line not found, add streaming: false manually');
    }
  }
} else {
  fails.push(`profile not found: ${PROFILE_YML}`);
}

if (fails.length > 0) {
  console.error('\nFAILED:');
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n${dry ? 'dry-run' : 'done'} — 重启 dsh web 后生效`);
