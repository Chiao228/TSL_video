// holistic_features.js
// ✅ 66維特徵提取（與模型訓練一致）
// 特徵結構：左手(33) + 右手(33) = 66維

/**
 * 將特徵緩衝區線性重新取樣到指定幀數
 * 與模型訓練配置一致：66 維
 * @param {Array<Float32Array>} buffer - 每幀特徵的陣列
 * @param {number} targetFrames - 目標幀數 (預設 30)
 * @returns {Float32Array} 展平後的 [targetFrames × 66] 陣列
 */
function prepareModelInput(buffer, targetFrames) {
  targetFrames = targetFrames || 30;  // 模型固定 30 幀
  const srcFrames = buffer.length;
  const dim = 66;  // ✅ 與模型輸入維度一致
  
  const flat = new Float32Array(targetFrames * dim);

  // 防護：如果buffer為空或過短，返回全0陣列
  if (srcFrames === 0) {
    console.warn(`prepareModelInput: 空的特徵緩衝區，返回 ${targetFrames}×${dim} 全0陣列`);
    return flat;
  }

  // 直接複製，不進行線性插值 (與使用者要求一致：直接取 30 幀)
  for (let i = 0; i < targetFrames; i++) {
    // 確保只在 buffer 有資料時複製，避免溢出
    if (buffer[i]) {
      flat.set(buffer[i], i * dim);
    }
  }
  
  // 驗證輸出，防止NaN值
  for (let i = 0; i < flat.length; i++) {
    if (isNaN(flat[i])) {
      console.warn(`prepareModelInput: 檢測到NaN在索引 ${i}，設為0`);
      flat[i] = 0;
    }
  }
  
  console.log(`✅ prepareModelInput: ${srcFrames}幀 × ${dim}維 → ${targetFrames}幀 × ${dim}維`);
  return flat;
}

/**
 * 提取 66 維特徵
 * 結構：左手(33維) + 右手(33維) = 66維
 * 每手包含：手腕相對肩膀 + 其他20點相對手腕（都歸一化）
 * @param {Object} results - MediaPipe Holistic 檢測結果
 * @returns {Float32Array} 66 維向量 (左手33 + 右手33)
 */
function extractFrame66(results) {
  const poseLm  = results.poseLandmarks  || null;
  const leftLm  = results.leftHandLandmarks  || null;
  const rightLm = results.rightHandLandmarks || null;
  const faceLm  = results.faceLandmarks  || null;

  // 計算肩膀中心 (作為全局原點)
  let shoulderCenter;
  if (poseLm && poseLm.length > 12) {
    shoulderCenter = [
      (poseLm[11].x + poseLm[12].x) / 2,
      (poseLm[11].y + poseLm[12].y) / 2,
      (poseLm[11].z + poseLm[12].z) / 2,
    ];
  } else {
    shoulderCenter = [0.5, 0.5, 0.0];
  }

  // 計算肩膀距離
  let shoulderDist = 1.0;
  if (poseLm && poseLm.length > 12) {
    const dx = poseLm[11].x - poseLm[12].x;
    const dy = poseLm[11].y - poseLm[12].y;
    const dz = poseLm[11].z - poseLm[12].z;
    shoulderDist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (shoulderDist < 1e-6) shoulderDist = 1.0;
  }

  // 只保留關鍵關節索引 (手腕 + 各指末端兩節)
  const keepIndices = [0, 3, 4, 7, 8, 11, 12, 15, 16, 19, 20];
  
  // 歸一化手部函數 (與 Python features.py 一致)
  function normalizeHandForModel(lm_list) {
    if (!lm_list || lm_list.length === 0) {
      return new Float32Array(33); // 11 點 × 3 = 33 維
    }

    const points = lm_list.map(lm => [lm.x, lm.y, lm.z]);
    
    // 全為 0 的情況
    if (points.every(p => p.every(v => v === 0))) {
      return new Float32Array(33);
    }

    const res = new Float32Array(63);
    
    // 手腕相對於肩膀中心
    res[0] = (points[0][0] - shoulderCenter[0]) / shoulderDist;
    res[1] = (points[0][1] - shoulderCenter[1]) / shoulderDist;
    res[2] = (points[0][2] - shoulderCenter[2]) / shoulderDist;

    // 計算手部縮放 (手腕到中指根部的距離)
    const handScale = Math.sqrt(
      (points[0][0] - points[9][0])**2 +
      (points[0][1] - points[9][1])**2 +
      (points[0][2] - points[9][2])**2
    );
    const scale = handScale < 1e-6 ? 1.0 : handScale;

    // 其他點相對於手腕
    for (let i = 1; i < 21; i++) {
      res[i*3]     = (points[i][0] - points[0][0]) / scale;
      res[i*3 + 1] = (points[i][1] - points[0][1]) / scale;
      res[i*3 + 2] = (points[i][2] - points[0][2]) / scale;
    }

    // 只保留關鍵關節
    const pruned = new Float32Array(33);
    for (let i = 0; i < keepIndices.length; i++) {
      const srcIdx = keepIndices[i];
      pruned[i*3]     = res[srcIdx*3];
      pruned[i*3 + 1] = res[srcIdx*3 + 1];
      pruned[i*3 + 2] = res[srcIdx*3 + 2];
    }
    
    return pruned;
  }

  // 提取並歸一化雙手
  const lhPruned = normalizeHandForModel(leftLm);
  const rhPruned = normalizeHandForModel(rightLm);

  // 組合 66 維特徵: 左手(33) + 右手(33)
  const feature66 = new Float32Array(66);
  feature66.set(lhPruned, 0);
  feature66.set(rhPruned, 33);

  return feature66;
}

// 🔧 【關鍵！】綁定到全局 window 物件，讓 app.js 能找到
window.extractFrame66 = extractFrame66;
window.prepareModelInput = prepareModelInput;
