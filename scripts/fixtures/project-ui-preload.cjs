window.__owrTest = { saves: [], exports: [], dialogs: 0, failSave: false, deferSave: false, target: 'C:/OWR-Test/Chosen Project.owrp' }
window.confirm = () => true
Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] })
window.api = {
  getSettings: async () => ({ language: 'de' }),
  getLocales: async () => ({}),
  getAppVersion: async () => 'test',
  isMaximized: async () => false,
  getAudioProcesses: async () => [],
  getStartupFile: async () => null,
  onOpenProjectFromAssociation: () => () => {},
  onMaximizeChange: () => () => {},
  exportProject: async (tracks, settings) => {
    window.__owrTest.exports.push({ tracks, settings })
    return { success: true, path: settings.path }
  },
  showSaveDialog: async () => {
    window.__owrTest.dialogs++
    return { canceled: false, filePath: window.__owrTest.target }
  },
  showOpenDialog: async () => ({ canceled: false, filePaths: ['C:/OWR-Test/Opened.owrp'] }),
  loadProject: async filePath => ({
    success: true, filePath, data: {
      ...window.__owrTest.saves[0].data,
      tracks: window.__owrTest.saves[0].data.tracks.map(track => ({ ...track, name: `Opened ${track.id}`, regions: [] }))
    }
  }),
  saveProject: async (filePath, data) => {
    const state = window.__owrTest
    state.saves.push({ filePath, data })
    if (state.deferSave) await new Promise(resolve => { state.finishSave = resolve })
    return state.failSave ? { success: false, error: 'SIMULATED_DISK_FULL' } : { success: true, filePath }
  }
}
