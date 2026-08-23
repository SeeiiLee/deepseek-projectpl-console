/**
 * @cyrus/dsh-workspace-hub Host 侧（W0 骨架）。
 * W0 无 UI、无数据库写、无 Host 资源能力：Hub 的只读 Context 投影在 Client 侧完成
 * （注入 sessions/workspaces）。W2 起本侧增加统一 Resource Host
 * （list/statMany/read/search/gitStatus/watch/saveText，架构书 §9.2）。
 */
interface HostContextLike {
  effect(factory: () => (() => void | Promise<void>) | void, label?: string): void
}

/** W0：不注入任何 Host 服务。 */
export const inject: readonly string[] = []

/** 注册 W0 骨架生命周期（无资源操作）。 */
export function apply(ctx: HostContextLike): void {
  ctx.effect(() => undefined, 'workspace-hub: W0 host skeleton (resource host lands in W2)')
}
