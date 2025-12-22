import { app, BrowserWindow } from 'electron';

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nativeWindowOpen: true,
    },
  });

  win.loadFile('public/index.html');
}

app.whenReady().then(async () => {
  try {
    await import('./src/index.js');
  } catch (e) {
    console.warn('API no iniciada dentro de Electron:', e && e.message ? e.message : e);
  }
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
