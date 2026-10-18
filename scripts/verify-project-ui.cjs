const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owr-project-ui-'))
  const env = { ...process.env, OWR_UI_TEST_DIR: testDir }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env, stdio: 'inherit', windowsHide: true
  })
  if (path.dirname(testDir) === path.resolve(os.tmpdir()) && path.basename(testDir).startsWith('owr-project-ui-')) {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
const testDir = process.env.OWR_UI_TEST_DIR
const root = path.resolve(__dirname, '..')
app.setPath('userData', path.join(testDir, 'profile'))
app.disableHardwareAcceleration()
require('esbuild').buildSync({
  stdin: {
    contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import App from "./src/renderer/src/App.tsx"; import {initI18n} from "./src/renderer/src/lib/i18n.ts"; initI18n().then(()=>createRoot(document.getElementById("root")).render(React.createElement(App)));',
    resolveDir: root, loader: 'tsx'
  },
  bundle: true, format: 'iife', platform: 'browser', loader: { '.png': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' }, outfile: path.join(testDir, 'ui.js')
})
fs.writeFileSync(path.join(testDir, 'index.html'), '<div id="root"></div><script src="ui.js"></script>')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1000, height: 700,
    webPreferences: { preload: path.join(__dirname, 'fixtures/project-ui-preload.cjs'), contextIsolation: false, sandbox: false }
  })
  let failed = false
  const evaluate = code => win.webContents.executeJavaScript(code)
  const waitFor = async (code) => {
    const deadline = Date.now() + 5000
    while (!await evaluate(code)) {
      assert.ok(Date.now() < deadline, `UI condition timed out: ${code}`)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  const key = (key, shift = false) => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},ctrlKey:true,shiftKey:${shift},bubbles:true}))`)
  const edit = () => evaluate(`document.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}))`)
  try {
    await win.loadFile(path.join(testDir, 'index.html'))
    await waitFor('!!document.querySelector("select")')
    await key('s', true)
    await waitFor('window.__owrTest.saves.length === 1')
    await waitFor('document.querySelector("header").innerText.includes("Chosen Project.owrp")')
    await key('s')
    await waitFor('window.__owrTest.saves.length === 2')
    let state = await evaluate('JSON.parse(JSON.stringify(window.__owrTest))')
    assert.equal(state.saves[0].filePath, state.target)
    assert.equal(state.saves[1].filePath, state.target)
    assert.equal(state.dialogs, 1, 'Save after Save As must retain the absolute path without another dialog')

    await evaluate('window.__owrTest.failSave = true')
    await edit()
    await waitFor('document.querySelector("header").innerText.includes("*")')
    await key('s')
    await waitFor('document.body.innerText.includes("SIMULATED_DISK_FULL")')
    assert.ok(await evaluate('document.querySelector("header").innerText.includes("*")'))

    await evaluate('window.__owrTest.failSave = false; window.__owrTest.deferSave = true')
    await key('s')
    await waitFor('!!window.__owrTest.finishSave')
    await edit()
    await new Promise(resolve => setTimeout(resolve, 30))
    await evaluate('window.__owrTest.finishSave()')
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.ok(await evaluate('document.querySelector("header").innerText.includes("*")'), 'Edits made during a save must stay dirty')
    await evaluate('window.__owrTest.deferSave = false')
    await key('o')
    await waitFor('document.querySelector("header").innerText.includes("Opened.owrp")')
    await waitFor('!document.querySelector("header").innerText.includes("*")')
    await key('z')
    await key('s')
    await waitFor('window.__owrTest.saves.length === 5')
    state = await evaluate('JSON.parse(JSON.stringify(window.__owrTest))')
    assert.equal(state.saves[4].filePath, 'C:/OWR-Test/Opened.owrp')
    assert.equal(state.saves[4].data.tracks[0].name, 'Opened track-1', 'Undo after Open must not restore the previous project')
    await key('n')
    await waitFor('document.querySelector("header").innerText.includes("Unbenannt.owrp")')
    await key('z')
    await key('s')
    await waitFor('window.__owrTest.saves.length === 6')
    state = await evaluate('JSON.parse(JSON.stringify(window.__owrTest))')
    assert.equal(state.saves[5].data.tracks[0].regions.length, 0)
    assert.equal(state.saves[5].data.tracks[1].inputSource.type, 'device', 'New must retain the existing device defaults')
    await key('e')
    await waitFor('!!document.querySelector("form")')
    await evaluate('document.querySelector("form").dispatchEvent(new Event("submit", {bubbles:true,cancelable:true}))')
    await waitFor('window.__owrTest.exports.length === 1 && !document.querySelector("form")')
    state = await evaluate('JSON.parse(JSON.stringify(window.__owrTest))')
    assert.equal(state.exports[0].tracks.length, 4, 'UI export must forward the actual project tracks')
    assert.equal(state.exports[0].tracks[0].id, 'track-1')
    assert.equal(state.exports[0].settings.format, 'mp3')
    await evaluate('delete window.api.exportProject')
    await key('e')
    await waitFor('!!document.querySelector("form")')
    await evaluate('document.querySelector("form").dispatchEvent(new Event("submit", {bubbles:true,cancelable:true}))')
    await waitFor('document.body.innerText.includes("Audio-Export ist nicht verfügbar")')
    console.log('PASS: rendered project UI saves exact paths, reports failed writes, retains unsaved edits, and resets history on Open/New.')
  } catch (error) {
    console.error(error)
    failed = true
  } finally {
    win.destroy()
    app.exit(failed ? 1 : 0)
  }
}).catch(error => { console.error(error); app.exit(1) })
