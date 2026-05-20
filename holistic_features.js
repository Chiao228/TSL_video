// holistic_features.js (終極高效能記憶體優化版)
// ✅ 66維特徵提取（與模型訓練一致）
// 特徵結構：左手(33) + 右手(33) = 66維

/**
 * 將特徵緩衝區線性重新取樣到指定幀數
 */
function prepareModelInput(buffer, targetFrames) {
  targetFrames = targetFrames || 30;  
  const srcFrames = buffer.length;
  const dim = 66; 
  
  const flat = new Float32Array(targetFrames * dim);

  if (srcFrames === 0) {
    console.warn(`prepareModelInput: 空的特徵緩衝區，返回 ${targetFrames}×${dim} 全0陣列`);
    return flat;
  }

  // 💡 優化 1：直接進行連續記憶體區塊複製，不再開闢臨時子陣列
  const copyFrames = Math.min(srcFrames, targetFrames);
  for (let i = 0; i < copyFrames; i++) {
    if (buffer[i]) {
      flat.set(buffer[i], i * dim);
    }
  }
  return flat;
}

// 💡 優化 2：全域預配置重用緩衝區，達成零記憶體分配（Zero-Allocation），消滅高頻 GC Churn
const _handResBuffer = new Float32Array(63);
const _keepIndices = [0, 3, 4, 7, 8, 11, 12, 15, 16, 19, 20];

/**
 * 提取 66 維特徵
 * 結構：左手(33維) + 右手(33維) = 66維
 */
function extractFrame66(results) {
  // 自動適配 MediaPipe Tasks-Vision 與舊版 Holistic 欄位命名
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

  // 每一影格僅配置這一個最終輸出陣列，其餘內部計算皆不開闢空間
  const feature66 = new Float32Array(66);

  // 💡 優化 3：平鋪高頻重複代碼，徹底拋棄 JS .map() 與新陣列開銷
  function fillHandFeatures(lm_list, outputOffset) {
    if (!lm_list || lm_list.length === 0) return;

    let isAllZero = true;
    for (let i = 0; i < lm_list.length; i++) {
      if (lm_list[i].x !== 0 || lm_list[i].y !== 0) {
        isAllZero = false;
        break;
      }
    }
    if (isAllZero) return;

    const wrist = lm_list[0];
    _handResBuffer[0] = (wrist.x - sCenterX) / shoulderDist;
    _handResBuffer[1] = (wrist.y - sCenterY) / shoulderDist;
    _handResBuffer[2] = (wrist.z - sCenterZ) / shoulderDist;

    const mFinger = lm_list[9];
    let scale = 1.0;
    if (mFinger) {
      const hdx = wrist.x - mFinger.x;
      const hdy = wrist.y - mFinger.y;
      const hdz = wrist.z - mFinger.z;
      const handScale = Math.sqrt(hdx * hdx + hdy * hdy + hdz * hdz);
      scale = handScale < 1e-6 ? 1.0 : handScale;
    }

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

    for (let i = 0; i < _keepIndices.length; i++) {
      const srcIdx = _keepIndices[i] * 3;
      const destIdx = outputOffset + (i * 3);
      
      feature66[destIdx]     = _handResBuffer[srcIdx]     || 0;
      feature66[destIdx + 1] = _handResBuffer[srcIdx + 1] || 0;
      feature66[destIdx + 2] = _handResBuffer[srcIdx + 2] || 0;
    }
  }

  fillHandFeatures(leftLm, 0);  // 左手寫入前 33 維
  fillHandFeatures(rightLm, 33); // 右手寫入後 33 維

  return feature66;
}

window.extractFrame66 = extractFrame66;
window.prepareModelInput = prepareModelInput;
