/**
 * ai_manager.js (優化版)
 */
import { FilesetResolver, HandLandmarker, PoseLandmarker } from "./vision_bundle.mjs";
import { MODEL_FRAMES, VIDEO_CDN_BASE } from './config.js';

export class AIManager {
  constructor() {
    this.handLandmarker = null;
    this.poseLandmarker = null;
    this.onnxSession = null;
    this.isInferring = false;
    
    // 💡 優化 1：預先配置記憶體，避免推論時反覆 new Float32Array 造成 GC 阻塞
    this.preAllocatedData = new Float32Array(MODEL_FRAMES * 66);
  }

  async init() {
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
      baseOptions: { modelAssetPath: finalHandModelPath, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4
    });

    this.poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetPath: finalPoseModelPath, delegate: "GPU" },
      runningMode: "VIDEO"
    });

    const hasNetwork = navigator.onLine;
    ort.env.wasm.wasmPaths = hasNetwork
      ? "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/"
      : "./";
    
    console.log(`🌐 ONNX Runtime WASM 載入路徑設定為: ${ort.env.wasm.wasmPaths}`);

    const baseCdn = hasNetwork ? (VIDEO_CDN_BASE || '') : '';
    const onnxModelPath = `${baseCdn}train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx`;
    const onnxDataPath = `${baseCdn}train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx.data`;
    
    // 💡 優化 2：配置 ONNX Session 的執行硬體加速選項 (優先 WebGL，其次 WebAssembly)
    const sessionOptions = {
      executionProviders: ['webgl', 'wasm'], 
      graphOptimizationLevel: 'all' // 開啟所有圖優化
    };

    try {
      console.log(`🧠 正在下載 ONNX 外部權重資料 (CDN)... | 路徑: ${onnxDataPath}`);
      const dataRes = await fetch(onnxDataPath);
      if (!dataRes.ok) throw new Error(`CDN 檔案不可用 (HTTP ${dataRes.status})`);
      const dataBuf = await dataRes.arrayBuffer();
      const externalData = new Uint8Array(dataBuf);

      // 帶入加速設定與外部權重
      sessionOptions.externalData = [
        { path: "tsl_model_fold1.onnx.data", data: externalData },
        { path: "./tsl_model_fold1.onnx.data", data: externalData }
      ];

      this.onnxSession = await ort.InferenceSession.create(onnxModelPath, sessionOptions);
      console.log(`✅ ONNX 手語分類模型與外部權重 (CDN + WebGL) 載入成功！`);
    } catch (err) {
      console.log(`ℹ️ CDN 模型或權重不可用 (將自本地端讀取): ${err.message}`);
      const localOnnxPath = `./train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx`;
      const localDataPath = `./train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx.data`;
      try {
        ort.env.wasm.wasmPaths = "./"; 
        console.log(`🧠 正在讀取本地 ONNX 外部權重資料... | 路徑: ${localDataPath}`);
        const localDataRes = await fetch(localDataPath);
        if (!localDataRes.ok) throw new Error(`無法讀取本地權重檔: HTTP ${localDataRes.status}`);
        const localDataBuf = await localDataRes.arrayBuffer();
        const localExternalData = new Uint8Array(localDataBuf);

        const localSessionOptions = {
          executionProviders: ['webgl', 'wasm'],
          graphOptimizationLevel: 'all',
          externalData: [
            { path: "tsl_model_fold1.onnx.data", data: localExternalData },
            { path: "./tsl_model_fold1.onnx.data", data: localExternalData }
          ]
        };

        this.onnxSession = await ort.InferenceSession.create(localOnnxPath, localSessionOptions);
        console.log(`✅ 本地 ONNX 手語分類模型與外部權重 (WebGL) 載入成功！`);
      } catch (localErr) {
        console.error(`❌ 本地 ONNX 模型與外部權重載入也失敗:`, localErr);
      }
    }
  }

  /**
   * 🌟 優化後的本地 ONNX 手語預測
   */
  async runInference(featureBuffer, labelMap, currentVocabulary) {
    if (this.isInferring || featureBuffer.length < MODEL_FRAMES) return null;
    this.isInferring = true;

    try {
      if (!this.onnxSession) {
        console.warn("⚠️ ONNX 模組尚未載入完成，無法進行本地推理");
        return null;
      }

      // 💡 優化 3：直接寫入預配置的 Float32Array，大量減少 GC 耗時
      for (let i = 0; i < MODEL_FRAMES; i++) {
        this.preAllocatedData.set(featureBuffer[i], i * 66);
      }

      // 使用預配置記憶體建立 Tensor
      const inputTensor = new ort.Tensor('float32', this.preAllocatedData, [1, MODEL_FRAMES, 66]);
      const feeds = { "input": inputTensor };
      
      const results = await this.onnxSession.run(feeds);
      const outputTensor = results["output"];
      if (!outputTensor) throw new Error("無法從 ONNX 輸出中找到 'output' 節點");
      
      const logits = outputTensor.data;

      // 5. 結合遊戲現有難度詞彙過濾
      const activeWords = new Set(currentVocabulary.map(v => v.text));
      const topPredictions = [];
      for (let i = 0; i < logits.length; i++) {
        const label = labelMap[String(i)] || `?${i}`;
        const prob = logits[i]; 
        topPredictions.push({ label, prob });
      }

      const filteredPredictions = topPredictions
        .filter(p => activeWords.has(p.label))
        .sort((a, b) => b.prob - a.prob);

      const top1 = filteredPredictions[0];

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
