/**
 * ai_manager.js
 * 負責 MediaPipe 初始化、影像偵測與後端推理呼叫
 */
import { FilesetResolver, HandLandmarker, PoseLandmarker } from "./vision_bundle.mjs";
import { MODEL_FRAMES, VIDEO_CDN_BASE } from './config.js';

export class AIManager {
  constructor() {
    this.handLandmarker = null;
    this.poseLandmarker = null;
    this.onnxSession = null; // 🌟 儲存 ONNX 瀏覽器端推論 Session
    this.isInferring = false;
  }

  async init() {
    // 🌟 自動偵測：若是本機連線 (localhost / 127.0.0.1) 或是無網路狀態，自動讀取本地的大檔案以支援完全離線遊玩！
    const isLocal = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' || 
                    !navigator.onLine;

    const wasmPath = isLocal ? "./wasm" : "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm";
    const handModelPath = isLocal ? "./hand_landmarker.task" : "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
    const poseModelPath = isLocal ? "./pose_landmarker_lite.task" : "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

    console.log(`🤖 MediaPipe 資源載入模式: ${isLocal ? '🔌 本地離線模式' : '🌐 線上 CDN 模式'}`);

    let filesetResolver;
    let finalHandModelPath = handModelPath;
    let finalPoseModelPath = poseModelPath;

    try {
      filesetResolver = await FilesetResolver.forVisionTasks(wasmPath);
    } catch (err) {
      console.warn(`⚠️ MediaPipe CDN 載入失敗，降級使用本地 /wasm 資源...`, err);
      filesetResolver = await FilesetResolver.forVisionTasks("./wasm");
      finalHandModelPath = "./hand_landmarker.task";
      finalPoseModelPath = "./pose_landmarker_lite.task";
    }

    this.handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: finalHandModelPath,
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.4, // 🌟 調降門檻，讓追蹤反應更靈敏
      minHandPresenceConfidence: 0.4
    });

    this.poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: finalPoseModelPath,
        delegate: "GPU"
      },
      runningMode: "VIDEO"
    });

    // 🌟 設定 ONNX Runtime Web WebAssembly (WASM) 的載入路徑 (與本地一致的 1.26.0 版本)
    const hasNetwork = navigator.onLine;
    ort.env.wasm.wasmPaths = hasNetwork
      ? "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/"
      : "./";
    
    console.log(`🌐 ONNX Runtime WASM 載入路徑設定為: ${ort.env.wasm.wasmPaths}`);

    // 🌟 載入 ONNX 手語分類模型 (支援外部權重檔 .data 載入)
    const baseCdn = hasNetwork ? (VIDEO_CDN_BASE || '') : '';
    const onnxModelPath = `${baseCdn}train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx`;
    const onnxDataPath = `${baseCdn}train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx.data`;
    console.log(`🧠 正在載入 ONNX 手語分類模型... | 路徑: ${onnxModelPath}`);
    
    try {
      console.log(`🧠 正在下載 ONNX 外部權重資料 (CDN)... | 路徑: ${onnxDataPath}`);
      const dataRes = await fetch(onnxDataPath);
      if (!dataRes.ok) throw new Error(`CDN 檔案不可用 (HTTP ${dataRes.status})`);
      const dataBuf = await dataRes.arrayBuffer();
      const externalData = new Uint8Array(dataBuf);

      this.onnxSession = await ort.InferenceSession.create(onnxModelPath, {
        externalData: [
          { path: "tsl_model_fold1.onnx.data", data: externalData },
          { path: "./tsl_model_fold1.onnx.data", data: externalData }
        ]
      });
      console.log(`✅ ONNX 手語分類模型與外部權重 (CDN) 載入成功！`);
    } catch (err) {
      console.log(`ℹ️ CDN 模型或權重不可用 (將自本地端讀取): ${err.message}`);
      const localOnnxPath = `./train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx`;
      const localDataPath = `./train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx.data`;
      try {
        ort.env.wasm.wasmPaths = "./"; // 強制切回本地 WASM 路徑
        console.log(`🧠 正在讀取本地 ONNX 外部權重資料... | 路徑: ${localDataPath}`);
        const localDataRes = await fetch(localDataPath);
        if (!localDataRes.ok) throw new Error(`無法讀取本地權重檔: HTTP ${localDataRes.status}`);
        const localDataBuf = await localDataRes.arrayBuffer();
        const localExternalData = new Uint8Array(localDataBuf);

        this.onnxSession = await ort.InferenceSession.create(localOnnxPath, {
          externalData: [
            { path: "tsl_model_fold1.onnx.data", data: localExternalData },
            { path: "./tsl_model_fold1.onnx.data", data: localExternalData }
          ]
        });
        console.log(`✅ 本地 ONNX 手語分類模型與外部權重載入成功！`);
      } catch (localErr) {
        console.error(`❌ 本地 ONNX 模型與外部權重載入也失敗:`, localErr);
      }
    }
  }

  /**
   * 🌟 100% 瀏覽器本地執行 ONNX 手語預測
   */
  async runInference(featureBuffer, labelMap, currentVocabulary) {
    if (this.isInferring || featureBuffer.length < MODEL_FRAMES) return null;
    this.isInferring = true;

    try {
      if (!this.onnxSession) {
        console.warn("⚠️ ONNX 模組尚未載入完成，無法進行本地推理");
        return null;
      }

      // 1. 準備輸入資料：平鋪為 [1, MODEL_FRAMES, 66] 結構的一維 Float32Array 陣列
      const float32Data = new Float32Array(MODEL_FRAMES * 66);
      for (let i = 0; i < MODEL_FRAMES; i++) {
        // featureBuffer[i] 是一幀 66 維的特徵
        float32Data.set(featureBuffer[i], i * 66);
      }

      // 2. 建立 ONNX 輸入 Tensor (input 名稱與 ONNX 模型中的節點對應)
      const inputTensor = new ort.Tensor('float32', float32Data, [1, MODEL_FRAMES, 66]);

      // 3. 執行推論運算 (完全在瀏覽器 CPU/GPU 進行)
      const feeds = { "input": inputTensor };
      const results = await this.onnxSession.run(feeds);
      
      // 4. 解析輸出 (節點名稱為 'output')
      const outputTensor = results["output"];
      if (!outputTensor) {
        throw new Error("無法從 ONNX 輸出中找到 'output' 節點");
      }
      const logits = outputTensor.data; // 長度為分類個數的 Float32Array

      // 5. 結合遊戲現有難度詞彙過濾，計算最高機率之預測值
      const activeWords = new Set(currentVocabulary.map(v => v.text));
      const topPredictions = [];
      for (let i = 0; i < logits.length; i++) {
        const label = labelMap[String(i)] || `?${i}`;
        const prob = logits[i]; // 輸出 Logit 信心度
        topPredictions.push({ label, prob });
      }

      // 依據模型輸出之 Logit 進行過濾與排序
      const filteredPredictions = topPredictions
        .filter(p => activeWords.has(p.label))
        .sort((a, b) => b.prob - a.prob);

      const top1 = filteredPredictions[0];
      // if (top1) {
      //   console.log(`📡 [ONNX 瀏覽器端] AI 推理成功: ${top1.label} (${top1.prob.toFixed(2)})`);
      // }

      return {
        label: top1?.label || "無",
        confidence: top1?.prob || 0,
        top4: filteredPredictions.slice(0, 4),
        rawLogits: Array.from(logits).slice(0, 10).map(x => x.toFixed(2))
      };

    } catch (err) {
      console.error("❌ ONNX 本地推理運算失敗:", err);
    } finally {
      this.isInferring = false;
    }
    return null;
  }
}
