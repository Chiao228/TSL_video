/**
 * app.js: 台灣手語學習遊戲 (終極流暢優化版)
 */

import {
  getCanvasWidth, getCanvasHeight, AUDIO_OFFSET, HOUSE_COUNT, HOUSE_WIDTH, HOUSE_HEIGHT,
  HOUSE_MARGIN_BOTTOM, WORD_DIFFICULTY, DIRECT_HIT_THRESHOLD, EXCEPTION_THRESHOLD,
  MODEL_FRAMES, FEATURE_DIM, getThresholdsForWord
} from './config.js?v=20260519';

import { FilesetResolver, HandLandmarker, PoseLandmarker, DrawingUtils } from "./vision_bundle.mjs";

import { Plane, Bomb } from './game_objects.js?v=20260519';
import { AIManager } from './ai_manager.js?v=20260519';
import { updateHud, renderHistory, loadTutorialVideos } from './ui_manager.js?v=20260521_v2';
import { analyzeBeatsSmartJS } from './audio_processor.js?v=20260519'; 
import { saveScoreToCloud, getTop10Scores } from './firebase_manager.js?v=20260519';

// -----------------------
// 2. 全域狀態變數
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
let disabledHitLabel = ""; 
let lastDebugInfo = null;
let frameCount = 0;
let inferenceFrameCount = 0;
let slidingWindowIndex = 0;
let gameInferenceHistory = [];
let isInferencing = false; 
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
window._memoryHistory = []; 
let showDebugOverlay = false;

let lastHudUpdateTime = 0; 
let lastPoseDetectTime = 0;

// -----------------------
// 3. Onboarding 專屬狀態與全域選擇函數
// -----------------------
let onboardingMusicMode = '';
let onboardingDifficultyLevel = '1';

async function handleAudioFile(file, label) {
  if (!file) return;

  if (label) {
    const fileName = file.name.replace(/\.[^/.]+$/, ""); 
    const displayName = fileName.length > 12 ? fileName.substring(0, 10) + "..." : fileName;
    label.textContent = `🎵 ${displayName}`;
    label.style.borderColor = "rgba(0, 229, 255, 0.5)";
    label.style.color = "#fff";
  }

  isAnalyzing = true;
  updateGameState(true); 
  try {
    bgmPlayer.src = URL.createObjectURL(file);
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const beats = await analyzeBeatsSmartJS(audioBuffer);
    
    if (onboardingMusicMode !== 'upload') return;
    if (!beats || beats.length === 0) throw new Error("此音樂檔案中未能解析出足夠的節奏點！");
    
    musicBeats = beats.map(b => ({ time: b.time }));
    targetBombs = musicBeats.length;
    console.log(`✅ 節奏解析完成！共產出 ${targetBombs} 顆炸彈。`);
  } catch (err) {
    console.error(err);
    alert(err.message || "音樂解析失敗！");
  } finally {
    isAnalyzing = false;
    updateGameState(true);
  }
}

window.selectOnboardingMusic = async (mode) => {
  if (onboardingMusicMode === mode) return; 
  onboardingMusicMode = mode;
  const cardDefault = document.getElementById('music-card-default');
  const cardUpload = document.getElementById('music-card-upload');
  const uploadArea = document.getElementById('onboarding-upload-area');
  const mainMusicSelect = document.getElementById('musicSelect');
  const mainAudioUploadLabel = document.getElementById('audio-upload-label');
  
  if (mode === 'default') {
    if (cardDefault) { cardDefault.style.background = 'rgba(0, 229, 255, 0.1)'; cardDefault.style.borderColor = '#00e5ff'; }
    if (cardUpload) { cardUpload.style.background = 'rgba(255, 255, 255, 0.02)'; cardUpload.style.borderColor = 'rgba(255,255,255,0.1)'; }
    if (uploadArea) uploadArea.style.display = 'none';
    if (mainMusicSelect) mainMusicSelect.value = 'default';
    if (mainAudioUploadLabel) mainAudioUploadLabel.style.display = 'none';
    await preloadDefaultBGM();
  } else {
    if (cardUpload) { cardUpload.style.background = 'rgba(0, 229, 255, 0.1)'; cardUpload.style.borderColor = '#00e5ff'; }
    if (cardDefault) { cardDefault.style.background = 'rgba(255, 255, 255, 0.02)'; cardDefault.style.borderColor = 'rgba(255,255,255,0.1)'; }
    if (uploadArea) uploadArea.style.display = 'block';
    if (mainMusicSelect) mainMusicSelect.value = 'upload';
    if (mainAudioUploadLabel) mainAudioUploadLabel.style.display = 'block';
    musicBeats = []; targetBombs = 0;
    if (bgmPlayer) bgmPlayer.src = '';
    updateGameState(true);
  }
};

window.selectOnboardingDifficulty = (level) => {
  onboardingDifficultyLevel = level;
  for (let i = 1; i <= 3; i++) {
    const card = document.getElementById(`diff-card-${i}`);
    if (card) {
      const isSelected = (i === parseInt(level));
      const emojiSpan = card.querySelector('span');
      const textH4 = card.querySelector('h4');
      if (emojiSpan) emojiSpan.textContent = '⭐'.repeat(i);
      
      if (isSelected) {
        let activeColor = i === 1 ? '#2ecc71' : i === 2 ? '#00e5ff' : '#ff3366';
        card.style.background = `${activeColor}1A`;
        card.style.borderColor = activeColor;
        if (textH4) { textH4.style.color = activeColor; textH4.textContent = `等級 ${i} (${i===1?'簡易':i===2?'中等':'困難'})`; }
      } else {
        card.style.background = 'rgba(255, 255, 255, 0.02)';
        card.style.borderColor = 'rgba(255,255,255,0.1)';
        if (textH4) { textH4.style.color = '#fff'; textH4.textContent = `等級 ${i} (${i===1?'簡易':i===2?'中等':'困難'})`; }
      }
    }
  }
  const mainDiffSelect = document.getElementById('difficulty-select');
  if (mainDiffSelect) mainDiffSelect.value = level;
  updateVocabulary();
};

// -----------------------
// 4. UI 事件繫結
// -----------------------
function setupEventListeners() {
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'flex';
    if (gameStarted && !gamePaused && !gameOver) {
      window.forcePauseGameFromHTML();
    }
  }

  document.getElementById('history-btn').onclick = () => { renderHistory(); openModal('history-modal'); };
  document.getElementById('rules-btn').onclick = () => openModal('rules-modal');
  document.getElementById('close-rules-btn').onclick = () => { document.getElementById('rules-modal').style.display = 'none'; };
  document.getElementById('tutorial-btn').onclick = () => { openModal('tutorial-modal'); loadTutorialVideos(); };
  document.getElementById('close-tutorial-btn').onclick = () => { document.getElementById('tutorial-modal').style.display = 'none'; };
  document.getElementById('close-history-btn').onclick = () => { document.getElementById('history-modal').style.display = 'none'; };
  document.getElementById('difficulty-select').onchange = updateVocabulary;
  
  document.getElementById('pause-btn').onclick = () => window.forcePauseGameFromHTML();
  document.getElementById('restart-btn').onclick = () => window.forceRestartGameFromHTML();
  document.getElementById('exit-game-btn').onclick = () => window.forceExitGameFromHTML();
  
  const leaderboardRestartBtn = document.getElementById('leaderboard-restart-btn');
  if (leaderboardRestartBtn) {
    leaderboardRestartBtn.onclick = () => window.forcePlayAgainFromLeaderboard();
  }

  const uploadCloudCb = document.getElementById('result-upload-cloud');
  const resultSubmitBtn = document.getElementById('result-submit-btn');
  const resultLocalBtn = document.getElementById('result-local-btn');
  if (uploadCloudCb && resultSubmitBtn && resultLocalBtn) {
    uploadCloudCb.onchange = () => {
      if (uploadCloudCb.checked) {
        resultSubmitBtn.style.display = 'block';
        resultLocalBtn.style.display = 'none';
      } else {
        resultSubmitBtn.style.display = 'none';
        resultLocalBtn.style.display = 'block';
      }
    };
  }

  const exportCsvBtn = document.getElementById('export-csv-btn');
  if (exportCsvBtn) {
    exportCsvBtn.onclick = () => window.exportInferenceHistoryToCSV();
  }

  const toggleDebugBtn = document.getElementById('toggle-debug-btn');
  if (toggleDebugBtn) {
    toggleDebugBtn.textContent = showDebugOverlay ? "📊 隱藏偵測資訊" : "📊 顯示偵測資訊";
    toggleDebugBtn.onclick = () => {
      showDebugOverlay = !showDebugOverlay;
      toggleDebugBtn.textContent = showDebugOverlay ? "📊 隱藏偵測資訊" : "📊 顯示偵測資訊";
    };
  }

  document.getElementById('welcome-skip-btn').onclick = () => {
    if (window._typingTimeout) clearTimeout(window._typingTimeout);
    document.getElementById('welcome-story-phase').style.display = 'none';
    document.getElementById('welcome-rules-phase').style.display = 'flex';
  };
  document.getElementById('welcome-rules-next-btn').onclick = () => {
    document.getElementById('welcome-rules-phase').style.display = 'none';
    document.getElementById('welcome-music-phase').style.display = 'flex';
  };

  // 🔥【核心優化】音樂解析完成前，強制封鎖下一步按鈕，杜絕帶空資料強行過關
  document.getElementById('welcome-music-next-btn').onclick = () => {
    if (isAnalyzing || musicBeats.length === 0) {
      alert("⚠️ 作戰提示：請先等待音樂解析完畢，或上傳您的本機音樂檔案以供 AI 分析！");
      return;
    }
    document.getElementById('welcome-music-phase').style.display = 'none';
    document.getElementById('welcome-difficulty-phase').style.display = 'flex';
  };

  const storyText = `在不久的未來，「手語小鎮」正遭受戰鬥機的轟炸襲擊！作為防衛隊長，你必須啟動 AI 辨識系統，在炸彈落地前比出對應的手語詞彙，利用手語的能量將炸彈在空中消滅，保衛小鎮居民與房屋！`;
  const storyEl = document.getElementById('welcome-story-text');

  window.triggerWelcomeStoryTypewriter = () => {
    if (window._typingTimeout) clearTimeout(window._typingTimeout);
    if (storyEl) {
      storyEl.textContent = ""; let index = 0;
      const typeWriter = () => {
        if (index < storyText.length) {
          storyEl.textContent = storyText.substring(0, index + 1) + "▌"; index++;
          window._typingTimeout = setTimeout(typeWriter, 35);
        } else {
          storyEl.textContent = storyText;
          const skipBtn = document.getElementById('welcome-skip-btn');
          if (skipBtn) {
            skipBtn.textContent = "下一步：查看作戰守則 ⏭️";
            skipBtn.style.background = "linear-gradient(135deg, #00e5ff, #0088cc)";
            skipBtn.style.color = "#050a14"; skipBtn.style.border = "none";
          }
        }
      };
      window._typingTimeout = setTimeout(typeWriter, 400);
    }
  };

  window.triggerWelcomeStoryTypewriter();
  window.selectOnboardingDifficulty('1');

  // 音量
  const volumeSlider = document.getElementById('volume-slider');
  const volumeIcon = document.getElementById('volume-icon');
  const volumeValue = document.getElementById('volume-value');
  if (bgmPlayer) bgmPlayer.volume = 0.1;

  if (volumeSlider && volumeValue) {
    volumeSlider.value = 0.1; volumeValue.textContent = '10%';
    volumeSlider.oninput = (e) => {
      const vol = parseFloat(e.target.value); bgmPlayer.volume = vol;
      volumeValue.textContent = Math.round(vol * 100) + '%';
      volumeIcon.textContent = vol === 0 ? '🔈' : vol < 0.5 ? '🔉' : '🔊';
    };
  }

  // Onboarding File Upload
  const onboardingAudioUpload = document.getElementById('onboardingAudioUpload');
  const onboardingUploadLabel = document.getElementById('onboarding-upload-label');
  if (onboardingAudioUpload && onboardingUploadLabel) {
    onboardingAudioUpload.onchange = (e) => {
      const file = e.target.files[0];
      handleAudioFile(file, onboardingUploadLabel);
    };
  }

  // Main Screen File Upload
  const audioUpload = document.getElementById('audioUpload');
  const audioUploadLabel = document.getElementById('audio-upload-label');
  if (audioUpload) {
    audioUpload.onchange = (e) => {
      const file = e.target.files[0];
      handleAudioFile(file, audioUploadLabel);
    };
  }

  // Initialize loading of default music
  window.selectOnboardingMusic('default');
}
setTimeout(setupEventListeners, 300);

// ==========================================================================
// 🛡️ 5. 全域實體控制中心：全面替代 .addEventListener 防止監聽器重刷脫鉤
// ==========================================================================

// 🚀 啟動防禦/開始遊戲
window.forceStartGameFromHTML = function() {
  console.log("🎯 觸發遊戲啟動！");
  if (isAnalyzing || musicBeats.length === 0) return alert("音樂尚未解析完畢，請稍候！");

  if (bgmPlayer) {
    bgmPlayer.play().catch(() => {
      console.warn("⚠️ 自動播放受阻，已掛載備援隔離網。");
    });
  }

  gameStarted = true; gameOver = false; gamePaused = false;
  
  const welcomeModal = document.getElementById('welcome-modal');
  if (welcomeModal) {
    welcomeModal.style.pointerEvents = 'none';
    welcomeModal.style.display = 'none';
  }
  document.getElementById('difficulty-select').style.display = 'none';
  const exportCsvBtn = document.getElementById('export-csv-btn');
  if (exportCsvBtn) exportCsvBtn.style.display = 'block';
  updateGameState(true);
  
  window.addEventListener('click', forceAudioContextUnlock);
  window.addEventListener('touchstart', forceAudioContextUnlock);
};

function forceAudioContextUnlock() {
  if (!gameStarted || gameOver || gamePaused) return;
  if (bgmPlayer && bgmPlayer.paused) {
    bgmPlayer.play().then(() => {
      console.log("🎵 [物理解鎖成功] 音訊時間軸流動！");
      window.removeEventListener('click', forceAudioContextUnlock);
      window.removeEventListener('touchstart', forceAudioContextUnlock);
    });
  }
}

// ⏸️ 暫停與繼續 
window.forcePauseGameFromHTML = function() {
  console.log("🎯 暫停/繼續狀態切換");
  gamePaused = !gamePaused;
  if (bgmPlayer) {
    if (gamePaused) bgmPlayer.pause();
    else bgmPlayer.play().catch(() => {});
  }
  updateGameState(true);
};

// 🔄 重新開始
window.forceRestartGameFromHTML = function() {
  console.log("🎯 重新開始請求");
  if (!gameStarted || gameOver) {
    performRestartAction();
  } else {
    const rm = document.getElementById('restart-confirm-modal');
    if (rm) {
      rm.style.display = 'flex';
      document.getElementById('restart-cancel-btn').onclick = () => rm.style.display = 'none';
      document.getElementById('restart-confirm-btn').onclick = () => {
        rm.style.display = 'none';
        performRestartAction();
      };
    }
  }
};

// 🚪 結束遊戲任務
window.forceExitGameFromHTML = function() {
  console.log("🎯 結束遊戲請求");
  if (!gameStarted || gameOver) {
    performExitGameAction();
  } else {
    const exitModal = document.getElementById('exit-confirm-modal');
    if (exitModal) {
      exitModal.style.display = 'flex';
      document.getElementById('exit-cancel-btn').onclick = () => exitModal.style.display = 'none';
      document.getElementById('exit-confirm-btn').onclick = () => {
        exitModal.style.display = 'none';
        performExitGameAction();
      };
    }
  }
};

function performRestartAction() {
  if (bgmPlayer) { bgmPlayer.pause(); bgmPlayer.currentTime = 0; }
  resetToHome(false);
}

function performExitGameAction() {
  if (bgmPlayer) { bgmPlayer.pause(); bgmPlayer.currentTime = 0; }
  resetToHome(true); 
}

// 📋 關閉排行榜並回到故事背景
window.forceCloseLeaderboard = function() {
  const modal = document.getElementById('leaderboard-modal');
  if (modal) modal.style.display = 'none';
  resetToHome(true);
};

// 🎮 再玩一次：關閉排行榜並回到音樂選擇階段
window.forcePlayAgainFromLeaderboard = function() {
  const modal = document.getElementById('leaderboard-modal');
  if (modal) modal.style.display = 'none';
  if (bgmPlayer) { bgmPlayer.pause(); bgmPlayer.currentTime = 0; }
  resetToHome(false);
};

// -----------------------
// 6. 遊戲核心管線與循環
// -----------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const video = document.createElement('video'); 
const audioUpload = document.getElementById('audioUpload');
const bgmPlayer = document.getElementById('bgmPlayer');

let bombs = []; let houses = []; let plane = null;
const aiManager = new AIManager();

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const images = { background: new Image(), house: new Image(), plane: new Image(), bomb: new Image(), explosion: new Image() };
images.background.src = 'background.jpg'; images.house.src = 'house.png'; images.plane.src = 'plane.png'; images.bomb.src = 'bomb.png'; images.explosion.src = 'explosion.png';

async function startApp() {
  try {
    await aiManager.init(); await loadVocab(); initGame(); await initWebcam();
    modelLoaded = true; gesturesLoaded = true; tick();
  } catch (err) { console.error("啟動失敗:", err); }
}

async function loadVocab() {
  try {
    const response = await fetch('./label_map.json');
    if (!response.ok) throw new Error();
    labelMap = await response.json();
  } catch (e) { alert("❌ 找不到標籤檔 label_map.json！"); throw e; }
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
  currentVocabulary = val === 'all' ? [...fullVocabulary] : fullVocabulary.filter(v => v.difficulty === parseInt(val));
}

function getDifficultyText() {
  const diffSelect = document.getElementById('difficulty-select');
  return !diffSelect ? "一般" : diffSelect.value === 'all' ? "綜合" : `等級 ${diffSelect.value}`;
}

function initGame() {
  score = 0; gameOver = false; gamePaused = false; gameStarted = false;
  bombs = []; currentBeatIndex = 0; totalBombsDropped = 0;
  slidingWindowIndex = 0;
  gameInferenceHistory = [];
  plane = new Plane(images.plane); window._bgmEndRealTime = null;
  initHouses(); updateGameState(true);
}

function initHouses() {
  houses = []; const cw = window.innerWidth, ch = window.innerHeight; const isMobile = cw < 768;
  const houseWidth = HOUSE_WIDTH * (isMobile ? 0.65 : 1.0);
  const houseHeight = HOUSE_HEIGHT * (isMobile ? 0.65 : 1.0);
  const houseMarginBottom = HOUSE_MARGIN_BOTTOM * (isMobile ? 0.65 : 1.0);
  const rightLimit = cw - (isMobile ? 130 : 330);
  const step = (rightLimit - houseWidth) / Math.max(1, (HOUSE_COUNT - 1));

  for (let i = 0; i < HOUSE_COUNT; i++) {
    let x = (i * step) + (Math.random() * 40 - 20); x = Math.max(0, Math.min(x, rightLimit - houseWidth));
    let y = ch - houseHeight - houseMarginBottom + (Math.random() * 10 - 5);
    houses.push({ x, y, width: houseWidth, height: houseHeight });
  }
}

async function preloadDefaultBGM() {
  isAnalyzing = true; updateGameState(true);
  try {
    if (bgmPlayer) bgmPlayer.src = 'default_bgm.mp3';
    const res = await fetch('default_bgm_beats.json');
    const data = await res.json();
    if (data.status === 'success' && onboardingMusicMode === 'default') {
        musicBeats = data.beat_times.map(t => ({ time: t })); targetBombs = musicBeats.length;
    }
  } catch (err) { console.error(err); } finally { isAnalyzing = false; updateGameState(true); }
}

// -----------------------
// 7. 遊戲主迴圈
// -----------------------
function tick() {
  update(); draw(); requestAnimationFrame(tick);
}

function update() {
  if (!gameStarted || gameOver || gamePaused) return;
  plane.move();

  let currentLogicalTime = bgmPlayer.currentTime;
  if (bgmPlayer.ended) {
    if (!window._bgmEndRealTime) { window._bgmEndRealTime = performance.now(); window._bgmDuration = bgmPlayer.duration; }
    currentLogicalTime = window._bgmDuration + (performance.now() - window._bgmEndRealTime) / 1000;
  } else { window._bgmEndRealTime = null; }

  const currentTime = currentLogicalTime + AUDIO_OFFSET;

  while (currentBeatIndex < musicBeats.length && currentTime >= musicBeats[currentBeatIndex].time) {
    const target = musicBeats[currentBeatIndex]; const isMobile = window.innerWidth < 768;
    const bombX = plane.x + (plane.width - Bomb.WIDTH * (isMobile ? 0.5 : 1.0)) / 2;
    const vocab = randomVocab();
    bombs.push(new Bomb(bombX, plane.y + (isMobile ? 20 : 40), target.time, target.time, vocab.text, vocab.difficulty, images.bomb, images.explosion));
    totalBombsDropped++; currentBeatIndex++;
  }

  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i]; b.fall(currentLogicalTime, AUDIO_OFFSET); b.update(); 
    if (!b.impactResolved && (b.y + b.height) >= window.innerHeight) b.startShrink(true);
    if (b.finished && b.shouldExplode && !b.houseDamageApplied) { applyDamage(b); b.houseDamageApplied = true; }
    if (b.finished) bombs.splice(i, 1);
  }

  if (targetBombs > 0 && totalBombsDropped >= targetBombs && bombs.length === 0 && houses.length > 0) endGame(true);
}

function randomVocab() { return currentVocabulary[Math.floor(Math.random() * currentVocabulary.length)]; }

function applyDamage(bomb) {
  if (houses.length === 0) return;
  let closest = 0; let minDist = Infinity;
  const bX = bomb.x + bomb.width / 2; const bY = bomb.y + bomb.height / 2;
  houses.forEach((h, idx) => {
    const d = Math.hypot((h.x + h.width / 2) - bX, (h.y + h.height / 2) - bY);
    if (d < minDist) { minDist = d; closest = idx; }
  });
  houses.splice(closest, 1);
  if (houses.length === 0) endGame(false);
}

// -----------------------
// 8. 結算與排行榜管線
// -----------------------
function endGame(isWin) {
  gameStarted = false; gameOver = true; win = isWin;
  if (bgmPlayer) { bgmPlayer.pause(); bgmPlayer.currentTime = 0; }
  handleGameOverUI(isWin);
}

function handleGameOverUI(isWin) {
  const houseBonus = isWin ? (houses.length * 200) : 0;
  const finalScore = score + houseBonus;
  const modal = document.getElementById('result-modal');
  document.getElementById('result-player-name').value = commanderName;
  
  const uploadCloudCb = document.getElementById('result-upload-cloud');
  const submitBtn = document.getElementById('result-submit-btn');
  const localBtn = document.getElementById('result-local-btn');
  
  if (uploadCloudCb) uploadCloudCb.checked = true;
  if (submitBtn) {
    submitBtn.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
    submitBtn.textContent = '🚀 確認並上傳';
  }
  if (localBtn) {
    localBtn.style.display = 'none';
    localBtn.disabled = false;
    localBtn.style.opacity = '1';
    localBtn.textContent = '💾 僅儲存本機';
  }
  
  document.getElementById('result-title').textContent = isWin ? "🏆 任務成功" : "💥 任務失敗";
  document.getElementById('result-title').style.color = isWin ? "#ffcc00" : "#ff3333";
  document.getElementById('result-stats').innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:8px;"><span>基礎分數:</span> <span>${score}</span></div>
    <div style="display:flex; justify-content:space-between; margin-bottom:8px;"><span>房子獎勵:</span> <span>+${houseBonus}</span></div>
    <hr style="border:0; border-top:1px solid #444; margin:10px 0;">
    <div style="display:flex; justify-content:space-between; font-weight:bold; color:#ffcc00; font-size:24px;"><span>總計得分:</span> <span>${finalScore}</span></div>
  `;
  modal.style.display = 'flex';
  
  const pNameInput = document.getElementById('result-player-name');
  
  if (submitBtn) {
    submitBtn.onclick = async () => {
      submitBtn.disabled = true; submitBtn.textContent = "上傳中...";
      const pName = pNameInput.value.trim() || "匿名";
      commanderName = pName;
      
      // 再次確認 checkbox 狀態，防止按鈕顯示與勾選狀態不同步
      const shouldUpload = uploadCloudCb ? uploadCloudCb.checked : false;
      
      if (shouldUpload) {
        try {
          await saveScoreToCloud(pName, finalScore, getDifficultyText());
          console.log("☁️ 成績已上傳雲端排行榜");
        } catch (err) {
          console.error("雲端存檔失敗:", err);
        }
      }
      
      const newRecord = { name: pName, score: finalScore, difficulty: getDifficultyText(), time: new Date().toLocaleString() };
      try {
        const localData = JSON.parse(localStorage.getItem('tsl_history') || '[]');
        localData.unshift(newRecord); localStorage.setItem('tsl_history', JSON.stringify(localData.slice(0, 20)));
        if (!shouldUpload) {
          let localScores = JSON.parse(localStorage.getItem('local_leaderboard') || '[]');
          localScores.push(newRecord);
          localScores.sort((a, b) => b.score - a.score);
          localStorage.setItem('local_leaderboard', JSON.stringify(localScores.slice(0, 50)));
        }
      } catch (e) {}
      
      modal.style.display = 'none';
      const top10 = shouldUpload ? await getTop10Scores() : (() => {
        try { return JSON.parse(localStorage.getItem('local_leaderboard') || '[]').slice(0, 10); } catch(e) { return []; }
      })();
      showLeaderboard(Array.isArray(top10) ? top10 : await top10);
    };
  }
  
  if (localBtn) {
    localBtn.onclick = () => {
      localBtn.disabled = true; localBtn.textContent = "儲存中...";
      const pName = pNameInput.value.trim() || "匿名";
      commanderName = pName;
      
      const newRecord = { name: pName, score: finalScore, difficulty: getDifficultyText(), time: new Date().toLocaleString() };
      try {
        let localScores = JSON.parse(localStorage.getItem('local_leaderboard') || '[]');
        localScores.push(newRecord);
        localScores.sort((a, b) => b.score - a.score);
        localStorage.setItem('local_leaderboard', JSON.stringify(localScores.slice(0, 50)));
        
        const localData = JSON.parse(localStorage.getItem('tsl_history') || '[]');
        localData.unshift(newRecord); localStorage.setItem('tsl_history', JSON.stringify(localData.slice(0, 20)));
      } catch (e) {}
      
      modal.style.display = 'none';
      try {
        const localScores = JSON.parse(localStorage.getItem('local_leaderboard') || '[]');
        showLeaderboard(localScores.slice(0, 10));
      } catch (e) {
        showLeaderboard([]);
      }
    };
  }
}

async function showLeaderboard(top10) {
  const modal = document.getElementById('leaderboard-modal'); let displayList = top10 || [];
  if (displayList.length === 0) {
    try { displayList = JSON.parse(localStorage.getItem('tsl_history') || '[]').slice(0, 10); } catch (e) {}
  }
  displayList.sort((a, b) => b.score - a.score);
  document.getElementById('leaderboard-list').innerHTML = displayList.map((p, i) => {
    let medal = i + 1, color = "#fff";
    if (i === 0) { medal = "🥇"; color = "#ffcc00"; }
    else if (i === 1) { medal = "🥈"; color = "#C0C0C0"; }
    else if (i === 2) { medal = "🥉"; color = "#cd7f32"; }
    return `<li style="display:flex; justify-content:space-between; align-items:center; padding:10px 15px; margin-bottom:8px; background:rgba(255,255,255,0.05); border-radius:10px; border-left:4px solid ${color};">
      <div style="display:flex; align-items:center; gap:15px;"><span>${medal}</span><span style="font-weight:bold; color:${color};">${p.name}</span></div>
      <div style="text-align:right;"><span style="color:#0f0; font-weight:bold;">${p.score}</span><span style="font-size:12px; color:#888; display:block;">${p.difficulty || "一般"}</span></div>
    </li>`;
  }).join('');
  modal.style.display = 'flex';
}

function resetToHome(goToStory = false) {
  initGame();
  const welcomeModal = document.getElementById('welcome-modal');
  if (welcomeModal) {
    welcomeModal.style.display = 'flex';
    welcomeModal.style.opacity = '1';
    welcomeModal.style.pointerEvents = 'auto';
  }
  const exportCsvBtn = document.getElementById('export-csv-btn');
  if (exportCsvBtn) exportCsvBtn.style.display = 'none';
  if (goToStory) {
    document.getElementById('welcome-story-phase').style.display = 'flex';
    document.getElementById('welcome-rules-phase').style.display = 'none';
    document.getElementById('welcome-music-phase').style.display = 'none';
    document.getElementById('welcome-difficulty-phase').style.display = 'none';
    window.triggerWelcomeStoryTypewriter(); onboardingMusicMode = ''; window.selectOnboardingMusic('default');
  } else {
    document.getElementById('welcome-story-phase').style.display = 'none';
    document.getElementById('welcome-rules-phase').style.display = 'none';
    document.getElementById('welcome-music-phase').style.display = 'flex';
    document.getElementById('welcome-difficulty-phase').style.display = 'none';
  }
  window.selectOnboardingDifficulty('1');
}

// -----------------------
// 9. 🎨 畫布渲染中心
// -----------------------
function draw() {
  const dpr = window.devicePixelRatio || 1; const cw = canvas.width / dpr, ch = canvas.height / dpr;
  ctx.clearRect(0, 0, cw, ch); ctx.drawImage(images.background, 0, 0, cw, ch);
  houses.forEach(h => ctx.drawImage(images.house, h.x, h.y, h.width, h.height));
  bombs.forEach(b => b.render(ctx)); plane.render(ctx);

  if (!gameStarted || gamePaused || gameOver) {
    let message = "", color = "#FFF";
    if (gamePaused && !gameOver) message = "⏸ 遊戲暫停";
    else if (gameOver) { message = win ? "🏆 任務成功！" : "💥 任務失敗"; color = win ? "#00ff00" : "#ff3333"; }
    else if (!gameStarted && (!gesturesLoaded || !modelLoaded)) message = "⚡ 正在初始化 AI 模型...";

    if (message) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.beginPath(); ctx.roundRect(cw / 2 - 250, ch / 2 - 70, 500, 100, 15); ctx.fill();
      ctx.strokeStyle = '#00ccff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = color; ctx.font = 'bold 32px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(message, cw / 2, ch / 2 - 20);
    }
  }

  renderCamera();
  if (showDebugOverlay) renderDebugOverlay();

  const now = performance.now();
  if (now - lastHudUpdateTime > 150) { updateGameState(false); lastHudUpdateTime = now; }
}

function updateGameState(forceUpdateDOM = false) {
  const diffSelect = document.getElementById('difficulty-select');
  let diffText = diffSelect ? `等級 ${diffSelect.value}` : "一般";
  
  // 🌟【精準解鎖】即時動態更新前導頁面「下一步」按鈕的物理與視覺外觀
  const onboardingMusicNextBtn = document.getElementById('welcome-music-next-btn');
  if (onboardingMusicNextBtn) {
    if (isAnalyzing) {
      onboardingMusicNextBtn.disabled = true;
      onboardingMusicNextBtn.style.cursor = 'not-allowed';
      onboardingMusicNextBtn.style.opacity = '0.5';
      onboardingMusicNextBtn.style.background = 'linear-gradient(135deg, #555, #333)';
      onboardingMusicNextBtn.style.boxShadow = 'none';
      onboardingMusicNextBtn.innerHTML = '⏳ 音樂作戰頻率解析中，請稍候...';
    } else if (musicBeats.length === 0) {
      onboardingMusicNextBtn.disabled = true;
      onboardingMusicNextBtn.style.cursor = 'not-allowed';
      onboardingMusicNextBtn.style.opacity = '0.5';
      onboardingMusicNextBtn.style.background = 'linear-gradient(135deg, #555, #333)';
      onboardingMusicNextBtn.style.boxShadow = 'none';
      onboardingMusicNextBtn.innerHTML = onboardingMusicMode === 'upload' ? '🎵 請上傳本機音樂以解析節奏' : '🎵 正在載入預設音樂...';
    } else {
      onboardingMusicNextBtn.disabled = false;
      onboardingMusicNextBtn.style.cursor = 'pointer';
      onboardingMusicNextBtn.style.opacity = '1.0';
      onboardingMusicNextBtn.style.background = 'linear-gradient(135deg, #00e5ff, #0088cc)';
      onboardingMusicNextBtn.style.boxShadow = '0 4px 15px rgba(0, 229, 255, 0.3)';
      onboardingMusicNextBtn.innerHTML = '下一步：設定作戰難度 ⏭️';
    }
  }

  if (forceUpdateDOM || performance.now() - lastHudUpdateTime > 140) {
    updateHud({
      score, housesCount: houses.length, difficultyText: diffText,
      totalBombsDropped, targetBombs, modelLoaded, gesturesLoaded,
      isAnalyzing, musicBeatsLength: musicBeats.length,
      gameStarted, gameOver, win, gamePaused
    });
  }
}

// -----------------------
// 10. 📷 MediaPipe 雙手視覺跟蹤管線
// -----------------------
async function initWebcam() {
  if (!navigator.mediaDevices?.getUserMedia) return alert("環境不支援相機。");
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 180 } });
    await video.play(); lastVideoFrame = video; predictLoop();
  } catch (err) { alert("相機啟動失敗: " + err.message); }
}

async function predictLoop() {
  if (!gameStarted) {
    requestAnimationFrame(predictLoop);
    return;
  }
  if (lastVideoFrame && aiManager.handLandmarker) {
    const ts = performance.now(); frameCount++;

    const handRes = aiManager.handLandmarker.detectForVideo(lastVideoFrame, ts);
    
    if (ts - lastPoseDetectTime > 250 || !lastPoseRes) {
      lastPoseRes = aiManager.poseLandmarker.detectForVideo(lastVideoFrame, ts);
      lastPoseDetectTime = ts;
    }

    const landmarks = handRes.landmarks || [];
    const destructuredHandedness = handRes.handednesses || [];

    if (landmarks.length > 0) {
      lastHandLandmarks = landmarks; handMissFrameCount = 0;
      let leftHand = null, rightHand = null;
      landmarks.forEach((lm, idx) => {
        const sideLabel = destructuredHandedness[idx]?.[0]?.categoryName || "";
        if (sideLabel === 'Left') leftHand = lm; else if (sideLabel === 'Right') rightHand = lm;
      });

      const frame = window.extractFrame66({
        leftHandLandmarks: leftHand, rightHandLandmarks: rightHand, poseLandmarks: lastPoseRes?.landmarks?.[0] || null
      });

      featureBuffer.push(frame);
      if (featureBuffer.length > MODEL_FRAMES) featureBuffer.shift();

      if (featureBuffer.length === MODEL_FRAMES && inferenceCooldown <= 0) {
        inferenceFrameCount++;
        if (inferenceFrameCount % 3 === 0 && !isInferencing) {
          isInferencing = true;
          slidingWindowIndex++;
          aiManager.runInference(featureBuffer, labelMap, currentVocabulary).then(res => {
            isInferencing = false;
            if (res) {
              res.windowId = slidingWindowIndex;
              const thresholds = getThresholdsForWord(res.label);
              const isConsistent = (res.label === lastInferenceLabel);
              const isPassed = (res.confidence >= thresholds.direct) || (isConsistent && res.confidence >= thresholds.exception);
              const statusSymbol = isPassed ? "🟩 [通過門檻！]" : "🟥 [未達門檻]";
              console.log(`🤖 [AI 推理] 滑窗: #${res.windowId} | 預測: [${res.label}] (信心值: ${res.confidence.toFixed(2)}) | 判定門檻: ${thresholds.direct.toFixed(2)} | 狀態: ${statusSymbol}`);
              
              gameInferenceHistory.push({
                timestamp: new Date().toLocaleTimeString(),
                windowId: res.windowId,
                label: res.label,
                confidence: res.confidence,
                threshold: thresholds.direct,
                isPassed: isPassed
              });

              lastDebugInfo = res;
              checkHit(res.label, res.confidence);
            }
          }).catch(() => { isInferencing = false; });
        }
      }
    } else {
      lastHandLandmarks = null; handMissFrameCount++;
      if (handMissFrameCount > HAND_PERSISTENCE_FRAMES) { featureBuffer = []; disabledHitLabel = ""; }
    }
    if (inferenceCooldown > 0) inferenceCooldown--;
  }
  requestAnimationFrame(predictLoop); 
}

function checkHit(label, confidence) {
  const thresholds = getThresholdsForWord(label);
  if (label === disabledHitLabel && confidence < thresholds.exception) disabledHitLabel = "";
  if (label === disabledHitLabel) return;
  if (label !== disabledHitLabel && disabledHitLabel !== "") disabledHitLabel = "";

  const isConsistent = (label === lastInferenceLabel);
  const isPassed = (confidence >= thresholds.direct) || (isConsistent && confidence >= thresholds.exception);
  lastInferenceLabel = label;

  const progressEl = document.getElementById('progress');
  if (isPassed && gameStarted) {
    let targetBombIdx = -1; let maxY = -1;
    for (let i = 0; i < bombs.length; i++) {
      const b = bombs[i];
      if (b.word === label && !b.finished && !b.exploding) {
        let weight = b.y; if (b.shrinking && b.shouldExplode) weight += 5000;
        if (weight > maxY) { maxY = weight; targetBombIdx = i; }
      }
    }

    if (targetBombIdx !== -1) {
      const targetBomb = bombs[targetBombIdx]; const points = 50 * (WORD_DIFFICULTY[label] || 1); score += points;
      if (targetBomb.shrinking && targetBomb.shouldExplode) {
        score -= 10; if (progressEl) progressEl.textContent = `進度: ⚡ 神速救援！[${label}] (+${points - 10})`;
      } else { if (progressEl) progressEl.textContent = `進度: 💥 擊中 [${label}] (+${points})!`; }
      targetBomb.shouldExplode = false; targetBomb.finished = true; disabledHitLabel = label; inferenceCooldown = 20; lastInferenceLabel = "";
    } else { if (progressEl) progressEl.textContent = `進度: 🔍 辨識為 [${label}] 但畫面上沒這顆炸彈`; }
  } else { if (progressEl && gameStarted) progressEl.textContent = `進度: 辨識中...`; }
}

function renderCamera() {
  if (!gameStarted) return;
  const dpr = window.devicePixelRatio || 1; const cw = canvas.width / dpr, ch = canvas.height / dpr; const isMobile = cw < 768;
  const camW = isMobile ? 120 : 320, camH = isMobile ? 68 : 180; const camX = cw - camW - 10, camY = 10;

  ctx.save(); ctx.translate(camX + camW, camY); ctx.scale(-1, 1);
  if (lastVideoFrame) ctx.drawImage(lastVideoFrame, 0, 0, camW, camH);
  else { ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, camW, camH); }
  ctx.restore();

  if (ctx && lastHandLandmarks && Array.isArray(lastHandLandmarks)) {
    ctx.save(); ctx.beginPath(); ctx.rect(camX, camY, camW, camH); ctx.clip();
    const connections = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
    ctx.strokeStyle = "#00FF00"; ctx.lineWidth = isMobile ? 2 : 4; ctx.lineCap = "round";
    for (const hand of lastHandLandmarks) {
      if (!hand || !Array.isArray(hand)) continue;
      connections.forEach(([s, e]) => {
        const p1 = hand[s], p2 = hand[e];
        if (p1 && p2) {
          ctx.beginPath(); ctx.moveTo(camX + (1 - p1.x) * camW, camY + p1.y * camH); ctx.lineTo(camX + (1 - p2.x) * camW, camY + p2.y * camH); ctx.stroke();
        }
      });
    }
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(0, 204, 255, 0.4)'; ctx.lineWidth = 1.5; ctx.strokeRect(camX, camY, camW, camH);
}

function renderDebugOverlay() {
  if (!gameStarted) return;
  const dpr = window.devicePixelRatio || 1; const ch = canvas.height / dpr; const isMobile = window.innerWidth < 768;
  const boxW = isMobile ? 220 : 420, boxH = isMobile ? 120 : 180; const x = 10, y = ch - boxH - 10;
  ctx.fillStyle = 'rgba(10, 15, 30, 0.5)'; ctx.beginPath(); ctx.roundRect(x, y, boxW, boxH, 15); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#00ffcc'; ctx.font = `bold ${isMobile ? 9 : 13}px monospace`; ctx.textAlign = 'left';
  ctx.fillText(`[Buf] ${featureBuffer.length}/30 | [Hand] ${lastHandLandmarks?'YES':'NO'} | [CD] ${inferenceCooldown} | [Win] #${slidingWindowIndex}`, x + 8, y + (isMobile ? 15 : 20));

  if (lastDebugInfo) {
    ctx.fillStyle = '#ff0'; ctx.fillText(`=== AI 即時辨識 (滑窗: #${lastDebugInfo.windowId}) ===`, x + 8, y + (isMobile ? 35 : 45));
    lastDebugInfo.top4.forEach((p, i) => {
      ctx.fillStyle = '#fff'; ctx.fillText(`${p.label}: ${p.prob.toFixed(1)}`, x + 8, y + (isMobile ? 52 : 65) + i * (isMobile ? 12 : 18));
      ctx.fillStyle = '#444'; ctx.fillRect(x + (isMobile ? 120 : 150), y + (isMobile ? 44 : 55) + i * (isMobile ? 12 : 18), isMobile ? 50 : 100, isMobile ? 6 : 10);
      const thresholds = getThresholdsForWord(p.label); ctx.fillStyle = (p.prob >= thresholds.direct) ? '#0f0' : '#888';
      ctx.fillRect(x + (isMobile ? 120 : 150), y + (isMobile ? 44 : 55) + i * (isMobile ? 12 : 18), Math.min(isMobile ? 50 : 100, p.prob * (isMobile ? 10 : 20)), isMobile ? 6 : 10);
    });
  }
}

window.exportInferenceHistoryToCSV = function() {
  if (gameInferenceHistory.length === 0) {
    alert("⚠️ 目前尚無任何 AI 推理紀錄可供匯出！");
    return;
  }
  
  let csvContent = "\ufeff時間,滑窗編號,預測詞彙,信心值,判定門檻,是否通過\n";
  gameInferenceHistory.forEach(row => {
    csvContent += `"${row.timestamp}",${row.windowId},"${row.label}",${row.confidence.toFixed(4)},${row.threshold.toFixed(2)},${row.isPassed ? "是" : "否"}\n`;
  });
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `tsl_game_inference_log_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

startApp();
