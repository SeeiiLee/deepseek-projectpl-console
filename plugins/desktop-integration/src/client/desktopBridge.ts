export interface DesktopIntegrationState {
  appName: string
  appVersion: string
  packaging: 'development' | 'portable' | 'nsis'
  trayAvailable: boolean
  closeToTray: boolean
  maintainShortcuts: { desktop: boolean; startMenu: boolean }
  shortcuts: ReadonlyArray<{ location: 'desktop' | 'startMenu'; path: string; managed: boolean; exists: boolean }>
  processGuardian: {
    active: boolean
    strategy: 'windows-job-object' | 'graceful-and-tree-fallback'
    helperAssigned: boolean
  }
}

export interface DesktopIntegrationBridge {
  getState(): Promise<DesktopIntegrationState>
  configure(settings: { closeToTray: boolean; maintainShortcuts: { desktop: boolean; startMenu: boolean } }): Promise<DesktopIntegrationState>
  repairShortcuts(): Promise<DesktopIntegrationState>
}

declare global {
  interface Window {
    deepseekHarnessPersonal?: {
      desktop?: DesktopIntegrationBridge
    }
  }
}

export function requireDesktopBridge(): DesktopIntegrationBridge {
  const bridge = window.deepseekHarnessPersonal?.desktop
  if (bridge === undefined) throw new Error('桌面集成服务只在 Personal 客户端中可用。')
  return bridge
}
