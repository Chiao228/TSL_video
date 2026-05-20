/**
 * ai_manager.js (終極優化版 - WebGPU + 隔離防禦)
 */
import { FilesetResolver, HandLandmarker, PoseLandmarker } from "./vision_bundle.mjs";
import { MODEL_FRAMES, VIDEO_CDN_BASE } from './config.js';

export class AIManager {
  constructor() {
    this.handLandmarker = null;
    this.poseLandmarker = null;
    this.onnxSession = null;
    this.isInferring = false;
    
    // 💡 優化 1：預先配置記憶體，避免推論時反覆建立 Float32Array 造成 GC 阻塞
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
    
    // 🌟【GitHub Pages 隔離環境優化】
    // 預設為單執行緒以防止跨域隔離標頭（SharedArrayBuffer）造成的安全性死鎖
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    
    console.log(`🌐 ONNX Runtime WASM 執行緒限制為: 1 (單執行緒防護模式), SIMD: true`);

    const baseCdn = hasNetwork ? (VIDEO_CDN_BASE || '') : '';
    const onnxModelPath = `${baseCdn}train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx`;
    const onnxDataPath = `${baseCdn}train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx.data`;
    
    // 優先使用 WebGPU（2026 頂級硬體加速），不支援時自動降級 WebGL 
    const executionProviders = ['webgpu', 'webgl', 'wasm'];
    const sessionOptions = {
      executionProviders: executionProviders, 
      graphOptimizationLevel: 'all', 
      enableCpuMemBuffer: true,
      logSeverityLevel: 3 // 🌟 隔離非致命警告，確保非同步 Promise 能順利落幕不卡死
    };

    try {
      console.log(`🧠 正在下載 ONNX 外部權重資料 (CDN)... | 路徑: ${onnxDataPath}`);
      const dataRes = await fetch(onnxDataPath);
      if (!dataRes.ok) throw new Error(`CDN 檔案不可用 (HTTP ${dataRes.status})`);
      const dataBuf = await dataRes.arrayBuffer();
      const externalData = new Uint8Array(dataBuf);

      sessionOptions.externalData = [
        { path: "tsl_model_fold1.onnx.data", data: externalData },
        { path: "./tsl_model_fold1.onnx.data", data: externalData }
      ];

      this.onnxSession = await ort.InferenceSession.create(onnxModelPath, sessionOptions);
      console.log(`✅ ONNX 模型（CDN 管道）載入成功！核心加速器啟用中。`);
      return; 
    } catch (err) {
      console.log(`ℹ️ CDN 模型或權重不可用，切換至本地端讀取路徑...`);
    }

    // 本地後備備援管線
    const localOnnxPath = `./train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx`;
    const localDataPath = `./train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx.data`;
    
    try {
      console.log(`🧠 正在讀取本地 ONNX 外部權重資料... | 路徑: ${localDataPath}`);
      const localDataRes = await fetch(localDataPath);
      if (!localDataRes.ok) throw new Error(`無法讀取本地權重檔: HTTP ${localDataRes.status}`);
      const localDataBuf = await localDataRes.arrayBuffer();
      const localExternalData = new Uint8Array(localDataBuf);

      const localSessionOptions = {
        executionProviders: executionProviders,
        graphOptimizationLevel: 'all',
        enableCpuMemBuffer: true,
        logSeverityLevel: 3,
        externalData: [
          { path: "tsl_model_fold1.onnx.data", data: localExternalData },
          { path: "./tsl_model_fold1.onnx.data", data: localExternalData }
        ]
      };

      this.onnxSession = await ort.InferenceSession.create(localOnnxPath, localSessionOptions);
      console.log(`✅ 本地 ONNX 手語分類模型與外部權重載入成功！`);
    } catch (localErr) {
      console.error(`❌ 嚴重錯誤：CDN 與本地模型權重載入完全失敗:`, localErr);
      throw localErr; 
    }
  }

  /**
   * 🌟 優化後的零分配（Zero-Allocation）手語預測
   */
  async runInference(featureBuffer, labelMap, currentVocabulary) {
    if (this.isInferring || featureBuffer.length < MODEL_FRAMES) return null;
    this.isInferring = true;

    try {
      if (!this.onnxSession) {
        console.warn("⚠️ ONNX 模組尚未載入完成，無法進行本地推理");
        return null;
      }

      for (let i = 0; i < MODEL_FRAMES; i++) {
        this.preAllocatedData.set(featureBuffer[i], i * 66);
      }

      const inputTensor = new ort.Tensor('float32', this.preAllocatedData, [1, MODEL_FRAMES, 66]);
      const feeds = { "input": inputTensor };
      
      const results = await this.onnxSession.run(feeds);
      const outputTensor = results["output"];
      if (!outputTensor) throw new Error("無法從 ONNX 輸出中找到 'output' 節點");
      
      const logits = outputTensor.data;

      // 💡 優化 2：直接在迴圈內使用 Set 進行難度交叉比對，大量減少產生物件陣列的記憶體消耗
      const activeWords = new Set(currentVocabulary.map(v => v.text));
      const filteredPredictions = [];
      
      for (let i = 0; i < logits.length; i++) {
        const label = labelMap[String(i)] || `?${i}`;
        if (activeWords.has(label)) {
          filteredPredictions.push({ label, prob: logits[i] });
        }
      }

      filteredPredictions.sort((a, b) => b.prob - a.prob);
      const top1 = filteredPredictions[0];

      return {
        label: top1?.label || "無",
        confidence: top1?.prob || 0,
        top4: filteredPredictions.slice(0, 4),
        rawLogits: [] // 清空無意義格式化，大幅釋放 CPU
      };

    } catch (err) {
      console.error("❌ ONNX 本地推理運算失敗:", err);
    } finally {
      this.isInferring = false;
    }
    return null;
  }
}
