/**
 * firebase_manager.js
 * 負責將遊玩紀錄儲存至 Google Firebase Firestore 雲端資料庫，並支援本地 localStorage 雙軌備援。
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ==========================================
// 🔥 請在此處貼上您自己的 Firebase 設定檔：
// 您可以在 Firebase Console -> 專案設定 -> 您的應用程式 中找到此 JSON
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyCPcZUYi5Q47iE3UpXaM4Zkw90RtD61-tk",
  authDomain: "tsl-rhythm-game.firebaseapp.com",
  projectId: "tsl-rhythm-game",
  storageBucket: "tsl-rhythm-game.firebasestorage.app",
  messagingSenderId: "837614444705",
  appId: "1:837614444705:web:4e11bd9f0b1e7b987dd0e0",
  measurementId: "G-XGHRTP4C43"
};

let db = null;
let useFirebase = false;

// 檢測是否配置了真實的 Firebase API Key
if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY") {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    useFirebase = true;
    console.log("🔥 Firebase Firestore 雲端資料庫初始化成功！");
  } catch (err) {
    console.error("❌ Firebase 初始化失敗，將降級使用本機儲存:", err);
  }
} else {
  console.warn("⚠️ 偵測到預設的 Firebase 金鑰。請於 firebase_manager.js 內填寫您的 Firebase 設定以啟用雲端排行榜。目前暫時降級使用本地瀏覽器 localStorage。");
}

export async function saveScoreToCloud(playerName, finalScore, difficulty) {
  const newRecord = {
    name: playerName,
    score: Number(finalScore),
    difficulty: difficulty,
    time: new Date().toLocaleString('zh-TW', { hour12: false })
  };

  // 1. 本地備份存檔 (localStorage)
  try {
    let localScores = JSON.parse(localStorage.getItem('local_leaderboard') || '[]');
    localScores.push(newRecord);
    localScores.sort((a, b) => b.score - a.score);
    localScores = localScores.slice(0, 50);
    localStorage.setItem('local_leaderboard', JSON.stringify(localScores));
  } catch (localErr) {
    console.error("❌ 寫入本地備援排行榜失敗:", localErr);
  }

  // 2. 雲端存檔 (Firebase Firestore)
  if (useFirebase && db) {
    try {
      // 寫入 Firestore 的 'leaderboard' 集合中
      const docRef = await addDoc(collection(db, "leaderboard"), {
        name: playerName,
        score: Number(finalScore),
        difficulty: difficulty,
        timestamp: new Date() // 使用 Date 結構方便 Firestore 高效排序
      });
      console.log("☁️ 分數成功上傳至 Firebase Firestore, DocID:", docRef.id);
      return { status: "success", record: newRecord, storage: "firebase" };
    } catch (err) {
      console.error("❌ 上傳分數至 Firebase 失敗:", err);
      throw err;
    }
  }

  return { status: "success", record: newRecord, storage: "localStorage" };
}

export async function getTop10Scores() {
  // 1. 如果有啟用 Firebase，優先從 Firestore 讀取全球前十名
  if (useFirebase && db) {
    try {
      const q = query(collection(db, "leaderboard"), orderBy("score", "desc"), limit(10));
      const querySnapshot = await getDocs(q);
      const scores = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        scores.push({
          name: data.name || "匿名",
          score: data.score || 0,
          difficulty: data.difficulty || "一般",
          time: data.timestamp ? data.timestamp.toDate().toLocaleString('zh-TW', { hour12: false }) : ""
        });
      });
      return scores;
    } catch (err) {
      console.error("❌ 從 Firebase 獲取排行榜失敗，降級從 localStorage 讀取:", err);
    }
  }

  // 2. 降級備份：從瀏覽器 localStorage 讀取本地前十名
  try {
    const localScores = JSON.parse(localStorage.getItem('local_leaderboard') || '[]');
    return localScores.slice(0, 10);
  } catch (e) {
    console.error("❌ 無法獲取本地排行榜:", e);
    return [];
  }
}
