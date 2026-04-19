const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let mouseBridgeProcess = null;
let mouseBridgeKilled = false;

function findMouseBridgeExe() {
  const exeName = 'MouseBridge.exe';
  const tfms = ['net8.0-windows', 'net8.0', 'net10.0-windows', 'net10.0', 'net9.0-windows', 'net9.0'];
  const configs = ['Release', 'Debug'];

  const baseDirs = [__dirname];
  if (app.isPackaged && process.resourcesPath) {
    baseDirs.unshift(process.resourcesPath);
  }

  const roots = [];
  for (const base of baseDirs) {
    roots.push(path.join(base, 'MouseBridge'));
    roots.push(path.join(base, 'MouseBridge', 'MouseBridge'));
  }

  const tried = [];
  for (const root of roots) {
    for (const cfg of configs) {
      for (const tfm of tfms) {
        const candidate = path.join(root, 'bin', cfg, tfm, exeName);
        tried.push(candidate);
        if (fs.existsSync(candidate)) {
          return { exePath: candidate, tried };
        }
      }
    }
  }

  return { exePath: null, tried };
}

function startMouseBridge() {
  const { exePath, tried } = findMouseBridgeExe();

  if (!exePath) {
    console.warn('[MouseBridge] executable not found. Tried:', tried);
    return;
  }

  console.log('[MouseBridge] starting:', exePath);

  try {
    mouseBridgeProcess = spawn(exePath, [], {
      cwd: path.dirname(exePath),
      windowsHide: true,
      stdio: 'ignore',
    });

    mouseBridgeKilled = false;

    mouseBridgeProcess.on('error', (err) => {
      console.error('[MouseBridge] failed to start:', err);
      mouseBridgeProcess = null;
    });

    mouseBridgeProcess.on('exit', (code, signal) => {
      console.log('[MouseBridge] exited:', { code, signal });
      mouseBridgeProcess = null;
    });

    console.log('[MouseBridge] started with pid =', mouseBridgeProcess.pid);
  } catch (err) {
    console.error('[MouseBridge] startup error:', err);
    mouseBridgeProcess = null;
  }
}

function stopMouseBridge() {
  if (mouseBridgeKilled) return;
  mouseBridgeKilled = true;

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/IM', 'MouseBridge.exe', '/F', '/T'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else if (mouseBridgeProcess) {
      mouseBridgeProcess.kill('SIGTERM');
    }
  } catch (err) {
    console.error('[MouseBridge] shutdown error:', err);
  } finally {
    mouseBridgeProcess = null;
  }
}

ipcMain.handle('moto-duel:select-option', async (_event, payload) => {
  try {
    const message = String((payload && payload.message) || '');
    const defaultValue = payload && payload.defaultValue != null ? String(payload.defaultValue) : null;

    const lines = message.split('\n').map((line) => line.trim()).filter(Boolean);
    const options = [];
    let titleLine = '';

    for (const line of lines) {
      const match = line.match(/^(\d+)\.\s*(.+)$/);
      if (match) {
        options.push({ idx: Number(match[1]), label: match[2] });
      } else if (!titleLine) {
        titleLine = line;
      }
    }

    if (options.length === 0) {
      return defaultValue;
    }

    const buttons = options.map((option) => `${option.idx}. ${option.label}`);
    buttons.push('Cancel');

    let defaultId = 0;
    if (defaultValue != null) {
      const desired = Number(defaultValue);
      const matchedIndex = options.findIndex((option) => option.idx === desired);
      if (matchedIndex >= 0) defaultId = matchedIndex;
    }

    const parent = BrowserWindow.getFocusedWindow() || mainWindow;
    const { response } = await dialog.showMessageBox(parent, {
      type: 'question',
      message: titleLine || 'Select a mouse device',
      buttons,
      cancelId: buttons.length - 1,
      defaultId,
      noLink: true,
    });

    if (response === buttons.length - 1) {
      return null;
    }

    return String(options[response].idx);
  } catch (err) {
    console.error('[prompt] failed:', err);
    return null;
  }
});

const PROMPT_SHIM_JS = `
(function () {
  try {
    const { ipcRenderer } = require('electron');
    window.__motoDuelSelectOption = function (message, defaultValue) {
      try {
        return ipcRenderer.invoke('moto-duel:select-option', {
          message: message == null ? '' : String(message),
          defaultValue: defaultValue == null ? null : String(defaultValue),
        });
      } catch (err) {
        return Promise.resolve(null);
      }
    };
    console.log('[MotoDuel] prompt shim ready');
  } catch (err) {
    console.error('[MotoDuel] prompt shim failed', err);
  }
})();
`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Moto Duel',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(PROMPT_SHIM_JS);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopMouseBridge();
  });
}

app.whenReady().then(() => {
  startMouseBridge();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopMouseBridge();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', stopMouseBridge);

process.on('exit', stopMouseBridge);
process.on('SIGINT', () => { stopMouseBridge(); app.quit(); });
process.on('SIGTERM', () => { stopMouseBridge(); app.quit(); });
