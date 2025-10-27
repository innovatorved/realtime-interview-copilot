const { app, BrowserWindow, desktopCapturer, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    transparent: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
    },
  });

  mainWindow.setContentProtection(true);

  mainWindow.loadURL('http://localhost:3000');
}

ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return sources.map(source => {
    return {
      id: source.id,
      name: source.name,
    };
  });
});

ipcMain.on('minimize', () => {
  BrowserWindow.getFocusedWindow().minimize();
});

ipcMain.on('maximize', () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.on('close', () => {
  BrowserWindow.getFocusedWindow().close();
});

ipcMain.on('set-always-on-top', (event, isAlwaysOnTop) => {
  BrowserWindow.getFocusedWindow().setAlwaysOnTop(isAlwaysOnTop);
});

ipcMain.on('set-opacity', (event, opacity) => {
  BrowserWindow.getFocusedWindow().setOpacity(opacity);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
