/**
 * app.js: 台灣手語學習遊戲 (指揮中心版)
 */

// 1. 引入模組
import {
  getCanvasWidth, getCanvasHeight, AUDIO_OFFSET, HOUSE_COUNT, HOUSE_WIDTH, HOUSE_HEIGHT,
  HOUSE_MARGIN_BOTTOM, WORD_DIFFICULTY, DIRECT_HIT_THRESHOLD, EXCEPTION_THRESHOLD,
  MODEL_FRAMES, FEATURE_DIM, getThresholdsForWord
} from './config.js?v=20260519';

import { FilesetResolver, HandLandmarker, PoseLandmarker, DrawingUtils } from "./vision_bundle.mjs";

import { Plane, Bomb } from './game_objects.js?v=20260519';
import { AIManager } from './ai_manager.js?v=20260519';
import { updateHud, renderHistory, loadTutorialVideos } from './ui_manager.js?v=20260519';
import { analyzeBeatsSmartJS } from './audio_processor.js?v=20260519'; // 🌟 引入瀏覽器端 JS 分析以備外網加速
import { saveScoreToCloud, getTop10Scores } from './firebase_manager.js?v=20260519';
// -----------------------
// 2. 全域狀態變數 (移至頂部以供按鈕使用)
// -----------------------
let gameStarted = false;
let commanderName = "指揮官";
let gameOver = false;
let gamePaused = false;
let win = false;
let score = 0;
let totalBombsDropped = 0;
let targetBombs = 0;
let lastVideoFrame = null;
let lastHandLandmarks = null;
let lastPoseRes = null;
let featureBuffer = [];
let inferenceCooldown = 0;
let lastInferenceLabel = "";
let disabledHitLabel = ""; // 🌟 新增：鎖定已擊中的詞彙，防止玩家維持靜態手勢時產生「連擊自動消除」的 Bug
let lastDebugInfo = null;
let frameCount = 0;
let inferenceFrameCount = 0;
let isInferencing = false; // 🌟 補回開關
let isAnalyzing = false;
let labelMap = null;
let fullVocabulary = [];
let currentVocabulary = [{ text: '載入中...', difficulty: 1 }];
let modelLoaded = false;
let gesturesLoaded = false;
let musicBeats = [];
let currentBeatIndex = 0;
const HAND_PERSISTENCE_FRAMES = 10;
let handMissFrameCount = 0;
window._memoryHistory = []; // 🌟 記憶體備援儲存空間
let showDebugOverlay = false;
// 移除 localStorage 記憶，強制每次載入都預設隱藏


// -----------------------
// 3. Onboarding 專屬狀態與全域選擇函數
// -----------------------
let onboardingMusicMode = 'default';
let onboardingDifficultyLevel = '1';

// 統一處理音樂檔案載入與節奏分析
async function handleAudioFile(file, label) {
  if (!file) return;

  if (label) {
    const fileName = file.name.replace(/\.[^/.]+$/, ""); // 移除 .mp3 等
    const displayName = fileName.length > 12 ? fileName.substring(0, 10) + "..." : fileName;
    label.textContent = `🎵 ${displayName}`;
    label.style.borderColor = "rgba(0, 229, 255, 0.5)";
    label.style.color = "#fff";
  }

  isAnalyzing = true;
  updateGameState();
  try {
    bgmPlayer.src = URL.createObjectURL(file);
    
    console.log("🌐 啟用瀏覽器端 JS 節奏解析...");
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    
    // 解碼音訊
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // 呼叫本地 JS 進行 Onset 偵測
    const beats = await analyzeBeatsSmartJS(audioBuffer);
    
    if (onboardingMusicMode !== 'upload') {
        console.log("⚠️ 自訂音樂分析完成，但使用者已切換至預設音樂，捨棄此結果。");
        return;
    }
    
    if (!beats || beats.length === 0) {
        throw new Error("此音樂檔案中未能解析出足夠的節奏點，請更換另一首音樂！");
    }
    
    musicBeats = beats.map(b => ({ time: b.time }));
    targetBombs = musicBeats.length;
    console.log(`✅ 瀏覽器端 JS 解析完成！共產出 ${targetBombs} 顆炸彈。`);
  } catch (err) {
    console.error(err);
    alert(err.message || "音樂解析失敗！");
  } finally {
    isAnalyzing = false;
    updateGameState();
  }
}

// 建立全域 Onboarding 音樂選取函數 (HTML 內聯 onclick 呼叫)
window.selectOnboardingMusic = async (mode) => {
  if (onboardingMusicMode === mode) return; // 🌟 避免重選同一個模式時被清空！
  onboardingMusicMode = mode;
  const cardDefault = document.getElementById('music-card-default');
  const cardUpload = document.getElementById('music-card-upload');
  const uploadArea = document.getElementById('onboarding-upload-area');
  
  const mainMusicSelect = document.getElementById('musicSelect');
  const mainAudioUploadLabel = document.getElementById('audio-upload-label');
  
  if (mode === 'default') {
    if (cardDefault) {
      cardDefault.style.background = 'rgba(0, 229, 255, 0.1)';
      cardDefault.style.borderColor = '#00e5ff';
      cardDefault.style.boxShadow = '0 0 15px rgba(0, 229, 255, 0.2)';
    }
    if (cardUpload) {
      cardUpload.style.background = 'rgba(255, 255, 255, 0.02)';
      cardUpload.style.borderColor = 'rgba(255,255,255,0.1)';
      cardUpload.style.boxShadow = 'none';
    }
    if (uploadArea) uploadArea.style.display = 'none';
    
    // 同步主畫面 Music Select
    if (mainMusicSelect) mainMusicSelect.value = 'default';
    if (mainAudioUploadLabel) mainAudioUploadLabel.style.display = 'none';
    
    await preloadDefaultBGM();
  } else {
    if (cardUpload) {
      cardUpload.style.background = 'rgba(0, 229, 255, 0.1)';
      cardUpload.style.borderColor = '#00e5ff';
      cardUpload.style.boxShadow = '0 0 15px rgba(0, 229, 255, 0.2)';
    }
    if (cardDefault) {
      cardDefault.style.background = 'rgba(255, 255, 255, 0.02)';
      cardDefault.style.borderColor = 'rgba(255,255,255,0.1)';
      cardDefault.style.boxShadow = 'none';
    }
    if (uploadArea) uploadArea.style.display = 'block';
    
    // 同步主畫面 Music Select
    if (mainMusicSelect) mainMusicSelect.value = 'upload';
    if (mainAudioUploadLabel) mainAudioUploadLabel.style.display = 'block';
    
    musicBeats = [];
    targetBombs = 0;
    if (bgmPlayer) bgmPlayer.src = '';
    updateGameState();
  }
};

// 建立全域 Onboarding 難度選取與渲染函數 (全部預設解鎖)
window.selectOnboardingDifficulty = (level) => {
  onboardingDifficultyLevel = level;
  for (let i = 1; i <= 3; i++) {
    const card = document.getElementById(`diff-card-${i}`);
    if (card) {
      const isSelected = (i === parseInt(level));
      
      card.style.transition = 'all 0.3s ease';
      card.style.opacity = '1';
      card.style.cursor = 'pointer';
      
      const emojiSpan = card.querySelector('span');
      const textH4 = card.querySelector('h4');
      if (emojiSpan) emojiSpan.textContent = '⭐'.repeat(i);
      
      if (isSelected) {
        let activeColor = '#2ecc71';
        let activeBg = 'rgba(46, 204, 113, 0.1)';
        if (i === 2) {
          activeColor = '#00e5ff';
          activeBg = 'rgba(0, 229, 255, 0.1)';
        } else if (i === 3) {
          activeColor = '#ff3366';
          activeBg = 'rgba(255, 51, 102, 0.1)';
        }
        card.style.background = activeBg;
        card.style.borderColor = activeColor;
        card.style.boxShadow = `0 0 15px ${activeColor}40`;
        if (textH4) {
          textH4.style.color = activeColor;
          textH4.textContent = `等級 ${i} (${i===1?'簡易':i===2?'中等':'困難'})`;
        }
      } else {
        card.style.background = 'rgba(255, 255, 255, 0.02)';
        card.style.borderColor = 'rgba(255,255,255,0.1)';
        card.style.boxShadow = 'none';
        if (textH4) {
          textH4.style.color = '#fff';
          textH4.textContent = `等級 ${i} (${i===1?'簡易':i===2?'中等':'困難'})`;
        }
      }
    }
  }
  
  // 同步頂部難度
  const mainDiffSelect = document.getElementById('difficulty-select');
  if (mainDiffSelect) mainDiffSelect.value = level;
  updateVocabulary();
};


// -----------------------
// 4. UI 事件綁定
// -----------------------
function setupEventListeners() {
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'flex';
    // 🌟 現在變數已經定義，這裡不會報錯了
    if (gameStarted && !gamePaused && !gameOver) {
      const pBtn = document.getElementById('pause-btn');
      if (pBtn && !gamePaused) pBtn.click();
    }
  }

  const historyBtn = document.getElementById('history-btn');
  if (historyBtn) {
    historyBtn.onclick = () => {
      console.log("📜 歷史紀錄按鈕被點擊");
      renderHistory();
      openModal('history-modal');
    };
  }

  const rulesBtn = document.getElementById('rules-btn');
  if (rulesBtn) rulesBtn.onclick = () => openModal('rules-modal');

  const closeRulesBtn = document.getElementById('close-rules-btn');
  if (closeRulesBtn) closeRulesBtn.onclick = () => { document.getElementById('rules-modal').style.display = 'none'; };

  const tutorialBtn = document.getElementById('tutorial-btn');
  if (tutorialBtn) tutorialBtn.onclick = () => {
    openModal('tutorial-modal');
    loadTutorialVideos();
  };

  const closeTutorialBtn = document.getElementById('close-tutorial-btn');
  if (closeTutorialBtn) closeTutorialBtn.onclick = () => { document.getElementById('tutorial-modal').style.display = 'none'; };

  // 🕒 歷史紀錄關閉
  const closeHistoryBtn = document.getElementById('close-history-btn');
  if (closeHistoryBtn) {
    closeHistoryBtn.onclick = () => {
      console.log("🖱️ 關閉歷史紀錄彈窗");
      document.getElementById('history-modal').style.display = 'none';
    };
  }

  // 難度切換
  const dSelect = document.getElementById('difficulty-select');
  if (dSelect) dSelect.onchange = updateVocabulary;

  // 🏆 排行榜關閉與再玩一次
  const closeLBBtn = document.getElementById('close-leaderboard-btn');
  if (closeLBBtn) {
    closeLBBtn.onclick = () => {
      document.getElementById('leaderboard-modal').style.display = 'none';
      resetToHome(true); // 🌟 關閉視窗後 跳回故事，並重新撥放打字機特效！
    };
  }
  const restartLBBtn = document.getElementById('leaderboard-restart-btn');
  if (restartLBBtn) {
    restartLBBtn.onclick = () => {
      document.getElementById('leaderboard-modal').style.display = 'none';
      resetToHome(false); // 🌟 再玩一次則直接跳到音樂配置選擇，極速開啟下一局！
    };
  }

  // 📊 除錯/偵測資訊顯示切換
  const toggleDebugBtn = document.getElementById('toggle-debug-btn');
  if (toggleDebugBtn) {
    toggleDebugBtn.textContent = showDebugOverlay ? "📊 隱藏偵測資訊" : "📊 顯示偵測資訊";

    toggleDebugBtn.onclick = () => {
      showDebugOverlay = !showDebugOverlay;
      toggleDebugBtn.textContent = showDebugOverlay ? "📊 隱藏偵測資訊" : "📊 顯示偵測資訊";
      try {
        localStorage.setItem('show_debug_overlay', showDebugOverlay);
      } catch (e) {
        console.warn("Failed to save show_debug_overlay to localStorage:", e);
      }
    };
  }

  // 歡迎彈窗點擊事件 (四階段極速導引：故事 -> 規則 -> 音軌 -> 難度 -> 啟動)
  const welcomeSkipBtn = document.getElementById('welcome-skip-btn');
  const welcomeRulesNextBtn = document.getElementById('welcome-rules-next-btn');
  const welcomeMusicNextBtn = document.getElementById('welcome-music-next-btn');
  const welcomeDifficultyStartBtn = document.getElementById('welcome-difficulty-start-btn');

  const welcomeModal = document.getElementById('welcome-modal');
  const welcomeStoryPhase = document.getElementById('welcome-story-phase');
  const welcomeRulesPhase = document.getElementById('welcome-rules-phase');
  const welcomeMusicPhase = document.getElementById('welcome-music-phase');
  const welcomeDifficultyPhase = document.getElementById('welcome-difficulty-phase');

  window._typingTimeout = null;

  // 1. 進入第二階段：顯示規則畫面 (直接從故事前進)
  const showRulesPhase = () => {
    if (window._typingTimeout) clearTimeout(window._typingTimeout); // 🌟 安全機制
    if (welcomeStoryPhase && welcomeRulesPhase) {
      welcomeStoryPhase.style.display = 'none';
      welcomeRulesPhase.style.display = 'flex';
    }
  };

  // 2. 進入第三階段：配置作戰音樂
  const showMusicPhase = () => {
    if (welcomeRulesPhase && welcomeMusicPhase) {
      welcomeRulesPhase.style.display = 'none';
      welcomeMusicPhase.style.display = 'flex';
    }
  };

  // 3. 進入第四階段：選擇作戰難度
  const showDifficultyPhase = () => {
    if (isAnalyzing) {
      alert("⏳ 音樂作戰頻率解析中，請稍候！");
      return;
    }
    if (onboardingMusicMode === 'upload' && musicBeats.length === 0) {
      alert("請先點擊下方虛線區上傳您的作戰音樂檔案！");
      return;
    }
    if (welcomeMusicPhase && welcomeDifficultyPhase) {
      welcomeMusicPhase.style.display = 'none';
      welcomeDifficultyPhase.style.display = 'flex';
    }
  };

  // 4. 啟動防禦系統，正式開始遊戲
  const startDefenseGameOnboarding = () => {
    if (window._typingTimeout) clearTimeout(window._typingTimeout);
    
    // 🌟 修正漏洞：若音樂還在分析中或沒成功分析出拍點，禁止開始遊戲，避免瞬間結算成功
    if (isAnalyzing) {
      alert("🎵 背景音樂正在由 AI 分析中，請稍候再點選啟動！");
      return;
    }
    if (musicBeats.length === 0) {
      alert("⚠️ 音樂載入解析尚未完成，請稍候或重新選取音軌！");
      return;
    }

    // 關閉 Modal
    if (welcomeModal) {
      welcomeModal.style.opacity = '0';
      setTimeout(() => {
        welcomeModal.style.display = 'none';
      }, 500); // 500ms 平滑淡出
    }

    // 啟動遊戲
    gameStarted = true;
    if (bgmPlayer) bgmPlayer.play();

    // 隱藏頂端難度下拉選單，讓畫面最乾淨
    const mainDiffSelect = document.getElementById('difficulty-select');
    if (mainDiffSelect) mainDiffSelect.style.display = 'none';

    updateGameState();
  };

  if (welcomeSkipBtn) welcomeSkipBtn.onclick = showRulesPhase;
  if (welcomeRulesNextBtn) welcomeRulesNextBtn.onclick = showMusicPhase;
  if (welcomeMusicNextBtn) welcomeMusicNextBtn.onclick = showDifficultyPhase;
  if (welcomeDifficultyStartBtn) welcomeDifficultyStartBtn.onclick = startDefenseGameOnboarding;

  // 📖 故事背景文字打字機特效
  const storyText = `在不久的未來，「手語小鎮」正遭受戰鬥機的轟炸襲擊！作為防衛隊長，你必須啟動 AI 辨識系統，在炸彈落地前比出對應的手語詞彙，利用手語的能量將炸彈在空中消滅，保衛小鎮居民與房屋！`;
  const storyEl = document.getElementById('welcome-story-text');

  window.triggerWelcomeStoryTypewriter = () => {
    if (window._typingTimeout) clearTimeout(window._typingTimeout); // 🌟 安全重置
    if (storyEl) {
      storyEl.textContent = ""; // 確保初始為空
      let index = 0;

      // 🌟 重置跳過按鈕為初始狀態，支持多輪挑戰
      if (welcomeSkipBtn) {
        welcomeSkipBtn.textContent = "⏭️ 跳過故事";
        welcomeSkipBtn.style.background = "rgba(255, 255, 255, 0.05)";
        welcomeSkipBtn.style.color = "white";
        welcomeSkipBtn.style.border = "1.5px solid rgba(255, 255, 255, 0.2)";
        welcomeSkipBtn.style.boxShadow = "none";
      }

      const typeWriter = () => {
        if (index < storyText.length) {
          // 🌟 採用經典終端機風格游標「▌」，科技質感直接拉滿！
          storyEl.textContent = storyText.substring(0, index + 1) + "▌";
          index++;
          window._typingTimeout = setTimeout(typeWriter, 40); // 40ms/字，節奏明快自然
        } else {
          storyEl.textContent = storyText; // 打字完成，移除游標，回歸乾淨內文

          // 🌟 當打字機播放完成後，將跳過按鈕進化為「下一步：查看作戰守則」以引導玩家點擊
          if (welcomeSkipBtn) {
            welcomeSkipBtn.textContent = "下一步：查看作戰守則 ⏭️";
            welcomeSkipBtn.style.background = "linear-gradient(135deg, #00e5ff, #0088cc)";
            welcomeSkipBtn.style.color = "#050a14";
            welcomeSkipBtn.style.border = "none";
            welcomeSkipBtn.style.boxShadow = "0 4px 15px rgba(0, 229, 255, 0.4)";
          }
        }
      };

      // 延遲 400ms 開啟打字機，給予玩家視覺適應的層次感
      window._typingTimeout = setTimeout(typeWriter, 400);
    }
  };

  // 初始觸發
  window.triggerWelcomeStoryTypewriter();

  // 🌟 初始化難度卡片的預設選取與樣式狀態
  window.selectOnboardingDifficulty('1');

  // 🌟 自動非同步預載入預設背景音樂，秒速就緒！
  preloadDefaultBGM();

  // 🔊 音量控制邏輯
  const volumeSlider = document.getElementById('volume-slider');
  const volumeIcon = document.getElementById('volume-icon');
  const volumeValue = document.getElementById('volume-value');
  
  if (bgmPlayer) {
    // 預設音量設為 10%
    bgmPlayer.volume = 0.1;
  }

  let lastVolume = 0.1;

  // 強制同步滑桿與數值，防止瀏覽器記住上次的快取或輸入欄位狀態 (Autofill / Form State Persistence)
  if (volumeSlider && volumeValue) {
    volumeSlider.value = 0.1;
    volumeValue.textContent = '10%';
  }

  if (volumeSlider && volumeValue && bgmPlayer) {
    volumeSlider.oninput = (e) => {
      const vol = parseFloat(e.target.value);
      bgmPlayer.volume = vol;
      volumeValue.textContent = Math.round(vol * 100) + '%';
      
      // 更新圖示
      if (vol === 0) {
        volumeIcon.textContent = '🔈';
      } else if (vol < 0.5) {
        volumeIcon.textContent = '🔉';
      } else {
        volumeIcon.textContent = '🔊';
      }
      
      if (vol > 0) {
        lastVolume = vol;
      }
    };
  }

  if (volumeIcon && volumeSlider && bgmPlayer) {
    volumeIcon.onclick = () => {
      if (bgmPlayer.volume > 0) {
        // 靜音
        lastVolume = bgmPlayer.volume;
        bgmPlayer.volume = 0;
        volumeSlider.value = 0;
        volumeValue.textContent = '0%';
        volumeIcon.textContent = '🔈';
      } else {
        // 取消靜音，恢復上次音量
        bgmPlayer.volume = lastVolume;
        volumeSlider.value = lastVolume;
        volumeValue.textContent = Math.round(lastVolume * 100) + '%';
        if (lastVolume < 0.5) {
          volumeIcon.textContent = '🔉';
        } else {
          volumeIcon.textContent = '🔊';
        }
      }
    };
  }
}

// 延遲一點點執行，確保 ID 都已經在畫面上
setTimeout(setupEventListeners, 500);

// -----------------------
// 2. 初始化全域變數與 DOM
// -----------------------
console.log("🚀 TSL 遊戲啟動中...");
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const video = document.createElement('video'); // 🌟 穩定性修正
const audioUpload = document.getElementById('audioUpload');
const bgmPlayer = document.getElementById('bgmPlayer');

let bombs = [];
let houses = [];
let plane = null;

// AI 相關
const aiManager = new AIManager();

// -----------------------
// 3. 遊戲初始化邏輯
// -----------------------
function resizeCanvas() {
  // 🌟 高清視網膜 (HiDPI) 適配邏輯
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;

  // 縮放繪圖座標系，讓原本的程式碼不需要改動座標就能在高解析度下運作
  ctx.scale(dpr, dpr);

  // 開啟最高畫質的影像平滑處理
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const images = {
  background: new Image(),
  house: new Image(),
  plane: new Image(),
  bomb: new Image(),
  explosion: new Image()
};
images.background.src = 'background.jpg';
images.house.src = 'house.png';
images.plane.src = 'plane.png';
images.bomb.src = 'bomb.png';
images.explosion.src = 'explosion.png';

async function startApp() {
  try {
    await aiManager.init();
    await loadVocab();
    initGame();
    await initWebcam();
    modelLoaded = true;
    gesturesLoaded = true;
    tick();
  } catch (err) {
    console.error("啟動失敗:", err);
  }
}

async function loadVocab() {
  try {
    const response = await fetch('./label_map.json');
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`無法載入 label_map.json (HTTP ${response.status}): ${errText}`);
    }
    labelMap = await response.json();
  } catch (e) {
    alert("❌ 嚴重錯誤：找不到標籤檔 (label_map.json)！\n請確認專案根目錄下有此檔案。");
    throw e;
  }

  const uniqueVocabMap = new Map();
  Object.entries(labelMap).forEach(([idx, text]) => {
    const cleanText = text.trim();
    if (!uniqueVocabMap.has(cleanText)) {
      uniqueVocabMap.set(cleanText, { text: cleanText, difficulty: WORD_DIFFICULTY[cleanText] || 1 });
    }
  });
  fullVocabulary = Array.from(uniqueVocabMap.values());
  updateVocabulary();
}

function updateVocabulary() {
  const diffSelect = document.getElementById('difficulty-select');
  const val = diffSelect ? diffSelect.value : 'all';
  if (val === 'all') currentVocabulary = [...fullVocabulary];
  else currentVocabulary = fullVocabulary.filter(v => v.difficulty === parseInt(val));
}

function getDifficultyText() {
  const diffSelect = document.getElementById('difficulty-select');
  if (!diffSelect) return "一般";
  const val = diffSelect.value;
  if (val === 'all') return "綜合";
  return `等級 ${val}`;
}

function initGame() {
  score = 0;
  gameOver = false;
  gamePaused = false;
  gameStarted = false;
  bombs = [];
  currentBeatIndex = 0;
  totalBombsDropped = 0;
  plane = new Plane(images.plane);
  window._bgmEndRealTime = null;
  initHouses();
  updateGameState();
}

function initHouses() {
  houses = [];
  const cw = window.innerWidth;
  const ch = window.innerHeight;

  const isMobile = cw < 768;
  const houseWidth = HOUSE_WIDTH * (isMobile ? 0.65 : 1.0);
  const houseHeight = HOUSE_HEIGHT * (isMobile ? 0.65 : 1.0);
  const houseMarginBottom = HOUSE_MARGIN_BOTTOM * (isMobile ? 0.65 : 1.0);

  // 🌟 與飛機邊界限制同步：房子也只生成在最左側與視訊框框左邊界之間 (行動裝置 130px，電腦 330px)
  const rightLimit = cw - (isMobile ? 130 : 330);
  const step = (rightLimit - houseWidth) / Math.max(1, (HOUSE_COUNT - 1));

  for (let i = 0; i < HOUSE_COUNT; i++) {
    // 基礎位置 + 輕微隨機偏移 (讓城鎮看起來自然不死板)
    let offsetX = (Math.random() * 40) - 20;
    let x = (i * step) + offsetX;

    // 確保不管怎麼偏移，最左邊與最右邊的房子都不會跑出限制範圍外
    x = Math.max(0, Math.min(x, rightLimit - houseWidth));

    // 讓房子的高度也有微微的高低起伏
    let offsetY = (Math.random() * 10) - 5;
    let y = ch - houseHeight - houseMarginBottom + offsetY;

    houses.push({ x, y, width: houseWidth, height: houseHeight });
  }
}

// -----------------------
// 4. 音訊與事件處理
// -----------------------
// 🌟 預先載入預設音樂 (科幻電音 default_bgm.mp3)
async function preloadDefaultBGM() {
  isAnalyzing = true;
  updateGameState();
  try {
    if (bgmPlayer) {
      bgmPlayer.src = 'default_bgm.mp3';
    }
    // 🌟 離線優化：直接讀取靜態預載的節拍檔，完全不依賴後端伺服器！
    const analyzeResponse = await fetch('default_bgm_beats.json');

    if (!analyzeResponse.ok) throw new Error('讀取預設音樂節拍檔失敗');
    
    const data = await analyzeResponse.json();
    
    if (data.status === 'success') {
        if (onboardingMusicMode !== 'default') {
            console.log("⚠️ 預設音樂分析完成，但使用者已切換至自訂音樂，捨棄此結果。");
            return;
        }
        musicBeats = data.beat_times.map(t => ({ time: t }));
        targetBombs = musicBeats.length;
        console.log(`🎵 預設音樂載入成功！共載入 ${targetBombs} 個音軌炸彈 (靜態 JSON 快取)`);
    } else {
        throw new Error(data.message || '解析失敗');
    }
  } catch (err) {
    console.error("預設音樂自動載入失敗:", err);
  } finally {
    isAnalyzing = false;
    updateGameState();
  }
}

// -----------------------
// 4. 音訊與事件處理
// -----------------------
const musicSelect = document.getElementById('musicSelect');
const audioUploadLabel = document.getElementById('audio-upload-label');

if (musicSelect) {
  musicSelect.addEventListener('change', async (e) => {
    const mode = e.target.value;
    if (mode === 'default') {
      if (audioUploadLabel) audioUploadLabel.style.display = 'none';
      await preloadDefaultBGM();
    } else if (mode === 'upload') {
      if (audioUploadLabel) audioUploadLabel.style.display = 'block';
      // 清空目前分析的節奏，等待玩家上傳
      musicBeats = [];
      targetBombs = 0;
      if (bgmPlayer) bgmPlayer.src = '';
      if (audioUpload) audioUpload.value = ''; // 重設 file input
      if (audioUploadLabel) {
        audioUploadLabel.textContent = "點此上傳音樂";
        audioUploadLabel.style.borderColor = "#00e5ff";
        audioUploadLabel.style.color = "#00e5ff";
      }
      updateGameState();
    }
  });
}

if (audioUpload) {
  audioUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    await handleAudioFile(file, document.getElementById('audio-upload-label'));
  });
}

const onboardingAudioUpload = document.getElementById('onboardingAudioUpload');
if (onboardingAudioUpload) {
  onboardingAudioUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const onboardingLabel = document.getElementById('onboarding-upload-label');
    await handleAudioFile(file, onboardingLabel);
    
    // 同步主畫面 HUD 的 Label 狀態
    const mainLabel = document.getElementById('audio-upload-label');
    if (mainLabel && onboardingLabel) {
      mainLabel.textContent = onboardingLabel.textContent;
      mainLabel.style.borderColor = onboardingLabel.style.borderColor;
      mainLabel.style.color = onboardingLabel.style.color;
    }
  });
}

const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const restartBtn = document.getElementById('restart-btn');

if (startBtn) {
  startBtn.addEventListener('click', () => {
    if (gameOver) {
      resetToHome();
    } else {
      // 🌟 修正：音樂還沒分析好或沒上傳不能開始
      if (isAnalyzing) {
        alert("音樂正在分析中，請稍候...");
        return;
      }
      if (musicBeats.length === 0) {
        if (musicSelect && musicSelect.value === 'upload') {
          alert("請點擊下方虛線區上傳您的本機音樂檔案以開始遊戲！");
        } else {
          alert("音樂載入解析尚未完成，請稍候...");
        }
        return;
      }
      gameStarted = true;
      if (bgmPlayer) bgmPlayer.play();
      document.getElementById('difficulty-select').style.display = 'none';
    }
    updateGameState();
  });
}

if (pauseBtn) {
  pauseBtn.addEventListener('click', () => {
    gamePaused = !gamePaused;
    if (gamePaused) {
      if (bgmPlayer) bgmPlayer.pause();
    } else {
      if (bgmPlayer) bgmPlayer.play();
    }
    updateGameState();
  });
}

if (restartBtn) {
  restartBtn.addEventListener('click', () => {
    // 🌟 如果還沒開始或已經結束，就直接重來；如果是遊戲中才跳確認
    if (!gameStarted || gameOver) {
      performRestart();
    } else {
      const restartModal = document.getElementById('restart-confirm-modal');
      restartModal.style.display = 'flex';

      document.getElementById('restart-cancel-btn').onclick = () => {
        restartModal.style.display = 'none';
      };

      document.getElementById('restart-confirm-btn').onclick = () => {
        restartModal.style.display = 'none';
        performRestart();
      };
    }
  });
}

const exitGameBtn = document.getElementById('exit-game-btn');
if (exitGameBtn) {
  exitGameBtn.addEventListener('click', () => {
    // 🌟 如果還沒開始或已經結束，就直接結束遊戲；如果是遊戲中才跳確認
    if (!gameStarted || gameOver) {
      performExitGame();
    } else {
      const exitModal = document.getElementById('exit-confirm-modal');
      exitModal.style.display = 'flex';

      document.getElementById('exit-cancel-btn').onclick = () => {
        exitModal.style.display = 'none';
      };

      document.getElementById('exit-confirm-btn').onclick = () => {
        exitModal.style.display = 'none';
        performExitGame();
      };
    }
  });
}

function performRestart() {
  if (bgmPlayer) {
    bgmPlayer.pause();
    bgmPlayer.currentTime = 0;
  }
  resetToHome(false); // 🌟 確定重來後，直接跳回選擇音樂與難度的畫面 (不看故事)
}

function performExitGame() {
  if (bgmPlayer) {
    bgmPlayer.pause();
    bgmPlayer.currentTime = 0;
  }
  resetToHome(true); // 🌟 確定結束後，直接跳回最開端的背景故事與打字機特效畫面！
}

// -----------------------
// 5. 遊戲主迴圈
// -----------------------
function tick() {
  update();
  draw();
  requestAnimationFrame(tick);
}

function update() {
  if (!gameStarted || gameOver || gamePaused) return;

  plane.move();

  // 對拍偵測 (取消未來視，改成節奏點當下才生成炸彈並開始掉落)
  let currentLogicalTime = bgmPlayer.currentTime;
  if (bgmPlayer.ended) {
    if (!window._bgmEndRealTime) {
      window._bgmEndRealTime = performance.now();
      window._bgmDuration = bgmPlayer.duration;
    }
    const elapsed = (performance.now() - window._bgmEndRealTime) / 1000;
    currentLogicalTime = window._bgmDuration + elapsed;
  } else {
    window._bgmEndRealTime = null;
  }

  const currentTime = currentLogicalTime + AUDIO_OFFSET;

  while (currentBeatIndex < musicBeats.length && currentTime >= musicBeats[currentBeatIndex].time) {
    const target = musicBeats[currentBeatIndex];

    // 🌟 讓炸彈從飛機位置掉落 (動態取得寬度)
    const isMobile = window.innerWidth < 768;
    const bombWidth = Bomb.WIDTH * (isMobile ? 0.5 : 1.0);
    const bombX = plane.x + (plane.width - bombWidth) / 2;

    // 🌟 使用 randomVocab().text 獲取隨機手語詞彙
    const vocab = randomVocab();
    
    // 取消未來視後，炸彈生成的當下就是音樂的拍點時間 (spawnTime = target.time)
    bombs.push(new Bomb(bombX, plane.y + (isMobile ? 20 : 40), target.time, target.time, vocab.text, vocab.difficulty, images.bomb, images.explosion));

    totalBombsDropped++;
    currentBeatIndex++;
  }

  // 炸彈更新
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    b.fall(currentLogicalTime, AUDIO_OFFSET);
    b.update(); // 🌟 執行狀態邏輯

    // 1. 偵測落地：只啟動縮放動畫，暫不扣血
    if (!b.impactResolved && (b.y + b.height) >= window.innerHeight) {
      b.startShrink(true); // shouldExplode = true
    }

    // 2. 扣血判定：延後到炸彈真正「消失」前的一刻。
    // 如果在這之前被玩家擊中，b.shouldExplode 會被設為 false，就不會扣血。
    if (b.finished && b.shouldExplode && !b.houseDamageApplied) {
      applyDamage(b);
      b.houseDamageApplied = true;

      // 補回對拍誤差日誌 (只在爆炸時記錄)
      if (b.targetTime !== undefined) {
        const currentRealTime = currentLogicalTime + AUDIO_OFFSET;
        const error = Math.abs(currentRealTime - b.targetTime);
        console.log(`💥 [炸彈爆炸] 誤差: ${error.toFixed(3)} 秒`);
      }
    }

    if (b.finished) bombs.splice(i, 1);
  }

  if (targetBombs > 0 && totalBombsDropped >= targetBombs && bombs.length === 0 && houses.length > 0) {
    endGame(true);
  }
}

function randomVocab() {
  return currentVocabulary[Math.floor(Math.random() * currentVocabulary.length)];
}

function applyDamage(bomb) {
  if (houses.length > 0) {
    let closest = 0;
    let minDist = Infinity;
    const bombCenterX = bomb.x + bomb.width / 2;
    const bombCenterY = bomb.y + bomb.height / 2;

    houses.forEach((h, idx) => {
      const houseCenterX = h.x + h.width / 2;
      const houseCenterY = h.y + h.height / 2;
      const d = Math.hypot(houseCenterX - bombCenterX, houseCenterY - bombCenterY);
      if (d < minDist) { minDist = d; closest = idx; }
    });
    houses.splice(closest, 1);
    if (houses.length === 0) endGame(false);
  }
}

function endGame(isWin) {
  gameStarted = false;
  gameOver = true;
  win = isWin;
  if (bgmPlayer) {
    bgmPlayer.pause();
    bgmPlayer.currentTime = 0;
  }
  handleGameOverUI(isWin);
}

function handleGameOverUI(isWin) {
  const houseBonus = isWin ? (houses.length * 200) : 0;
  const finalScore = score + houseBonus;

  bgmPlayer.pause();
  bgmPlayer.currentTime = 0;

  setTimeout(() => {
    const titleEl = document.getElementById('result-title');
    const statsEl = document.getElementById('result-stats');
    const modal = document.getElementById('result-modal');
    const nameInput = document.getElementById('result-player-name');
    if (nameInput) {
      nameInput.value = commanderName;
    }
    const submitBtn = document.getElementById('result-submit-btn');

    // 🌟 修正：重置送出按鈕的狀態 (否則玩第二局時按鈕會一直卡在「處理中...」)
    submitBtn.disabled = false;
    submitBtn.style.opacity = "1";

    const checkbox = document.getElementById('result-upload-cloud');
    const updateButtonText = () => {
      if (checkbox && checkbox.checked) {
        submitBtn.textContent = "確認並送出成績";
      } else {
        submitBtn.textContent = "僅儲存於本地歷史";
      }
    };
    if (checkbox) {
      checkbox.onchange = updateButtonText;
      updateButtonText();
    }

    titleEl.textContent = isWin ? "🏆 任務成功" : "💥 任務失敗";
    titleEl.style.color = isWin ? "#ffcc00" : "#ff3333";


    statsEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom: 8px;"><span>基礎分數:</span> <span>${score}</span></div>
      <div style="display:flex; justify-content:space-between; margin-bottom: 8px;"><span>房子獎勵:</span> <span>+${houseBonus}</span></div>
      <hr style="border:0; border-top:1px solid #444; margin:10px 0;">
      <div style="display:flex; justify-content:space-between; font-weight:bold; color:#ffcc00; font-size:24px;">
        <span>總計得分:</span> <span>${finalScore}</span>
      </div>
    `;

    modal.style.display = 'flex';

    submitBtn.onclick = () => {
      // 🌟 防連點機制：點擊後立刻停用按鈕並顯示處理中
      submitBtn.disabled = true;
      submitBtn.textContent = "處理中...";
      submitBtn.style.opacity = "0.6";

      const playerName = nameInput.value.trim() || "匿名";
      commanderName = playerName; // 🌟 記憶這局輸入的名稱，下局自動代入
      const checkbox = document.getElementById('result-upload-cloud');
      const shouldUpload = checkbox ? checkbox.checked : false;

      console.log(`[Score Submit] Player: ${playerName}, Score: ${finalScore}, Upload Cloud: ${shouldUpload}`);

      // 1. 永遠存入本地紀錄
      try {
        const historyData = window._memoryHistory || [];
        const newRecord = {
          name: playerName,
          score: finalScore,
          difficulty: getDifficultyText(),
          time: new Date().toLocaleString()
        };

        // 嘗試寫入 localStorage
        try {
          const localData = JSON.parse(localStorage.getItem('tsl_history') || '[]');
          localData.unshift(newRecord);
          localStorage.setItem('tsl_history', JSON.stringify(localData.slice(0, 20)));
        } catch (e) {
          // localStorage 失敗，僅更新記憶體
          historyData.unshift(newRecord);
          window._memoryHistory = historyData.slice(0, 20);
        }
      } catch (e) {
        console.warn("⚠️ 紀錄更新完全失敗");
      }

      // 2. 根據勾選決定是否存雲端
      if (shouldUpload === true) {
        console.log("☁️ 上傳分數至 Firebase...");
        saveScoreToCloud(playerName, finalScore, getDifficultyText())
          .then(() => {
            console.log("✅ 雲端上傳成功");
          })
          .catch((err) => {
            console.error("❌ 雲端上傳失敗:", err);
            alert("雲端連線失敗，分數已存入本地紀錄。");
          })
          .finally(() => {
            modal.style.display = 'none';
            getTop10Scores().then(showLeaderboard);
          });
      } else {
        console.log("🔒 僅儲存於本地。");
        modal.style.display = 'none';
        getTop10Scores().then(showLeaderboard);
      }
    };
  }, 500);
}

async function showLeaderboard(top10) {
  const modal = document.getElementById('leaderboard-modal');
  const list = document.getElementById('leaderboard-list');

  let displayList = top10 || [];
  
  if (displayList.length === 0) {
    console.log("ℹ️ 排行榜資料為空，嘗試讀取本地歷史紀錄或預設檔...");
    try {
      const historyStr = localStorage.getItem('tsl_history');
      if (historyStr) {
        const historyData = JSON.parse(historyStr);
        displayList = historyData.slice(0, 10);
      }
    } catch (e) {
      console.warn("⚠️ 讀取本地歷史失敗:", e);
    }

  }

  // 確保依照分數高低進行排序
  displayList.sort((a, b) => b.score - a.score);

  list.innerHTML = displayList.map((p, i) => {
    let medal = i + 1;
    let color = "#fff";
    if (i === 0) { medal = "🥇"; color = "#ffcc00"; }
    else if (i === 1) { medal = "🥈"; color = "#C0C0C0"; }
    else if (i === 2) { medal = "🥉"; color = "#cd7f32"; }

    return `
      <li style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 10px; border-left: 4px solid ${color}; transition: transform 0.2s;">
        <div style="display: flex; align-items: center; gap: 15px;">
          <span style="font-size: 20px; width: 30px; text-align: center;">${medal}</span>
          <span style="font-weight: bold; font-size: 18px; color: ${color};">${p.name}</span>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 20px; font-weight: bold; color: #0f0;">${p.score}</span>
          <span style="font-size: 12px; color: #888; display: block;">${p.difficulty || "一般"}</span>
        </div>
      </li>
    `;
  }).join('');

  modal.style.display = 'flex';
}

function resetToHome(goToStory = false) {
  initGame();
  
  // 🌟 重置並顯示歡迎彈窗與引導精靈
  const welcomeModal = document.getElementById('welcome-modal');
  const welcomeStoryPhase = document.getElementById('welcome-story-phase');
  const welcomeRulesPhase = document.getElementById('welcome-rules-phase');
  const welcomeMusicPhase = document.getElementById('welcome-music-phase');
  const welcomeDifficultyPhase = document.getElementById('welcome-difficulty-phase');

  if (welcomeModal) {
    welcomeModal.style.opacity = '1';
    welcomeModal.style.display = 'flex';
  }
  
  if (goToStory) {
    // 🌟 跳回故事，並重新播放打字機特效
    if (welcomeStoryPhase) welcomeStoryPhase.style.display = 'flex';
    if (welcomeRulesPhase) welcomeRulesPhase.style.display = 'none';
    if (welcomeMusicPhase) welcomeMusicPhase.style.display = 'none';
    if (welcomeDifficultyPhase) welcomeDifficultyPhase.style.display = 'none';

    if (typeof window.triggerWelcomeStoryTypewriter === 'function') {
      window.triggerWelcomeStoryTypewriter();
    }

    // 🌟 只有「回到故事/結束遊戲」時，才完全清除上傳的本機音樂檔案及標籤樣式，還原至預設音樂狀態
    const onboardingAudioUpload = document.getElementById('onboardingAudioUpload');
    if (onboardingAudioUpload) onboardingAudioUpload.value = '';
    const onboardingLabel = document.getElementById('onboarding-upload-label');
    if (onboardingLabel) {
      onboardingLabel.textContent = "🎵 點此上傳本機音樂檔案";
      onboardingLabel.style.borderColor = "#00e5ff";
      onboardingLabel.style.color = "#00e5ff";
    }

    const audioUpload = document.getElementById('audioUpload');
    if (audioUpload) audioUpload.value = '';
    const mainLabel = document.getElementById('audio-upload-label');
    if (mainLabel) {
      mainLabel.textContent = "點此上傳音樂";
      mainLabel.style.borderColor = "#00e5ff";
      mainLabel.style.color = "#00e5ff";
    }

    // 強制重設音樂選擇狀態為預設音樂，並預載入
    onboardingMusicMode = '';
    window.selectOnboardingMusic('default');
  } else {
    // 🌟 按重新開始後，直接跳回選擇音樂的介面！
    if (welcomeStoryPhase) welcomeStoryPhase.style.display = 'none';
    if (welcomeRulesPhase) welcomeRulesPhase.style.display = 'none';
    if (welcomeMusicPhase) welcomeMusicPhase.style.display = 'flex';
    if (welcomeDifficultyPhase) welcomeDifficultyPhase.style.display = 'none';
    
    // 🌟 重新開始時保留音樂與其解析結果！
    // 由於 initGame() 與 performRestart() 僅重設遊戲數值與暫停音樂，
    // onboardingMusicMode、musicBeats 及 bgmPlayer.src 會被完好保留，
    // 使用者能直接帶著上一次的作戰音樂繼續挑戰！
  }

  // 🌟 重新設定難度卡片為預設第一難度選取狀態
  window.selectOnboardingDifficulty('1');
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.width / dpr;
  const ch = canvas.height / dpr;

  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(images.background, 0, 0, cw, ch);

  // 1. 畫場景物件
  houses.forEach(h => ctx.drawImage(images.house, h.x, h.y, h.width, h.height));
  bombs.forEach(b => b.render(ctx));
  plane.render(ctx);

  // 2. 畫畫布提示 (Overlay)
  if (!gameStarted || gamePaused || gameOver) {
    // 🌟 新增：全螢幕半透明黑幕，讓背景變暗
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, cw, ch);

    let message = "";
    let subMessage = "";
    let color = "#FFF";

    if (gamePaused && !gameOver) {
      message = "⏸ 遊戲暫停";
    } else if (!gameStarted) {
      if (!gesturesLoaded || !modelLoaded) {
        message = "⚡ 正在初始化 AI 模型...";
      } else if (musicBeats.length === 0) {
        message = "🎵 請先上傳音樂檔案";
      }
      // 如果都準備好了但還沒開始，就不顯示任何訊息 (也不顯示框框)
    } else if (gameOver) {
      message = win ? "🏆 任務成功！" : "💥 任務失敗";
      color = win ? "#00ff00" : "#ff3333";
    }

    // 只有當有訊息要顯示時，才畫出背景框
    if (message) {
      const boxW = 500;
      const boxH = 100;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath(); // 🌟 修復路徑殘留 Bug
      ctx.roundRect(cw / 2 - boxW / 2, ch / 2 - boxH / 2 - 20, boxW, boxH, 15);
      ctx.fill();
      ctx.strokeStyle = '#00ccff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = 'bold 32px "Microsoft JhengHei", Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle'; // 🌟 關鍵：設定基準線為中間

      // 框框的中點是 ch / 2 - 20
      ctx.fillText(message, cw / 2, ch / 2 - 20);
    }
  }

  // 3. 畫輔助資訊
  renderCamera();
  if (showDebugOverlay) {
    renderDebugOverlay();
  }
  updateGameState();
}

function updateGameState() {
  const diffSelect = document.getElementById('difficulty-select');
  let diffText = "全部";
  if (diffSelect) {
    if (diffSelect.value === "1") diffText = "等級 1";
    else if (diffSelect.value === "2") diffText = "等級 2";
    else if (diffSelect.value === "3") diffText = "等級 3";
  }

  // 🌟 根據分析狀態控制開始按鈕
  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    if (isAnalyzing) {
      startBtn.disabled = true;
      startBtn.style.opacity = "0.5";
      startBtn.style.cursor = "not-allowed";
      startBtn.textContent = "分析中...";
    } else {
      startBtn.disabled = false;
      startBtn.style.opacity = "1";
      startBtn.style.cursor = "pointer";
      startBtn.textContent = gameOver ? "重新開始" : "開始遊戲";
    }
  }

  // 🌟 根據分析狀態控制前導畫面的「啟動防禦系統」按鈕
  const onboardingStartBtn = document.getElementById('welcome-difficulty-start-btn');
  if (onboardingStartBtn) {
    if (isAnalyzing) {
      onboardingStartBtn.disabled = true;
      onboardingStartBtn.style.cursor = 'not-allowed';
      onboardingStartBtn.style.opacity = '0.6';
      onboardingStartBtn.style.background = 'linear-gradient(135deg, #555, #333)';
      onboardingStartBtn.style.boxShadow = 'none';
      onboardingStartBtn.innerHTML = '⏳ 音樂作戰頻率解析中...';
    } else if (musicBeats.length === 0) {
      onboardingStartBtn.disabled = true;
      onboardingStartBtn.style.cursor = 'not-allowed';
      onboardingStartBtn.style.opacity = '0.6';
      onboardingStartBtn.style.background = 'linear-gradient(135deg, #555, #333)';
      onboardingStartBtn.style.boxShadow = 'none';
      onboardingStartBtn.innerHTML = '⚠️ 尚未載入或解析完作戰音樂';
    } else {
      onboardingStartBtn.disabled = false;
      onboardingStartBtn.style.cursor = 'pointer';
      onboardingStartBtn.style.opacity = '1.0';
      onboardingStartBtn.style.background = 'linear-gradient(135deg, #ff3366, #ff0055)';
      onboardingStartBtn.style.boxShadow = '0 4px 20px rgba(255, 51, 102, 0.4)';
      onboardingStartBtn.innerHTML = '🚀 啟動防禦系統 (開始遊戲)';
    }
  }

  // 🌟 根據分析狀態控制前導畫面的「下一步：設定作戰難度」按鈕
  const onboardingMusicNextBtn = document.getElementById('welcome-music-next-btn');
  if (onboardingMusicNextBtn) {
    if (isAnalyzing) {
      onboardingMusicNextBtn.disabled = true;
      onboardingMusicNextBtn.style.cursor = 'not-allowed';
      onboardingMusicNextBtn.style.opacity = '0.6';
      onboardingMusicNextBtn.style.background = 'linear-gradient(135deg, #555, #333)';
      onboardingMusicNextBtn.style.boxShadow = 'none';
      onboardingMusicNextBtn.innerHTML = '⏳ 音樂頻率解析中，請稍候...';
    } else {
      onboardingMusicNextBtn.disabled = false;
      onboardingMusicNextBtn.style.cursor = 'pointer';
      onboardingMusicNextBtn.style.opacity = '1.0';
      onboardingMusicNextBtn.style.background = 'linear-gradient(135deg, #00e5ff, #0088cc)';
      onboardingMusicNextBtn.style.boxShadow = '0 4px 15px rgba(0, 229, 255, 0.3)';
      onboardingMusicNextBtn.innerHTML = '下一步：設定作戰難度 ⏭️';
    }
  }

  updateHud({
    score, housesCount: houses.length, difficultyText: diffText,
    totalBombsDropped, targetBombs, modelLoaded, gesturesLoaded,
    isAnalyzing, musicBeatsLength: musicBeats.length,
    gameStarted, gameOver, win, gamePaused
  });
}

// -----------------------
// 6. AI 辨識串接
// -----------------------
async function initWebcam() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("您的瀏覽器環境不支援相機 (可能是因為連線不夠安全，請確保是 https 或 localhost)。");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 180 } });
    video.srcObject = stream;
    await video.play();
    lastVideoFrame = video;
    predictLoop();
  } catch (err) {
    console.error("相機啟動失敗:", err);
    alert("相機啟動失敗！原因: " + err.message + "\n請確認您已允許相機權限，且沒有其他程式正在佔用相機。");
  }
}


async function predictLoop() {
  if (lastVideoFrame && aiManager.handLandmarker) {
    const ts = performance.now();
    frameCount++;

    const handRes = aiManager.handLandmarker.detectForVideo(lastVideoFrame, ts);
    // 🌟 降低姿勢偵測頻率：改為每 10 幀偵測一次，將更多效能留給手部偵測，減少延遲感
    if (frameCount % 10 === 0 || !lastPoseRes) {
      lastPoseRes = aiManager.poseLandmarker.detectForVideo(lastVideoFrame, ts);
    }

    const landmarks = handRes.landmarks || [];
    const handedness = handRes.handednesses || [];

    if (landmarks.length > 0) {
      lastHandLandmarks = landmarks;
      handMissFrameCount = 0;

      let leftHand = null, rightHand = null;
      landmarks.forEach((lm, idx) => {
        const label = handedness[idx] && handedness[idx][0] ? handedness[idx][0].categoryName : "";
        if (label === 'Left') leftHand = lm;
        else if (label === 'Right') rightHand = lm;
      });

      const frame = extractFrame66({
        leftHandLandmarks: leftHand,
        rightHandLandmarks: rightHand,
        poseLandmarks: (lastPoseRes && lastPoseRes.landmarks) ? lastPoseRes.landmarks[0] : null
      });

      featureBuffer.push(frame);
      if (featureBuffer.length > MODEL_FRAMES) featureBuffer.shift();

      if (featureBuffer.length === MODEL_FRAMES && inferenceCooldown <= 0) {
        inferenceFrameCount++;
        // 🌟 設定滑窗步長：改為每 3 幀進行一次辨識 (加強即時感)
        if (inferenceFrameCount % 3 === 0 && !isInferencing) {
          isInferencing = true;
          aiManager.runInference(featureBuffer, labelMap, currentVocabulary).then(res => {
            isInferencing = false;
            if (res) {
              lastDebugInfo = res;
              checkHit(res.label, res.confidence);
            }
          }).catch(() => { isInferencing = false; });
        }
      }
    } else {
      // 🌟 沒抓到手
      lastHandLandmarks = null; // 🌟 視覺效果立刻消失！
      handMissFrameCount++;
      if (handMissFrameCount > HAND_PERSISTENCE_FRAMES) {
        featureBuffer = []; // 🌟 等一下再清空 AI 記憶，避免辨識中斷
        disabledHitLabel = ""; // 🌟 手放下了，立刻解除詞彙擊中鎖定，允許下次比相同手勢
      }
    }
    if (inferenceCooldown > 0) inferenceCooldown--;
  }
    requestAnimationFrame(predictLoop); 
}

function checkHit(label, confidence) {
  const thresholds = getThresholdsForWord(label);

  // 🌟 智慧解鎖機制：如果分數跌到門檻以下，代表玩家的手勢已經「收回/放鬆」，立刻自動解鎖！
  // 這樣一來，即使玩家手沒放下，只要有「手勢收回再比出」的動作起伏，就能流暢地比第二次並成功消除！
  if (label === disabledHitLabel && confidence < thresholds.exception) {
    disabledHitLabel = "";
  }

  // 🌟 如果目前辨識出的詞彙跟剛才擊中的詞彙一樣，且玩家還沒有放下手或變換手勢，則直接忽略，防連擊 Bug
  if (label === disabledHitLabel) {
    return;
  }
  // 如果玩家變換了別的手勢，立刻解除鎖定
  if (label !== disabledHitLabel && disabledHitLabel !== "") {
    disabledHitLabel = "";
  }

  const isConsistent = (label === lastInferenceLabel);

  const isPassed = (confidence >= thresholds.direct) || (isConsistent && confidence >= thresholds.exception);
  lastInferenceLabel = label;

  const progressEl = document.getElementById('progress');
  if (isPassed && gameStarted) {
    let targetBombIdx = -1;
    let maxY = -1;

    for (let i = 0; i < bombs.length; i++) {
      const b = bombs[i];
      // 🌟 修正：一旦炸彈開始爆開 (exploding)，就不允許再被擊中/救回，以維持視覺邏輯合理性
      // 救援（神速救援）必須在落地收縮 (shrinking) 期間比完手勢才算成功！
      if (b.word === label && !b.finished && !b.exploding) {
        // 權重計算：越下面的越優先，正在落地收縮的給予極大加權
        let weight = b.y;
        if (b.shrinking && b.shouldExplode) weight += 5000;

        if (weight > maxY) {
          maxY = weight;
          targetBombIdx = i;
        }
      }
    }

    if (targetBombIdx !== -1) {
      const targetBomb = bombs[targetBombIdx];
      const diffLevel = WORD_DIFFICULTY[label] || 1;
      const points = 50 * diffLevel;
      score += points;

      console.log(`🎯 [手語成功偵測 & 擊中] 詞彙: "${label}" | 推理分數: ${confidence.toFixed(2)} (判定門檻: ${thresholds.direct.toFixed(2)}) | 成功消除炸彈！`);

      // ⚡ 判定邏輯：必須在尚未爆開（僅落地收縮中）被擊中，才判定為神速救援
      if (targetBomb.shrinking && targetBomb.shouldExplode) {
        score -= 10; // 🌟 懲罰：神速救援扣 10 分
        if (progressEl) progressEl.textContent = `進度: ⚡ 神速救援！[${label}] (+${points - 10})`;
        targetBomb.shouldExplode = false; // 🌟 關鍵：救回成功，不准爆炸扣血
      } else {
        if (progressEl) progressEl.textContent = `進度: 💥 擊中 [${label}] (+${points})!`;
        targetBomb.shouldExplode = false; // 🌟 正常擊中也不准扣血
      }

      targetBomb.finished = true; // 🌟 瞬間消失

      // 🌟 鎖定此詞彙，要求玩家必須先「放開手勢」或「變換手勢」才能再次擊中相同的詞彙！
      disabledHitLabel = label;

      // 🌟 優化：防止同詞彙「連擊」現象
      // 修改為較短的幀數（例如 15~20 幀），搭配解鎖鎖定機制即可：
      inferenceCooldown = 20;
      // 2. 強制清空上次辨識標籤，要求玩家必須「重新累積」能量才能再次擊中
      lastInferenceLabel = "";
    } else {
      console.log(`🔍 [手語成功偵測] 詞彙: "${label}" | 推理分數: ${confidence.toFixed(2)} (判定門檻: ${thresholds.direct.toFixed(2)}) | 但目前畫面上無對應炸彈`);
      if (progressEl) progressEl.textContent = `進度: 🔍 辨識為 [${label}] 但畫面上沒這顆炸彈`;
    }
  } else {
    if (progressEl && gameStarted) progressEl.textContent = `進度: 辨識中...`;
  }
}

function extractFrame66(results) {
  // 這裡假設 holistic_features.js 提供了全域函式，或我們手動實作
  // 為了簡化，目前假設 extractFrame66 存在於全域 (holistic_features.js 提供)
  return window.extractFrame66 ? window.extractFrame66(results) : new Float32Array(66);
}

// -----------------------
// 7. 渲染輔助
// -----------------------
function renderCamera() {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.width / dpr;
  const ch = canvas.height / dpr;
  const isMobile = cw < 768;
  const camW = isMobile ? 120 : 320;
  const camH = isMobile ? 68 : 180;
  const camX = cw - camW - 10;
  const camY = 10;

  // 1. 畫視頻 (鏡像)
  ctx.save();
  ctx.translate(camX + camW, camY);
  ctx.scale(-1, 1);
  if (lastVideoFrame) {
    ctx.drawImage(lastVideoFrame, 0, 0, camW, camH);
  } else {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, camW, camH);
  }
  ctx.restore();

  // 2. 畫骨架 (手部)
  if (ctx && lastHandLandmarks && Array.isArray(lastHandLandmarks)) {
    ctx.save();

    // 🌟 新增：加入裁切區域 (Clipping Region)，確保手部骨架就算超出鏡頭範圍也不會畫到遊戲畫面中
    ctx.beginPath();
    ctx.rect(camX, camY, camW, camH);
    ctx.clip();

    // 定義基礎連線 (硬編碼備援)
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
    ];

    ctx.strokeStyle = "#00FF00";
    ctx.lineWidth = isMobile ? 2 : 4; // 手機版線寬調小
    ctx.lineCap = "round";

    for (const hand of lastHandLandmarks) {
      if (!hand || !Array.isArray(hand)) continue;

      connections.forEach(([s, e]) => {
        const p1 = hand[s];
        const p2 = hand[e];
        if (p1 && p2) {
          // 🌟 直接手動計算鏡像與位移座標 (最穩健)
          // 鏡像公式：camX + (1 - normalizedX) * camW
          const x1 = camX + (1 - p1.x) * camW;
          const y1 = camY + p1.y * camH;
          const x2 = camX + (1 - p2.x) * camW;
          const y2 = camY + p2.y * camH;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      });
    }
    ctx.restore();
  }

  // 3. 畫外框 (改為柔和藍邊)
  ctx.strokeStyle = 'rgba(0, 204, 255, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(camX, camY, camW, camH);
}

function renderDebugOverlay() {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.width / dpr;
  const ch = canvas.height / dpr;
  const isMobile = cw < 768;
  const boxW = isMobile ? 220 : 420;
  const boxH = isMobile ? 120 : 180;
  const x = 10, y = ch - boxH - 10;

  // 🌟 恢復：繪製半透明圓角背景與外框線 (這部分會隨著 showDebugOverlay 變數一同被隱藏或顯示)
  ctx.fillStyle = 'rgba(10, 15, 30, 0.5)';
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 15);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#00ffcc';
  ctx.font = `bold ${isMobile ? 9 : 13}px monospace`;
  ctx.textAlign = 'left';

  // 第一行：狀態資訊
  const handIndicator = lastHandLandmarks ? 'YES' : 'NO';
  ctx.fillText(`[Buf] ${featureBuffer.length}/30 | [Hand] ${handIndicator} | [CD] ${inferenceCooldown}`, x + 8, y + (isMobile ? 15 : 20));

  if (lastDebugInfo) {
    ctx.fillStyle = '#ff0';
    ctx.fillText(`=== AI 即時辨識 (信心值) ===`, x + 8, y + (isMobile ? 35 : 45));
    lastDebugInfo.top4.forEach((p, i) => {
      ctx.fillStyle = '#fff';
      ctx.fillText(`${p.label}: ${p.prob.toFixed(1)}`, x + 8, y + (isMobile ? 52 : 65) + i * (isMobile ? 12 : 18));

      // 畫信心值條
      const barW = Math.min(isMobile ? 50 : 100, p.prob * (isMobile ? 10 : 20));
      ctx.fillStyle = '#444';
      ctx.fillRect(x + (isMobile ? 120 : 150), y + (isMobile ? 44 : 55) + i * (isMobile ? 12 : 18), isMobile ? 50 : 100, isMobile ? 6 : 10);
      const thresholds = getThresholdsForWord(p.label);
      ctx.fillStyle = (p.prob >= thresholds.direct) ? '#0f0' : '#888';
      ctx.fillRect(x + (isMobile ? 120 : 150), y + (isMobile ? 44 : 55) + i * (isMobile ? 12 : 18), barW, isMobile ? 6 : 10);
    });
  }
}

// 啟動！
startApp();

// -----------------------
// 8. 綁定 UI 事件 (新增自動暫停邏輯)
// -----------------------
