/**
 * DSH-QQBOT-PATCH: 连续消息合并
 *
 * 同一会话（c2c / group）在一个窗口期内连续发来的消息合并成一条，
 * 合并后的内容交给后续中间件（附件下载、envelope 组装）处理一次。
 * 解决「先发图、再发说明」被拆成两轮回复的问题。
 */
export function debounceMerge({ windowMs = 1500 } = {}) {
    const groups = new Map();

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
            clearTimeout(group.timer);
            group.timer = setTimeout(() => finish(key), windowMs);
            return;
        }

        const nextGroup = { ctxs: [ctx], timer: undefined, resolve: undefined };
        groups.set(key, nextGroup);
        await new Promise((resolve) => {
            nextGroup.resolve = resolve;
            nextGroup.timer = setTimeout(() => finish(key), windowMs);
        });
        return next();
    };
}
