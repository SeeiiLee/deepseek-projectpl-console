const { contextBridge, ipcRenderer, webUtils } = require('electron')

const invokeUpdate = (action, payload) => ipcRenderer.invoke('dsh-personal:update', { action, payload })
const invokeBrowserView = (action, payload) => ipcRenderer.invoke('dsh-personal:browser-view', { action, payload })

contextBridge.exposeInMainWorld('deepseekHarnessPersonal', Object.freeze({
  desktop: Object.freeze({
    getState: () => ipcRenderer.invoke('dsh-personal:desktop', { action: 'get-state' }),
    configure: settings => ipcRenderer.invoke('dsh-personal:desktop', { action: 'configure', payload: settings }),
    repairShortcuts: () => ipcRenderer.invoke('dsh-personal:desktop', { action: 'repair-shortcuts' }),
    revealInExplorer: path => ipcRenderer.invoke('dsh-personal:desktop', { action: 'reveal-in-explorer', payload: path }),
    openPath: path => ipcRenderer.invoke('dsh-personal:desktop', { action: 'open-path', payload: path }),
    openExternal: url => ipcRenderer.invoke('dsh-personal:desktop', { action: 'open-external', payload: url }),
    readFileAsDataURL: path => ipcRenderer.invoke('dsh-personal:desktop', { action: 'read-file-as-data-url', payload: path }),
    getPathForFile: file => webUtils.getPathForFile(file),
  }),
  updates: Object.freeze({
    getState: () => invokeUpdate('get-state'),
    configure: settings => invokeUpdate('configure', settings),
    check: () => invokeUpdate('check'),
    downloadDesktop: () => invokeUpdate('download-desktop'),
    installDesktop: () => invokeUpdate('install-desktop'),
    rollbackDesktop: () => invokeUpdate('rollback-desktop'),
    prepareHarness: () => invokeUpdate('prepare-harness'),
    activateHarness: () => invokeUpdate('activate-harness'),
    rollbackHarness: () => invokeUpdate('rollback-harness'),
    preparePluginGeneration: () => invokeUpdate('prepare-plugin-generation'),
    rollbackPluginGeneration: () => invokeUpdate('rollback-plugin-generation'),
    removePluginGeneration: () => invokeUpdate('remove-plugin-generation'),
    previewPluginPurge: () => invokeUpdate('preview-plugin-purge'),
    purgePluginGeneration: token => invokeUpdate('purge-plugin-generation', token),
    previewPluginGC: () => invokeUpdate('preview-plugin-gc'),
    gcPluginGenerations: token => invokeUpdate('gc-plugin-generations', token),
    openRelease: kind => invokeUpdate('open-release', kind),
  }),
  billing: Object.freeze({
    open: () => ipcRenderer.invoke('dsh-personal:billing', { action: 'open' }),
  }),
  browserView: Object.freeze({
    create: url => invokeBrowserView('create', url === undefined ? undefined : { url }),
    dispose: id => invokeBrowserView('dispose', { id }),
    setBounds: (id, rect) => invokeBrowserView('set-bounds', { id, ...rect }),
    navigate: (id, url) => invokeBrowserView('navigate', { id, url }),
    goBack: id => invokeBrowserView('go-back', { id }),
    goForward: id => invokeBrowserView('go-forward', { id }),
    reload: id => invokeBrowserView('reload', { id }),
    getState: id => invokeBrowserView('get-state', { id }),
    capture: id => invokeBrowserView('capture', { id }),
    onEvent: listener => {
      const wrapped = (_event, payload) => { listener(payload) }
      ipcRenderer.on('dsh-personal:browser-view-event', wrapped)
      return () => { ipcRenderer.removeListener('dsh-personal:browser-view-event', wrapped) }
    },
  }),
  projectControl: Object.freeze({
    selectDirectory: kind => ipcRenderer.invoke('dsh-personal:project-control', {
      action: 'select-directory',
      kind,
    }),
  }),
}))
