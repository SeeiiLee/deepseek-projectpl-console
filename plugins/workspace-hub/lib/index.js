//#region src/index.ts
/** W0：不注入任何 Host 服务。 */
const inject = [];
/** 注册 W0 骨架生命周期（无资源操作）。 */
function apply(ctx) {
	ctx.effect(() => void 0, "workspace-hub: W0 host skeleton (resource host lands in W2)");
}
//#endregion
export { apply, inject };
