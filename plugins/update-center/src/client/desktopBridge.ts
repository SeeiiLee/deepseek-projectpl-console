export type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'blocked' | 'preparing' | 'ready' | 'error' | 'unsupported'

export interface UpdateSettings {
  desktopRepository: string
  harnessRepository: string
  pluginRepository: string
  channel: 'stable' | 'beta'
  autoCheck: boolean
}

export interface DesktopUpdateState {
  currentVersion: string
  packaging: 'development' | 'portable' | 'nsis'
  status: UpdateStatus
  latestVersion?: string
  releaseName?: string
  releaseNotes?: string
  publishedAt?: string
  releaseUrl?: string
  progressPercent?: number
  canDownload: boolean
  canInstall: boolean
  canRollbackDesktop: boolean
  message?: string
}

export interface HarnessUpdateState {
  sourceRoot: string
  repository: string
  currentCommit?: string
  remoteCommit?: string
  previousCommit?: string
  preparedCommit?: string
  status: UpdateStatus
  dirty: boolean
  canPrepare: boolean
  canActivate: boolean
  canRollback: boolean
  message?: string
}

export interface BundledPluginState {
  packageName: string
  version: string
  updateWithDesktop: boolean
  generationId?: string
  pendingVersion?: string
}

export interface PluginChannelEntry {
  packageName: string
  version: string
  assetName: string
  assetSize: number
  sha256: string
  minClient: string
  compatibleHarness: {
    versionRange: string
    commits: string[]
  }
  seams?: string[]
  requires?: string[]
  externalEligible: boolean
  currentVersion?: string
  newer?: boolean
  blockedReason?: string
}

export interface PluginChannelState {
  status: UpdateStatus
  current: readonly BundledPluginState[]
  available: readonly PluginChannelEntry[]
  blocked: readonly PluginChannelEntry[]
  canRollback: boolean
  message?: string
}

export interface UpdateCenterState {
  settings: UpdateSettings
  lastCheckedAt?: string
  desktop: DesktopUpdateState
  harness: HarnessUpdateState
  plugins: readonly BundledPluginState[]
  pluginChannel: PluginChannelState
}

export interface UpdateCenterBridge {
  getState(): Promise<UpdateCenterState>
  configure(settings: UpdateSettings): Promise<UpdateCenterState>
  check(): Promise<UpdateCenterState>
  downloadDesktop(): Promise<UpdateCenterState>
  installDesktop(): Promise<void>
  rollbackDesktop(): Promise<void>
  prepareHarness(): Promise<UpdateCenterState>
  activateHarness(): Promise<void>
  rollbackHarness(): Promise<void>
  preparePluginGeneration(): Promise<UpdateCenterState>
  rollbackPluginGeneration(): Promise<UpdateCenterState>
  removePluginGeneration(): Promise<UpdateCenterState>
  previewPluginPurge(): Promise<{ token: string; externalGenerations: number; quarantineItems: number; wouldRemoveBusinessData: boolean }>
  purgePluginGeneration(token: string): Promise<UpdateCenterState>
  openRelease(kind: 'desktop' | 'harness'): Promise<void>
}

declare global {
  interface Window {
    deepseekHarnessPersonal?: {
      updates?: UpdateCenterBridge
    }
  }
}

/** Resolve the narrow context-isolated update bridge exposed by the desktop shell. */
export function requireUpdateBridge(): UpdateCenterBridge {
  const bridge = window.deepseekHarnessPersonal?.updates
  if (bridge === undefined) {
    throw new Error('更新服务只在 DeepSeek Harness Personal 桌面客户端中可用。')
  }
  return bridge
}
