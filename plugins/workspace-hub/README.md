# @cyrus/dsh-workspace-hub

工作区领域内核（架构书 v5）：把原生 DSH Workspace/Session、Project Control 项目与
Workbench 浏览目标统一成一份可订阅、带 revision 的工作区上下文。W0 阶段为只读骨架
（无 UI、无数据库写）；W1 起承载三种跟随模式与资源打开意图。

## Build

```powershell
npx pnpm@11.19.0 run check:plugins
```

## Install

```powershell
dsh plugin --profile web add @cyrus-dsh-workspace-hub-0.1.0-rc.7.tgz
# restart dsh
```

## License

MIT — see LICENSE.
