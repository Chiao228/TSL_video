/**
 * config.js
 * 存放遊戲全域配置與詞彙對照表
 */

// 1. 改為函式或動態取得，避免縮放視窗時座標出錯
export const getCanvasWidth = () => window.innerWidth;
export const getCanvasHeight = () => window.innerHeight;

// 2. 遊戲參數
export const AUDIO_OFFSET = 0.08;
export const SCORE_DECAY = 0.8;
export const HOUSE_COUNT = 10;
export const HOUSE_WIDTH = 180;
export const HOUSE_HEIGHT = 120;
export const HOUSE_MARGIN_BOTTOM = 20;

// 3. AI 辨識門檻 (調降以增加靈敏度)
export const DIRECT_HIT_THRESHOLD = 4.5;
export const EXCEPTION_THRESHOLD = 999; // 🌟 設為 999 代表預設「禁用」非特定詞彙的雙窗口判定 (必須直接秒殺)

// 🌟 特定詞彙的自訂門檻 (若目前不想設定任何自訂門檻，請維持空物件 {}，千萬不能整段註解掉，否則會閃退)
export const CUSTOM_THRESHOLDS = {
  //'蘋果': { direct: 4.5, exception: 4.0 },
  //'沒關係': { direct: 4.5, exception: 4.0 },
  //'不喜歡': { direct: 4.5, exception: 4.0 },
};

// 動態獲取指定詞彙的門檻
export const getThresholdsForWord = (word) => {
  const custom = CUSTOM_THRESHOLDS[word];
  return {
    direct: (custom && custom.direct !== undefined) ? custom.direct : DIRECT_HIT_THRESHOLD,
    exception: (custom && custom.exception !== undefined) ? custom.exception : EXCEPTION_THRESHOLD
  };
};

export const MODEL_FRAMES = 30;
export const FEATURE_DIM = 66;


// 4. 詞彙難度對照表
export const WORD_DIFFICULTY = {
  '不可以': 1, '中午': 1, '公車': 1, '去': 1, '可以': 1,
  '好吃': 1, '有': 1, '有沒有': 1, '你好': 1, '我': 1,
  '明天': 1, '是': 1, '飛機': 1, '記得': 1, '喜歡': 1,
  '棒': 1, '說話': 1, '檢查': 1, '還沒': 1,

  '不客氣': 2, '不是': 2, '不喜歡': 2, '生氣': 2, '現在': 2,
  '休息': 2, '再見': 2, '忘記': 2, '朋友': 2, '爸爸': 2,
  '要': 2, '高興': 2, '會': 2, '認真': 2, '機車': 2, '謝謝': 2,

  '火車': 3, '名字': 3, '告訴': 3, '我們': 3, '找': 3,
  '沒關係': 3, '放學': 3, '計程車': 3, '高鐵': 3, '幾點': 3,
  '飲料': 3, '媽媽': 3, '對不起': 3, '幫忙': 3, '蘋果': 3,
};

// 🌟 5. 影片載入設定 (若有上傳至 GitHub，可在此填寫 CDN 網址以達百兆網速秒載入，例如：'https://cdn.jsdelivr.net/gh/[您的帳號]/[您的專案庫]/')
// 留空則預設讀取本機的 videos/ 資料夾
export const VIDEO_CDN_BASE = "https://cdn.jsdelivr.net/gh/Chiao228/TSL_video/";
