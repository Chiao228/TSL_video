/**
 * ui_manager.js
 * 負責處理所有的彈窗 (Modals) 與 HUD 更新邏輯
 */
import { WORD_DIFFICULTY, VIDEO_CDN_BASE } from './config.js';

export function updateHud(state) {
  const { score, housesCount, difficultyText, totalBombsDropped, targetBombs, modelLoaded, gesturesLoaded, isAnalyzing, musicBeatsLength, gameOver, win } = state;

  const scoreEl = document.getElementById('score');
  const houseCountEl = document.getElementById('house-count');
  const difficultyDisplayEl = document.getElementById('difficulty-display');
  const lifeEl = document.getElementById('life');
  const statusEl = document.getElementById('status');
  const startBtn = document.getElementById('start-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const restartBtn = document.getElementById('restart-btn');
  const exitBtn = document.getElementById('exit-game-btn');

  if (scoreEl) scoreEl.textContent = `得分: ${score}`;
  if (houseCountEl) houseCountEl.textContent = `房子: ${housesCount}`;
  
  if (difficultyDisplayEl) {
    difficultyDisplayEl.textContent = `難度: ${difficultyText}`;
  }
  
  if (lifeEl) lifeEl.textContent = `已掉落: ${totalBombsDropped}/${targetBombs}`;

  if (isAnalyzing) {
    statusEl.textContent = '狀態: 🎵 音樂解析中，請稍候...';
    if (exitBtn) exitBtn.style.display = 'none';
  } else if (!state.gameStarted) {
    if (musicBeatsLength > 0) {
      statusEl.textContent = `狀態: ✅ 載入 ${targetBombs} 顆炸彈 (按開始遊戲)`;
    } else {
      statusEl.textContent = modelLoaded ? '狀態: 準備中 (請先上傳音樂)' : '狀態: 正在載入 AI 模型...';
    }
    if (startBtn) {
      startBtn.style.display = (modelLoaded && gesturesLoaded) ? 'block' : 'none';
      startBtn.textContent = '開始遊戲';
    }
    if (pauseBtn) pauseBtn.style.display = 'none';
    if (restartBtn) restartBtn.style.display = 'none';
    if (exitBtn) exitBtn.style.display = 'none';
  } else if (gameOver) {
    statusEl.textContent = win ? '狀態: 🎉 任務成功！' : '狀態: 💥 任務失敗';
    if (startBtn) {
      startBtn.style.display = 'block';
      startBtn.textContent = '再玩一次';
    }
    if (pauseBtn) pauseBtn.style.display = 'none';
    if (restartBtn) restartBtn.style.display = 'none';
    if (exitBtn) exitBtn.style.display = 'none';
  } else if (state.gamePaused) {
    statusEl.textContent = '狀態: ⏸️ 暫停中';
    if (pauseBtn) {
      pauseBtn.style.display = 'block';
      pauseBtn.textContent = '繼續';
    }
    if (restartBtn) restartBtn.style.display = 'block';
    if (exitBtn) exitBtn.style.display = 'block';
  } else {
    statusEl.textContent = '狀態: 🚀 任務執行中...';
    if (startBtn) startBtn.style.display = 'none'; // 🌟 修正：遊戲中隱藏開始按鈕
    if (pauseBtn) {
      pauseBtn.style.display = 'block';
      pauseBtn.textContent = '暫停';
    }
    if (restartBtn) restartBtn.style.display = 'none';
    if (exitBtn) exitBtn.style.display = 'block';
  }

  // 🌟 全域處理難度選單顯示（已由引導精靈接管，此處永久隱藏以維護介面清爽）
  const diffSelect = document.getElementById('difficulty-select');
  if (diffSelect) {
    diffSelect.style.display = 'none';
  }
}

export function renderHistory() {
  const container = document.getElementById('history-list-container');
  if (!container) return;
  
  let history = [];
  try {
    // 🌟 防護機制：先檢查 localStorage 是否可用
    const storage = window.localStorage;
    if (!storage) throw new Error("Storage is null");
    history = JSON.parse(storage.getItem('tsl_history') || '[]');
  } catch (e) {
    console.warn("⚠️ 本地儲存空間被封鎖，改用記憶體暫存模式。");
    // 如果被封鎖，嘗試從我們全域宣告的暫存變數讀取 (如果有的話)
    history = window._memoryHistory || [];
  }

  if (history.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #888;">尚無遊玩紀錄</p>';
    return;
  }
  container.innerHTML = history.map(item => `
    <div style="background: #222; padding: 12px; border-radius: 10px; margin-bottom: 10px; border-left: 4px solid #00cc99;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
        <span style="font-weight: bold; color: #00cc99;">${item.name}</span>
        <span style="font-size: 12px; color: #777;">${item.time}</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 14px;">難度: <span style="color: #ff9900;">${item.difficulty}</span></span>
        <span style="font-size: 18px; font-weight: bold; color: #ff0;">${item.score} 分</span>
      </div>
    </div>
  `).join('');
}

export async function loadTutorialVideos() {
  const listContainer = document.getElementById('tutorial-vocab-list');
  if (!listContainer || listContainer.dataset.loaded === 'true') return;
  try {
    const response = await fetch('tsl_vocab_videos.json');
    const videos = await response.json();
    videos.sort((a, b) => (WORD_DIFFICULTY[a.word_zh.trim()] || 1) - (WORD_DIFFICULTY[b.word_zh.trim()] || 1));
    listContainer.innerHTML = '';
    videos.forEach(item => {
      const row = document.createElement('div');
      row.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 15px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08);";
      const wordSpan = document.createElement('span');
      wordSpan.style.cssText = "font-weight: bold; font-size: 24px; color: #fff; text-shadow: 0 0 8px rgba(255, 255, 255, 0.15);";
      const diff = WORD_DIFFICULTY[item.word_zh.trim()] || 1;
      wordSpan.textContent = `${item.word_zh} ${"⭐".repeat(diff)}`;
      const videoBtn = document.createElement('button');
      videoBtn.style.cssText = "background: linear-gradient(135deg, #cc99ff, #9933cc); color: white; border: none; padding: 10px 20px; border-radius: 10px; cursor: pointer; font-weight: bold; font-size: 20px; box-shadow: 0 4px 12px rgba(153, 51, 204, 0.3); transition: all 0.2s ease;";
      videoBtn.textContent = "📺 影片";
      
      // 🌟 修正：支援 VIDEO_CDN_BASE 以便將影片上傳至 GitHub/jsDelivr 等高速 CDN (若為離線狀態則直接使用本地相對路徑，免去等待 CDN 逾時)
      const levelDir = WORD_DIFFICULTY[item.word_zh.trim()] || "Unclassified";
      const hasNetwork = navigator.onLine;
      const localVideoUrl = `${(hasNetwork && VIDEO_CDN_BASE) ? VIDEO_CDN_BASE : ''}videos/Level_${levelDir}/${item.word_zh.trim()}.mp4`;
      
      // 🌟 瀏覽器背景預載入 (Prefetch) 優化：讓瀏覽器在閒置時提早下載影片快取，點擊時即可瞬間秒播！
      const prefetchLink = document.createElement('link');
      prefetchLink.rel = 'prefetch';
      prefetchLink.href = localVideoUrl;
      prefetchLink.as = 'video';
      document.head.appendChild(prefetchLink);
      
      videoBtn.onclick = () => {
        // 尋找或建立影片播放容器
        let videoContainer = document.getElementById('local-video-player-container');
        if (!videoContainer) {
          videoContainer = document.createElement('div');
          videoContainer.id = 'local-video-player-container';
          videoContainer.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:#000; border:3px solid #9933cc; padding:20px; z-index:200000; display:none; flex-direction:column; align-items:center; border-radius:15px; box-shadow: 0 0 40px rgba(0,0,0,0.9);";
          videoContainer.innerHTML = `
            <div style="width:100%; display:flex; justify-content:space-between; margin-bottom:15px;">
              <span id="local-video-title" style="color:white; font-weight:bold; font-size:22px;">教學影片</span>
              <button onclick="document.getElementById('local-video-player-container').style.display='none'; document.getElementById('local-video-element').pause();" style="background:red; color:white; border:none; cursor:pointer; padding:5px 15px; border-radius:6px; font-weight:bold;">❌ 關閉</button>
            </div>
            <video id="local-video-element" width="800" height="450" controls autoplay style="border-radius:10px; border:1px solid #333;"></video>
            <div id="video-error-msg" style="color:#ff4444; font-size:16px; margin-top:15px; display:none; text-align:center;">
              本地影片讀取失敗 (伺服器未開啟或檔案不存在)<br>
              <a id="video-fallback-link" href="#" target="_blank" style="color:#00ccff; text-decoration:underline;">點此觀看 YouTube 版本</a>
            </div>
          `;
          document.body.appendChild(videoContainer);
        }
        
        const videoEl = document.getElementById('local-video-element');
        const titleEl = document.getElementById('local-video-title');
        const errorEl = document.getElementById('video-error-msg');
        const linkEl = document.getElementById('video-fallback-link');
        
        titleEl.textContent = `教學影片: ${item.word_zh}`;
        errorEl.style.display = 'none';
        videoEl.style.display = 'block';
        
        videoEl.src = localVideoUrl;
        
        // 🌟 處理讀取失敗 (雙重備援：CDN 載入失敗時，自動降級讀取本地端的 videos/ 目錄)
        videoEl.onerror = () => {
          const relativePath = `videos/Level_${levelDir}/${item.word_zh.trim()}.mp4`;
          if (videoEl.src && !videoEl.src.endsWith(relativePath)) {
            console.log(`⚠️ CDN 影片讀取失敗，嘗試載入本地備份: ${relativePath}`);
            videoEl.src = relativePath;
          } else {
            videoEl.style.display = 'none';
            errorEl.style.display = 'block';
            linkEl.href = item.video_url;
          }
        };
        
        videoContainer.style.display = 'flex';
      };
      
      row.append(wordSpan, videoBtn);
      listContainer.appendChild(row);
    });
    listContainer.dataset.loaded = 'true';
  } catch (err) {
    listContainer.innerHTML = '<span style="color:red;">載入失敗</span>';
  }
}
