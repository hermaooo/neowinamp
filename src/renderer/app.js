const path = require('path');
const Webamp = require('webamp');
const { ipcRenderer } = require('electron');
const ytSearch = require('yt-search'); 

// === VARIÁVEIS GLOBAIS ===
let isPlayerReady = false;
let selectedTracks = new Set();
let searchResults = [];

// Sistema de carregamento em background
let trackLoadingQueue = new Map(); // videoId -> { status: 'loading'|'ready'|'error', url: string, metadata: {} }
let isLoadingInBackground = false;

// === CONFIGURAÇÕES (localStorage) ===
const defaultSettings = {
    audioQuality: 'bestaudio',
    autoCloseSelector: true,
    showWarnings: true,
    autoPlay: true,
    resultsLimit: 25
};

let settings = { ...defaultSettings };

function loadSettings() {
    try {
        const saved = localStorage.getItem('neowinamp-settings');
        if (saved) {
            settings = { ...defaultSettings, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.error('Erro ao carregar configurações:', e);
    }
}

function saveSettings() {
    try {
        localStorage.setItem('neowinamp-settings', JSON.stringify(settings));
        console.log('✅ Configurações salvas');
    } catch (e) {
        console.error('Erro ao salvar configurações:', e);
    }
}

loadSettings();

// === 1. INICIALIZAÇÃO SIMPLES ===
window.onYouTubeIframeAPIReady = function() {
    console.log('📺 YouTube API carregada (não será usada)');
    isPlayerReady = true;
};

// === 2. LOADING SCREEN ===
function showLoading(text, details = '') {
    const loadingScreen = document.getElementById('loading-screen');
    const loadingText = document.getElementById('loading-text');
    const loadingDetails = document.getElementById('loading-details');
    
    if (loadingScreen && loadingText && loadingDetails) {
        loadingText.textContent = text;
        loadingDetails.textContent = details;
        loadingScreen.classList.remove('hidden');
    }
}

function hideLoading() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.classList.add('hidden');
    }
}

// === 3. WEBAMP ===
const webamp = new Webamp({
    initialTracks: [],
    availableSkins: [{ url: "assets/default.wsz", name: "Winamp Classic" }]
});

// === 4. BUSCA NO YOUTUBE ===
const searchInput = document.getElementById('yt-search');
const searchBtn = document.getElementById('btn-search');
const playlistTree = document.getElementById('playlist-tree');
const selectionBar = document.getElementById('selection-bar');
const selectedCountEl = document.getElementById('selected-count');

async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) {
        alert('⚠️ Digite algo para buscar!');
        return;
    }

    playlistTree.innerHTML = '<li style="color: yellow;">🔍 Buscando...</li>';
    searchBtn.disabled = true;
    searchBtn.textContent = '...';
    
    selectedTracks.clear();
    updateSelectionBar();

    try {
        const results = await ytSearch(query);
        const videos = results.videos.slice(0, settings.resultsLimit);
        
        searchResults = videos;
        playlistTree.innerHTML = '';

        if (videos.length === 0) {
            playlistTree.innerHTML = '<li style="color: red;">❌ Nenhum resultado</li>';
            return;
        }

        videos.forEach((video, index) => {
            const li = document.createElement('li');
            li.classList.add('selectable');
            li.dataset.videoId = video.videoId;
            li.dataset.index = index;
            
            const title = video.title.toLowerCase();
            const isOfficial = 
                title.includes('official video') ||
                title.includes('official music video');
            
            const icon = isOfficial ? '🔓 ' : '▶️ ';
            
            li.innerHTML = `
                ${icon}<span style="color: #00FF00;">[${video.timestamp}]</span> 
                <span>${video.title}</span>
            `;
            
            li.style.cssText = `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
            li.title = `Clique para selecionar | Duplo clique para tocar\n${video.title}`;

            li.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSelection(video.videoId, li);
            });
            
            li.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                playYoutubeVideo(video.videoId, video.title, video.seconds);
            });
            
            playlistTree.appendChild(li);
        });

        console.log(`✅ ${videos.length} vídeos encontrados`);

    } catch (err) {
        console.error('❌ Erro na busca:', err);
        playlistTree.innerHTML = '<li style="color: red;">❌ Erro ao buscar</li>';
    } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = 'GO';
    }
}

// === 5. SELEÇÃO MÚLTIPLA ===
function toggleSelection(videoId, liElement) {
    if (selectedTracks.has(videoId)) {
        selectedTracks.delete(videoId);
        liElement.classList.remove('selected');
    } else {
        selectedTracks.add(videoId);
        liElement.classList.add('selected');
    }
    
    updateSelectionBar();
}

function updateSelectionBar() {
    const count = selectedTracks.size;
    
    if (count > 0) {
        selectionBar.classList.remove('hidden');
        selectedCountEl.textContent = `${count} selecionada${count > 1 ? 's' : ''}`;
    } else {
        selectionBar.classList.add('hidden');
    }
}

document.getElementById('clear-selection')?.addEventListener('click', () => {
    selectedTracks.clear();
    document.querySelectorAll('li.selected').forEach(li => {
        li.classList.remove('selected');
    });
    updateSelectionBar();
});

// === 6. ADICIONAR À PLAYLIST (COM CARREGAMENTO EM BACKGROUND) ===
document.getElementById('add-to-playlist')?.addEventListener('click', async () => {
    if (selectedTracks.size === 0) return;
    
    if (settings.autoCloseSelector) {
        document.getElementById('media-library').classList.add('hidden');
    }
    
    const selectedArray = Array.from(selectedTracks);
    
    // Limpa fila anterior
    trackLoadingQueue.clear();
    
    // Extrai APENAS a primeira música (com loading visível)
    showLoading('🎵 Carregando primeira música...', 'Extraindo áudio do YouTube');
    
    const firstVideoId = selectedArray[0];
    const firstVideo = searchResults.find(v => v.videoId === firstVideoId);
    
    if (!firstVideo) {
        hideLoading();
        return;
    }
    
    try {
        console.log(`🔄 Extraindo primeira: ${firstVideo.title}`);
        const response = await ipcRenderer.invoke('GET_YOUTUBE_STREAM_URL', firstVideoId);
        
        if (!response.success) {
            hideLoading();
            alert('❌ Não foi possível extrair a primeira música.\n\nVerifique se o yt-dlp está instalado:\nnpm install yt-dlp-exec');
            selectedTracks.clear();
            updateSelectionBar();
            return;
        }
        
        // Marca primeira como pronta
        trackLoadingQueue.set(firstVideoId, {
            status: 'ready',
            url: response.url,
            metadata: {
                title: firstVideo.title,
                artist: firstVideo.author.name,
                duration: firstVideo.seconds || response.duration,
                videoId: firstVideoId
            }
        });
        
        console.log(`✅ Primeira música pronta: ${firstVideo.title}`);
        
        // Cria playlist com primeira música + placeholders
        const tracksToAdd = [{
            url: response.url,
            metaData: {
                title: firstVideo.title,
                artist: firstVideo.author.name
            },
            duration: firstVideo.seconds || response.duration,
            _videoId: firstVideoId,
            _loaded: true
        }];
        
        // Marca outras como "loading" mas NÃO adiciona à playlist ainda
        for (let i = 1; i < selectedArray.length; i++) {
            const videoId = selectedArray[i];
            const video = searchResults.find(v => v.videoId === videoId);
            
            if (video) {
                trackLoadingQueue.set(videoId, {
                    status: 'loading',
                    metadata: {
                        title: video.title,
                        artist: video.author.name,
                        duration: video.seconds,
                        videoId: videoId
                    }
                });
            }
        }
        
        hideLoading();
        
        // Adiciona ao Webamp
        webamp.setTracksToPlay(tracksToAdd);
        
        // Auto-play
        if (settings.autoPlay) {
            setTimeout(() => webamp.play(), 300);
        }
        
        console.log(`✅ Playlist criada com ${tracksToAdd.length} músicas (1 pronta, ${selectedArray.length - 1} carregando)`);
        
        // Inicia carregamento em background das outras
        if (selectedArray.length > 1) {
            loadRemainingTracksInBackground(selectedArray.slice(1));
        }
        
    } catch (error) {
        hideLoading();
        console.error('❌ Erro ao extrair primeira música:', error);
        alert('⚠️ Erro ao carregar música.');
    }
    
    selectedTracks.clear();
    updateSelectionBar();
});

// === NOVA FUNÇÃO: Carrega músicas restantes em background ===
async function loadRemainingTracksInBackground(videoIds) {
    if (isLoadingInBackground) {
        console.warn('⚠️ Já está carregando em background');
        return;
    }
    
    isLoadingInBackground = true;
    console.log(`🔄 Iniciando carregamento em background de ${videoIds.length} músicas`);
    
    for (let i = 0; i < videoIds.length; i++) {
        const videoId = videoIds[i];
        const queueItem = trackLoadingQueue.get(videoId);
        
        if (!queueItem) continue;
        
        try {
            console.log(`🔄 [Background ${i+1}/${videoIds.length}] Extraindo: ${queueItem.metadata.title}`);
            
            const response = await ipcRenderer.invoke('GET_YOUTUBE_STREAM_URL', videoId);
            
            if (response.success) {
                // Atualiza status na fila
                trackLoadingQueue.set(videoId, {
                    status: 'ready',
                    url: response.url,
                    metadata: queueItem.metadata
                });
                
                // ← NOVO: Adiciona à playlist do Webamp assim que ficar pronta
                webamp.appendTracks([{
                    url: response.url,
                    metaData: {
                        title: queueItem.metadata.title,
                        artist: queueItem.metadata.artist
                    },
                    duration: queueItem.metadata.duration
                }]);
                
                console.log(`✅ [Background ${i+1}/${videoIds.length}] Pronto e adicionado: ${queueItem.metadata.title}`);
            } else {
                trackLoadingQueue.set(videoId, {
                    status: 'error',
                    metadata: queueItem.metadata
                });
                
                console.error(`❌ [Background ${i+1}/${videoIds.length}] Falhou: ${queueItem.metadata.title}`);
            }
            
        } catch (error) {
            console.error(`❌ [Background] Erro ao extrair ${queueItem.metadata.title}:`, error);
            trackLoadingQueue.set(videoId, {
                status: 'error',
                metadata: queueItem.metadata
            });
        }
        
        // Pequeno delay entre requisições
        if (i < videoIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    isLoadingInBackground = false;
    console.log('✅ Carregamento em background concluído');
}

if (searchBtn) searchBtn.addEventListener('click', performSearch);
if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });
}

// === 7. REPRODUÇÃO (SEMPRE STREAMING DIRETO) ===
async function playYoutubeVideo(id, title, durationSec) {
    console.log(`🎵 Extraindo: ${title}`);
    
    showLoading('🔄 Carregando música...', 'Extraindo áudio do YouTube');
    
    try {
        const response = await ipcRenderer.invoke('GET_YOUTUBE_STREAM_URL', id);
        
        if (response.success) {
            hideLoading();
            
            webamp.setTracksToPlay([{
                url: response.url,
                metaData: {
                    title: title,
                    artist: ''
                },
                duration: durationSec || response.duration
            }]);
            
            setTimeout(() => webamp.play(), 200);
            
            console.log('✅ Tocando!');
        } else {
            hideLoading();
            alert('⚠️ Não foi possível reproduzir este vídeo.\n\nVerifique se o yt-dlp está instalado:\nnpm install yt-dlp-exec');
        }
    } catch (error) {
        hideLoading();
        console.error('❌ Erro:', error);
        alert('⚠️ Erro ao carregar música.');
    }
}

// === 8. SINCRONIZAÇÃO (SIMPLIFICADA) ===
function syncWebampToYouTube() {
    webamp.onClose(() => window.close());
}



// === 9. CONFIGURAÇÕES ===
document.getElementById('settings-btn')?.addEventListener('click', () => {
    document.getElementById('settings-panel')?.classList.remove('hidden');
    
    const audioQuality = document.getElementById('audio-quality');
    const autoCloseSelector = document.getElementById('auto-close-selector');
    const showWarnings = document.getElementById('show-warnings');
    const autoPlay = document.getElementById('auto-play');
    const resultsLimit = document.getElementById('results-limit');
    
    if (audioQuality) audioQuality.value = settings.audioQuality;
    if (autoCloseSelector) autoCloseSelector.checked = settings.autoCloseSelector;
    if (showWarnings) showWarnings.checked = settings.showWarnings;
    if (autoPlay) autoPlay.checked = settings.autoPlay;
    if (resultsLimit) resultsLimit.value = settings.resultsLimit;
});

document.getElementById('close-settings')?.addEventListener('click', () => {
    const audioQuality = document.getElementById('audio-quality');
    const autoCloseSelector = document.getElementById('auto-close-selector');
    const showWarnings = document.getElementById('show-warnings');
    const autoPlay = document.getElementById('auto-play');
    const resultsLimit = document.getElementById('results-limit');
    
    if (audioQuality) settings.audioQuality = audioQuality.value;
    if (autoCloseSelector) settings.autoCloseSelector = autoCloseSelector.checked;
    if (showWarnings) settings.showWarnings = showWarnings.checked;
    if (autoPlay) settings.autoPlay = autoPlay.checked;
    if (resultsLimit) settings.resultsLimit = parseInt(resultsLimit.value);
    
    saveSettings();
    document.getElementById('settings-panel')?.classList.add('hidden');
});

document.getElementById('reset-settings')?.addEventListener('click', () => {
    if (confirm('⚠️ Resetar todas as configurações?')) {
        settings = { ...defaultSettings };
        saveSettings();
        alert('✅ Configurações resetadas!');
        document.getElementById('close-settings')?.click();
    }
});

// === 10. INICIALIZAÇÃO ===
(async () => {
    await webamp.renderWhenReady(document.getElementById('winamp-container'));
    console.log('✅ Webamp renderizado');

    syncWebampToYouTube();

    function hackEjectButton() {
        let ejectBtn = document.getElementById('eject');
        
        if (!ejectBtn) {
            ejectBtn = document.querySelector('[data-id="eject"]');
        }
        
        if (ejectBtn) {
            const newEjectBtn = ejectBtn.cloneNode(true);
            ejectBtn.parentNode.replaceChild(newEjectBtn, ejectBtn);
            
            newEjectBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                document.getElementById('media-library')?.classList.toggle('hidden');
            }, true);
            
            console.log('✅ Botão Eject hackeado!');
            return true;
        }
        return false;
    }
    
    let attempts = 0;
    const tryHack = setInterval(() => {
        attempts++;
        if (hackEjectButton() || attempts >= 10) {
            clearInterval(tryHack);
        }
    }, 500);
})();

document.getElementById('close-lib')?.addEventListener('click', () => {
    document.getElementById('media-library')?.classList.add('hidden');
});

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        document.getElementById('media-library')?.classList.toggle('hidden');
    }
});

console.log('🚀 Neo-Winamp pronto!');
console.log('💡 Clique nas músicas para selecionar múltiplas');
console.log('💡 Usando APENAS streaming direto (yt-dlp) para todas as músicas');