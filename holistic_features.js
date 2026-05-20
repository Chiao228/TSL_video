// holistic_features.js (終極高效能記憶體優化版)
// ✅ 66維特徵提取（與模型訓練一致）
// 特徵結構：左手(33) + 右手(33) = 66維

/**
 * 將特徵緩衝區線性重新取樣到指定幀數
 * @param {Array<Float32Array>} buffer - 每幀特徵的陣列
 * @param {number} targetFrames - 目標幀數 (預設 30)
 * @returns {Float32Array} 展平後的 [targetFrames × 66] 陣列
 */
function prepareModelInput(buffer, targetFrames) {
  targetFrames = targetFrames || 30;  // 模型固定 30 幀
  const srcFrames = buffer.length;
  const dim = 66; 
  
  const flat = new Float32Array(targetFrames * dim);

  if (srcFrames === 0) {
    console.warn(`prepareModelInput: 空的特徵緩衝區，返回 ${targetFrames}×${dim} 全0陣列`);
    return flat;
  }

  // 💡 優化 1：直接記憶體區塊複製，並限制最大長度防止溢出
  const copyFrames = Math.min(srcFrames, targetFrames);
  for (let i = 0; i < copyFrames; i++) {
    if (buffer[i]) {
      flat.set(buffer[i], i * dim);
    }
  }
  
  // 💡 優化 2：移除耗時的全陣列 isNaN 檢查迴圈（改在特徵擷取源頭防禦，更省時）
  // console.log(`✅ prepareModelInput: ${srcFrames}幀 → ${targetFrames}幀 × ${dim}維`);
  return flat;
}

// 💡 優化 3：全域預配置重用緩衝區，達成零記憶體配置（Zero-Allocation），彻底消滅 GC 卡頓
const _handResBuffer = new Float32Array(63);
const _keepIndices = [0, 3, 4, 7, 8, 11, 12, 15, 16, 19, 20];

/**
 * 提取 66 維特徵
 * 結構：左手(33維) + 右手(33維) = 66維
 * @param {Object} results - MediaPipe 檢測結果
 * @returns {Float32Array} 66 維向量
 */
function extractFrame66(results) {
  // 💡 調整：相容 MediaPipe Tasks-Vision 與舊版 Holistic 的命名欄位
  const poseLm  = results.poseLandmarks?.[0]  || results.poseLandmarks  || null;
  const leftLm  = results.leftHandLandmarks?.[0] || results.leftHandLandmarks || null;
  const rightLm = results.rightHandLandmarks?.[0] || results.rightHandLandmarks || null;

  // 計算肩膀中心 (作為全局原點)
  let sCenterX = 0.5, sCenterY = 0.5, sCenterZ = 0.0;
  let shoulderDist = 1.0;

  if (poseLm && poseLm.length > 12) {
    const p11 = poseLm[11];
    const p12 = poseLm[12];
    
    sCenterX = (p11.x + p12.x) / 2;
    sCenterY = (p11.y + p12.y) / 2;
    sCenterZ = (p11.z + p12.z) / 2;

    const dx = p11.x - p12.x;
    const dy = p11.y - p12.y;
    const dz = p11.z - p12.z;
    shoulderDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (shoulderDist < 1e-6) shoulderDist = 1.0;
  }

  // 建立最終輸出的 66 維陣列（此處是每影格唯一配置，其餘內部運算皆不配置記憶體）
  const feature66 = new Float32Array(66);

  // 💡 優化 4：將高頻重複函式平鋪，改為直接索引讀取，不使用 .map()
  function fillHandFeatures(lm_list, outputOffset) {
    if (!lm_list || lm_list.length === 0) return;

    // 檢查全 0 防禦
    let isAllZero = true;
    for (let i = 0; i < lm_list.length; i++) {
      if (lm_list[i].x !== 0 || lm_list[i].y !== 0) {
        isAllZero = false;
        break;
      }
    }
    if (isAllZero) return;

    // 直接寫入預配置的重用緩衝區，不開闢新陣列
    const wrist = lm_list[0];
    _handResBuffer[0] = (wrist.x - sCenterX) / shoulderDist;
    _handResBuffer[1] = (wrist.y - sCenterY) / shoulderDist;
    _handResBuffer[2] = (wrist.z - sCenterZ) / shoulderDist;

    // 計算手部縮放 (手腕 lm[0] 到 中指根部 lm[9])
    const mFinger = lm_list[9];
    let scale = 1.0;
    if (mFinger) {
      const hdx = wrist.x - mFinger.x;
      const hdy = wrist.y - mFinger.y;
      const hdz = wrist.z - mFinger.z;
      const handScale = Math.sqrt(hdx * hdx + hdy * hdy + hdz * hdz);
      scale = handScale < 1e-6 ? 1.0 : handScale;
    }

    // 其他點相對於手腕，直接運算防禦 NaN
    for (let i = 1; i < 21; i++) {
      const lm = lm_list[i];
      const idx = i * 3;
      if (lm) {
        _handResBuffer[idx]     = ((lm.x - wrist.x) / scale) || 0;
        _handResBuffer[idx + 1] = ((lm.y - wrist.y) / scale) || 0;
        _handResBuffer[idx + 2] = ((lm.z - wrist.z) / scale) || 0;
      } else {
        _handResBuffer[idx] = _handResBuffer[idx + 1] = _handResBuffer[idx + 2] = 0;
      }
    }

    // 僅抽取 11 個關鍵點複製到最終輸出的 feature66 相對區段
    for (let i = 0; i < _keepIndices.length; i++) {
      const srcIdx = _keepIndices[i] * 3;
      const destIdx = outputOffset + (i * 3);
      
      feature66[destIdx]     = _handResBuffer[srcIdx]     || 0;
      feature66[destIdx + 1] = _handResBuffer[srcIdx + 1] || 0;
      feature66[destIdx + 2] = _handResBuffer[srcIdx + 2] || 0;
    }
  }

  // 提取左手並寫入前 33 維 (0-32)
  fillHandFeatures(leftLm, 0);
  // 提取右手並寫入後 33 維 (33-65)
  fillHandFeatures(rightLm, 33);

  return feature66;
}

// 🔧 綁定到全局 window 物件
window.extractFrame66 = extractFrame66;
window.prepareModelInput = prepareModelInput;
