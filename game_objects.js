import { getCanvasWidth, getCanvasHeight, HOUSE_WIDTH, HOUSE_HEIGHT, HOUSE_MARGIN_BOTTOM } from './config.js';

export class Plane {
  constructor(img) {
    this.img = img;
    this.x = 150; // 🌟 修正：手機版從 HUD 右側出發，給予更安全起始位置
    this.y = 50;
    this.speed = 3.5; // 稍微加快速度，更有動感
    this.direction = 1;
  }

  get width() {
    const scale = getCanvasWidth() < 768 ? 0.5 : 1.0;
    return 240 * scale;
  }

  get height() {
    const scale = getCanvasWidth() < 768 ? 0.5 : 1.0;
    return 110 * scale;
  }

  move() {
    this.x += this.speed * this.direction;

    const currentW = getCanvasWidth();
    const isMobile = currentW < 768;
    
    // 🌟 左界線限制為 0 (遊戲畫面最左邊界)；右界線限制為視訊框框的左側邊緣 (寬度 120px/320px + 右邊距 10px)
    const leftLimit = 0;
    const rightLimit = currentW - (isMobile ? 130 : 330);

    // 左邊界判定
    if (this.x <= leftLimit) {
      this.x = leftLimit;
      this.direction = 1;
    }
    // 右邊界判定
    else if (this.x + this.width >= rightLimit) {
      this.x = rightLimit - this.width;
      this.direction = -1;
    }
  }

  render(ctx) {
    if (this.img && this.img.complete) {
      const imgW = (this.img.naturalWidth / this.img.naturalHeight) * this.height;
      const drawX = this.x + (this.width - imgW) / 2;
      ctx.save();
      if (this.direction === -1) {
        ctx.translate(drawX + imgW / 2, 0);
        ctx.scale(-1, 1);
        ctx.translate(-(drawX + imgW / 2), 0);
      }
      ctx.drawImage(this.img, drawX, this.y, imgW, this.height);
      ctx.restore();
    } else {
      ctx.fillStyle = '#999';
      ctx.fillRect(this.x, this.y, this.width, this.height);
    }
  }
}

export class Bomb {
  static WIDTH = 130;
  static HEIGHT = 130;
  static SPEED = 0.5;
  static MAX_SHRINK_TIME = 70; // 🌟 延長救援縮放時間 (由 35 幀加倍至 70 幀，約 1.16 秒)，給玩家充裕時間抵抗 AI 辨識延遲！

  constructor(x, y, targetTime, spawnTime, word, difficulty, bombImg, explosionImg) {
    this.x = x;
    this.startY = y;
    this.y = y;
    this.targetTime = targetTime;
    this.spawnTime = spawnTime;
    this.word = word;
    this.difficulty = difficulty;
    this.bombImg = bombImg;
    this.explosionImg = explosionImg;

    this.shrinking = false;
    this.shrinkTimer = 0;
    this.exploding = false;
    this.explosionTimer = 0;
    this.shouldExplode = false;
    this.finished = false;
    this.impactResolved = false;
    this.houseDamageApplied = false;
  }

  get width() {
    const scale = getCanvasWidth() < 768 ? 0.5 : 1.0;
    return Bomb.WIDTH * scale;
  }

  get height() {
    const scale = getCanvasWidth() < 768 ? 0.5 : 1.0;
    return Bomb.HEIGHT * scale;
  }

  fall(currentTime, audioOffset) {
    if (!this.shrinking && !this.exploding) {
      const elapsedTime = (currentTime + audioOffset) - this.spawnTime;
      this.y = this.startY + elapsedTime * (Bomb.SPEED * 60);
    }
  }

  // 🌟 將邏輯更新從 render 分離出來
  update() {
    if (this.finished) return;

    if (this.shrinking) {
      this.shrinkTimer += 1;
      if (this.shrinkTimer >= Bomb.MAX_SHRINK_TIME) {
        this.shrinking = false;
        if (this.shouldExplode) {
          this.exploding = true;
          this.explosionTimer = 0;
        } else {
          this.finished = true;
        }
      }
    }

    if (this.exploding) {
      this.explosionTimer += 1;
      if (this.explosionTimer >= 20) { // 🌟 延長爆炸動畫時間至 20 幀 (約 0.33 秒)，提供更寬容的「極限神速救援」判定時間！
        this.exploding = false;
        this.finished = true;
      }
    }
  }

  startShrink(shouldExplode = false) {
    if (this.exploding) return;
    this.shrinking = true;
    this.shrinkTimer = 0;
    this.shouldExplode = shouldExplode;
    this.impactResolved = true;
  }

  render(ctx) {
    if (this.finished) return;
    let drawX = this.x, drawY = this.y, drawW = this.width, drawH = this.height;

    if (this.shrinking) {
      const ratio = 1 - this.shrinkTimer / Bomb.MAX_SHRINK_TIME;
      if (ratio > 0) {
        drawW = this.width * ratio; drawH = this.height * ratio;
        drawX = this.x + (this.width - drawW) / 2; drawY = this.y + (this.height - drawH) / 2;
      }
    }

    if (this.exploding) {
      const size = this.width * 1.5;
      const ex = this.x + (this.width - size) / 2, ey = this.y + (this.height - size) / 2;
      if (this.explosionImg && this.explosionImg.complete) {
        ctx.drawImage(this.explosionImg, ex, ey, size, size);
      } else {
        ctx.fillStyle = 'orange'; ctx.beginPath(); ctx.arc(this.x + this.width / 2, this.y + this.height / 2, size / 2, 0, Math.PI * 2); ctx.fill();
      }
      return;
    }

    if (this.bombImg && this.bombImg.complete) {
      ctx.drawImage(this.bombImg, drawX, drawY, drawW, drawH);
    } else {
      ctx.fillStyle = '#CC0000'; ctx.fillRect(drawX, drawY, drawW, drawH);
    }

    // 🌟 繪製手語文字 (手機版自動調小字型)
    const isMobile = getCanvasWidth() < 768;
    let fontSize = isMobile ? 14 : 28; // 預設 2 個字的大小
    if (this.word.length === 1) fontSize = isMobile ? 18 : 34;
    else if (this.word.length >= 3) fontSize = isMobile ? 11 : 22;

    ctx.font = `bold ${fontSize}px "Microsoft JhengHei", Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;

    ctx.strokeStyle = '#000';
    ctx.lineWidth = isMobile ? 2 : 4;
    ctx.strokeText(this.word, centerX, centerY);
    ctx.fillStyle = '#FFFF00';
    ctx.fillText(this.word, centerX, centerY);
  }
}

