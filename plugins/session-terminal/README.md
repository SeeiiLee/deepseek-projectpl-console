# Session Terminal

`@cyrus/dsh-session-terminal` is the two-sided PowerShell terminal plugin for DeepSeek Harness Personal.

The Host half exposes a loopback-only `/__personal/terminal` JSON API. It uses Harness `ctx.subprocess` for executable resolution and uses its PTY allocation on supported systems. Harness rc.5 intentionally rejects terminal inspection on Windows, so the Windows path loads the same `node-pty` installation owned by upstream `subprocess-local` and adds a narrow ConPTY handle inside this plugin. A terminal is bound to one Harness session and always starts in the Host-authoritative `session.header.cwd`; callers cannot select another executable or working directory. Closing or restarting first uses node-pty's console-list cleanup and falls back to exact-PID `taskkill /T /F`; plugin unload joins every tab, and the desktop Job Object remains the final whole-application cleanup owner.

The Client half contributes an additive `shell.overlay` bottom dock. It supports collapse/expand, multiple tabs, bounded command history, display clearing, interruption, restart, close, and cursor-based output recovery after a renderer reload or temporary HTTP disconnect.

## Bounds and lifecycle

- At most 8 tabs per Harness session and 32 tabs per Host process.
- Each terminal retains at most 1,048,576 plain-text code units and 65,536 command-history code units.
- Each input submission is limited to 16 KiB and the HTTP body to 64 KiB.
- Output is converted from terminal control sequences to bounded plain text before it crosses the browser API.
- Terminals survive panel collapse, session switching, and renderer reload. They end when explicitly closed or when the Harness Host exits.

## Known limitations

The dock is a line-oriented PowerShell console rather than a full VT emulator. Interactive full-screen programs that depend on cursor addressing are intentionally outside this plugin; the retained plain-text output keeps reconnect and memory behavior deterministic. Host restart cannot preserve an operating-system PTY, so only reconnects to the same running Host retain the process.
