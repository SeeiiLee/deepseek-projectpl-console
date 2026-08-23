/** Client placeholder：P1 记忆工具为纯 Host 能力，客户端无 UI。 */
interface ClientContextLike { provide(name: string, value: unknown): void }
export const inject: string[] = []
export function apply(_ctx: ClientContextLike): void {}
