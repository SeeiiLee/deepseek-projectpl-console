/** Client placeholder：System Policy 是纯 Host 插件，客户端无 UI。 */
interface ClientContextLike { provide(name: string, value: unknown): void }
export const inject: string[] = []
export function apply(_ctx: ClientContextLike): void {}
