const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');

// Escolha uma das opções:
// OPÇÃO A: Se instalou via npm
const ytDlp = require('yt-dlp-exec');

// OPÇÃO B: Se instalou manualmente
// const { exec } = require('child_process');
// const util = require('util');
// const execPromise = util.promisify(exec);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        frame: true,
        transparent: true,
        resizable: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
            allowRunningInsecureContent: true,
            backgroundThrottling: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

// === HANDLER PARA EXTRAIR URL DO STREAM (NÃO BAIXA) ===
ipcMain.handle('GET_YOUTUBE_STREAM_URL', async (event, videoId) => {
    try {
        console.log(`🔍 Extraindo stream para: ${videoId}`);
        
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        // === OPÇÃO A: Usando yt-dlp-exec (npm) ===
        const info = await ytDlp(videoUrl, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            format: 'bestaudio/best'
        });
        
        // Pega a URL direta do stream de áudio
        const streamUrl = info.url || info.formats.find(f => f.acodec !== 'none')?.url;
        
        if (!streamUrl) {
            throw new Error('URL do stream não encontrada');
        }
        
        console.log('✅ Stream URL extraída com sucesso');
        
        return { 
            success: true, 
            url: streamUrl,
            title: info.title,
            duration: info.duration
        };
        
        /* === OPÇÃO B: Usando yt-dlp manual ===
        const command = `yt-dlp -f bestaudio --get-url "${videoUrl}"`;
        const { stdout } = await execPromise(command, { timeout: 15000 });
        
        const streamUrl = stdout.trim();
        
        return { 
            success: true, 
            url: streamUrl
        };
        */
        
    } catch (error) {
        console.error('❌ Erro ao extrair stream:', error.message);
        
        return { 
            success: false, 
            error: error.message,
            needsInstall: error.message.includes('yt-dlp')
        };
    }
});

app.whenReady().then(() => {
    createWindow();

    // Bypass de restrições do YouTube
    const filter = { urls: ['*://*/*'] };

    session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        if (details.url.includes('youtube.com') || details.url.includes('googlevideo.com')) {
            details.requestHeaders['Referer'] = 'https://www.youtube.com/';
            details.requestHeaders['Origin'] = 'https://www.youtube.com';
            details.requestHeaders['User-Agent'] = 
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
            delete details.requestHeaders['Electron'];
        }
        callback({ requestHeaders: details.requestHeaders });
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

console.log('🚀 Neo-Winamp iniciado!');