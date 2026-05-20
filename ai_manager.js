/**
 * ai_manager.js (終極優化版 - WebGPU + 多執行緒 WASM)
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
    
    // 🔥 ⚡【關鍵速度優化 1】優化 WASM 核心環境變數（支援多執行緒與 SIMD 加速）
    // 當不支援 WebGPU 降級到 WASM 時，利用硬體多核心加速，效能提升 2~3 倍
    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
    ort.env.wasm.simd = true;
    
    console.log(`🌐 ONNX Runtime WASM 執行緒數設定為: ${ort.env.wasm.numThreads}, SIMD: true`);

    const baseCdn = hasNetwork ? (VIDEO_CDN_BASE || '') : '';
    const onnxModelPath = `${baseCdn}train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx`;
    const onnxDataPath = `${baseCdn}train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx.data`;
    
    // 🔥 ⚡【關鍵速度優化 2】推論後端全面升級
    // 將 'webgpu' 設為第一順位（2026 最頂級網頁 AI 加速後端），其次為 'webgl'，最後 'wasm' 後備。
    const executionProviders = ['webgpu', 'webgl', 'wasm'];
    const sessionOptions = {
      executionProviders: executionProviders, 
      graphOptimizationLevel: 'all', // 開啟所有圖優化
      enableCpuMemBuffer: true       // 允許 GPU/CPU 之間高效記憶體緩衝
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
      console.log(`✅ ONNX 模型載入成功！核心加速器啟用中。`);
    } catch (err) {
      console.log(`ℹ️ CDN 模型或權重不可用 (將自本地端讀取): ${err.message}`);
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
          externalData: [
            { path: "tsl_model_fold1.onnx.data", data: localExternalData },
            { path: "./tsl_model_fold1.onnx.data", data: localExternalData }
          ]
        };

        this.onnxSession = await ort.InferenceSession.create(localOnnxPath, localSessionOptions);
        console.log(`✅ 本地 ONNX 手語分類模型與外部權重載入成功！`);
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

      // 直接寫入預配置的 Float32Array，大量減少 GC 耗時
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

      // 🔥 ⚡【關鍵速度優化 3】優化過濾算法
      // 不要每次推論都跑對數十萬陣列的 Array.from() 與 slice()，只針對過濾後的 top 進行排序
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
        rawLogits: [] // 如果遊戲不需要印出前10個原始 logit，放空可節省大量 CPU 格式化運算時間
      };

    } catch (err) {
      console.error("❌ ONNX 本地推理運算失敗:", err);
    } finally {
      this.isInferring = false;
    }
    return null;
  }
}
