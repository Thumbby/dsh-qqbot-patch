import { chunkMarkdownText } from "./chunker.js";

/**
 * DSH-QQBOT-PATCH: 按行为单位拆成多条消息。
 *
 * - 每个非空行单独成条
 * - 代码块（```）整体保留，不拆开
 * - 单行超过上限时回退到 chunkMarkdownText
 */
export function splitMessageBlocks(text, limit) {
    const lines = text.split(/\r?\n/);
    const out = [];
    let code = null;

    const push = (value) => {
        if (value.trim() !== "")
            out.push(value);
    };

    for (const line of lines) {
        if (/^\s*```/.test(line)) {
            if (code === null) {
                code = [line];
            }
            else {
                code.push(line);
                push(code.join("\n"));
                code = null;
            }
            continue;
        }
        if (code !== null) {
            code.push(line);
            continue;
        }
        if (line.trim() === "")
            continue;
        if (line.length > limit) {
            for (const chunk of chunkMarkdownText(line, limit))
                push(chunk);
        }
        else {
            push(line);
        }
    }
    if (code !== null)
        push(code.join("\n"));
    return out.length > 0 ? out : [text];
}
