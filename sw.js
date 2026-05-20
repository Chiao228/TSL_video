const CACHE_NAME = 'tsl-game-cache-v6';

const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js?v=20260519',
  './app.js',
  './config.js',
  './ai_manager.js',
  './ui_manager.js',
  './audio_processor.js',
  './game_objects.js',
  './firebase_manager.js',
  './holistic_features.js',
  './ort.min.js',
  './default_bgm_beats.json',
  './label_map.json',
  './background.jpg',
  './house.png',
  './plane.png',
  './bomb.png',
  './explosion.png',
  './default_bgm.mp3',
  './tsl_vocab_videos.json',
  './local_leaderboard.json',
  './vision_bundle.mjs',
  
  // MediaPipe task and WASM files (local)
  './hand_landmarker.task',
  './pose_landmarker_lite.task',
  './wasm/vision_wasm_internal.js',
  './wasm/vision_wasm_internal.wasm',
  './wasm/vision_wasm_nosimd_internal.js',
  './wasm/vision_wasm_nosimd_internal.wasm',

  // ONNX Runtime Web WASM files (local)
  './ort-wasm-simd-threaded.wasm',
  './ort-wasm-simd-threaded.mjs',
  './ort-wasm-simd-threaded.jsep.wasm',
  './ort-wasm-simd-threaded.jsep.mjs',

  // ONNX local model files
  './train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx',
  './train_V36_Transformer_66(modify augmentation + with new asl weight+ sliding window + K-fold + output F1-score)/Fold_1/tsl_model_fold1.onnx.data',

  // CDN URLs for external resources to ensure offline capability
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.wasm',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.mjs',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.jsep.wasm',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.jsep.mjs',
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm/vision_wasm_internal.wasm',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm/vision_wasm_internal.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm/vision_wasm_nosimd_internal.wasm',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm/vision_wasm_nosimd_internal.js'
];

// Difficulty levels map to generate local video paths matching config.js
const WORD_DIFFICULTY = {
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

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      console.log('[Service Worker] Pre-caching static assets...');
      await cache.addAll(STATIC_ASSETS);
      
      try {
        console.log('[Service Worker] Fetching vocabulary list to cache videos...');
        const response = await fetch('./tsl_vocab_videos.json');
        if (response.ok) {
          const videos = await response.json();
          const videoUrls = videos.map(item => {
            const word = item.word_zh.trim();
            const level = WORD_DIFFICULTY[word] || 1;
            return `./videos/Level_${level}/${word}.mp4`;
          });
          console.log(`[Service Worker] Pre-caching ${videoUrls.length} videos...`);
          for (const videoUrl of videoUrls) {
            try {
              // Fetch and cache individually to prevent failing the entire install if a file is missing
              await cache.add(videoUrl);
            } catch (err) {
              console.warn(`[Service Worker] Failed to cache video: ${videoUrl}`, err);
            }
          }
        }
      } catch (err) {
        console.error('[Service Worker] Failed to fetch vocabulary video list:', err);
      }
      
      console.log('[Service Worker] Pre-caching complete! Force activating...');
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Only intercept same-origin requests or specific external CDNs
  const isSameOrigin = url.origin === self.location.origin;
  const isCdn = url.hostname.includes('jsdelivr.net') || url.hostname.includes('googleapis.com');

  if (isSameOrigin || isCdn) {
    if (event.request.headers.get('range')) {
      event.respondWith(handleRangeRequest(event.request));
    } else {
      event.respondWith(
        caches.match(event.request).then(response => {
          if (response) {
            return response;
          }
          return fetch(event.request).then(networkResponse => {
            // Cache new successful requests dynamically
            if (networkResponse.ok && event.request.method === 'GET') {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache);
              });
            }
            return networkResponse;
          }).catch(err => {
            console.error('[Service Worker] Network request failed and no cache available:', err);
            return new Response('Offline content not available', { status: 503, statusText: 'Service Unavailable' });
          });
        })
      );
    }
  }
});

// Helper function to handle media Range requests (for iOS Safari and media seeking)
async function handleRangeRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  let response = await cache.match(request);
  
  if (!response) {
    try {
      response = await fetch(request);
      // Cache the full response dynamically so it can be sliced on subsequent requests
      if (response.ok && request.method === 'GET') {
        const responseToCache = response.clone();
        cache.put(request, responseToCache);
      }
    } catch (err) {
      return new Response('Offline media not available', { status: 503, statusText: 'Service Unavailable' });
    }
  }
  
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader) return response;
  
  try {
    const arrayBuffer = await response.arrayBuffer();
    const bytes = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(bytes[0], 10);
    const end = bytes[1] ? parseInt(bytes[1], 10) : arrayBuffer.byteLength - 1;
    
    const slicedBuffer = arrayBuffer.slice(start, end + 1);
    const newResponse = new Response(slicedBuffer, {
      status: 206,
      statusText: 'Partial Content',
      headers: new Headers({
        'Content-Type': response.headers.get('Content-Type') || 'video/mp4',
        'Content-Range': `bytes ${start}-${end}/${arrayBuffer.byteLength}`,
        'Content-Length': slicedBuffer.byteLength,
        'Accept-Ranges': 'bytes'
      })
    });
    return newResponse;
  } catch (err) {
    console.error('[Service Worker] Error processing range request:', err);
    return response;
  }
}
