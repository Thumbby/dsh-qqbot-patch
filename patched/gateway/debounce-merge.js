/**
 * DSH-QQBOT-PATCH: 连续消息合并
 *
 * 同一会话（c2c / group）在一个窗口期内连续发来的消息合并成一条，
 * 合并后的内容交给后续中间件（附件下载、envelope 组装）处理一次。
 * 解决「先发图/文件、再发说明」被拆成两轮回复的问题。
 *
 * 窗口按消息类型区分：带附件（图片/文件/视频）的消息等更久，
 * 因为发完文件后通常还要补一句描述；纯文字等得短一点，不至于反应迟钝。
 */
export function debounceMerge({ windowMs = 10000, attachmentWindowMs = 20000 } = {}) {
    const groups = new Map();

    const hasAttachment = (ctx) => {
        const attachments = ctx.message?.attachments;
        return Array.isArray(attachments) && attachments.length > 0;
    };

    const finish = (key) => {
        const group = groups.get(key);
        if (group === undefined)
            return;
        groups.delete(key);
        clearTimeout(group.timer);
        group.resolve();
    };

    return async (ctx, next) => {
        const target = ctx.message?.replyTarget;
        if (target === undefined)
            return next();
        const key = `${target.scope}:${target.targetId}`;
        const myWindow = hasAttachment(ctx) ? attachmentWindowMs : windowMs;
        const group = groups.get(key);

        if (group !== undefined) {
            group.ctxs.push(ctx);
            const first = group.ctxs[0];
            const content = ctx.message.content ?? "";
            if (content !== "") {
                first.message.content = `${first.message.content ?? ""}\n${content}`;
            }
            const attachments = ctx.message.attachments ?? [];
            if (attachments.length > 0) {
                first.message.attachments = [...(first.message.attachments ?? []), ...attachments];
            }
            // 组内只要出现过附件，窗口就按长的那档算
            group.windowMs = Math.max(group.windowMs, myWindow);
            clearTimeout(group.timer);
            group.timer = setTimeout(() => finish(key), group.windowMs);
            return;
        }

        const nextGroup = { ctxs: [ctx], windowMs: myWindow, timer: undefined, resolve: undefined };
        groups.set(key, nextGroup);
        await new Promise((resolve) => {
            nextGroup.resolve = resolve;
            nextGroup.timer = setTimeout(() => finish(key), nextGroup.windowMs);
        });
        return next();
    };
}
