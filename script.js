const totalInput = document.getElementById('totalInput');
const countInput = document.getElementById('countInput');
const drawBtn = document.getElementById('drawBtn');
const resetBtn = document.getElementById('resetBtn');
const roller = document.getElementById('roller');
const result = document.getElementById('result');
const hint = document.getElementById('hint');
const remainingEl = document.getElementById('remaining');
const drawnEl = document.getElementById('drawn');
const errorMsg = document.getElementById('errorMsg');

let total = 10;
let perDraw = 1;
let remaining = [];
let drawn = [];
let isDrawing = false;
let animationFrame = null;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function init() {
  total = clamp(parseInt(totalInput.value, 10) || 10, 1, 999);
  perDraw = clamp(parseInt(countInput.value, 10) || 1, 1, total);
  remaining = Array.from({ length: total }, (_, i) => i + 1);
  drawn = [];
  render();
}

function validate(showError = false) {
  const t = parseInt(totalInput.value, 10);
  const c = parseInt(countInput.value, 10);

  if (!Number.isInteger(t) || t < 1 || t > 999) {
    if (showError) showErrorMsg('总小组数需为 1-999 的整数');
    return false;
  }
  if (!Number.isInteger(c) || c < 1 || c > 999) {
    if (showError) showErrorMsg('每次抽取组数需为 1-999 的整数');
    return false;
  }
  if (c > t) {
    if (showError) showErrorMsg('每次抽取组数不能超过总小组数');
    return false;
  }
  return true;
}

function showErrorMsg(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.classList.add('hidden');
}

function render() {
  totalInput.value = total;
  countInput.value = perDraw;

  // 剩余未抽取
  remainingEl.innerHTML = '';
  if (remaining.length === 0) {
    remainingEl.appendChild(createEmptyTip('全部已抽取'));
  } else {
    remaining.forEach(n => remainingEl.appendChild(createChip(n, false)));
  }

  // 已抽取记录
  drawnEl.innerHTML = '';
  if (drawn.length === 0) {
    drawnEl.appendChild(createEmptyTip('暂无记录'));
  } else {
    drawn.forEach(n => drawnEl.appendChild(createChip(n, true)));
  }

  // 按钮与提示
  drawBtn.disabled = isDrawing || remaining.length === 0 || perDraw > remaining.length;
  if (isDrawing) {
    hint.textContent = '正在抽号…';
  } else if (remaining.length === 0) {
    hint.textContent = '所有小组已抽取，请重置开始新一轮';
  } else if (perDraw > remaining.length) {
    hint.textContent = '剩余小组不足，请减少每次抽取组数或重置';
  } else {
    hint.textContent = '点击“开始抽号”开始抽取';
  }
}

function createChip(n, isDrawn) {
  const chip = document.createElement('span');
  chip.className = 'chip' + (isDrawn ? ' drawn' : '');
  chip.textContent = n;
  return chip;
}

function createEmptyTip(text) {
  const tip = document.createElement('span');
  tip.className = 'empty-tip';
  tip.textContent = text;
  return tip;
}

function draw() {
  if (isDrawing) return;
  if (!validate(true)) return;

  total = parseInt(totalInput.value, 10);
  perDraw = parseInt(countInput.value, 10);

  if (perDraw > remaining.length) {
    showErrorMsg('剩余小组数不足，请重置或调整每次抽取组数');
    return;
  }

  hideError();
  isDrawing = true;
  drawBtn.disabled = true;
  resetBtn.disabled = true;
  result.classList.add('hidden');
  result.setAttribute('aria-hidden', 'true');
  roller.classList.remove('hidden');
  roller.classList.add('shake');

  const duration = 1200;
  const start = performance.now();
  const tickInterval = 70;
  let lastTick = -Infinity;

  function animate(now) {
    const elapsed = now - start;
    if (elapsed - lastTick >= tickInterval) {
      roller.textContent = remaining[Math.floor(Math.random() * remaining.length)];
      lastTick = elapsed;
    }
    if (elapsed < duration) {
      animationFrame = requestAnimationFrame(animate);
    } else {
      finishDraw();
    }
  }

  animationFrame = requestAnimationFrame(animate);
}

function setResultSize(count) {
  const classes = ['size-1', 'size-2', 'size-4', 'size-9', 'size-many'];
  result.classList.remove(...classes);
  if (count === 1) result.classList.add('size-1');
  else if (count <= 2) result.classList.add('size-2');
  else if (count <= 4) result.classList.add('size-4');
  else if (count <= 9) result.classList.add('size-9');
  else result.classList.add('size-many');
}

function finishDraw() {
  cancelAnimationFrame(animationFrame);
  animationFrame = null;
  roller.classList.remove('shake');

  const selected = [];
  const pool = remaining.slice();
  for (let i = 0; i < perDraw; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    selected.push(pool[idx]);
    pool.splice(idx, 1);
  }
  selected.sort((a, b) => a - b);

  drawn = drawn.concat(selected);
  remaining = pool;

  result.innerHTML = '';
  setResultSize(selected.length);
  selected.forEach(num => {
    const card = document.createElement('div');
    card.className = 'number-card';
    card.textContent = num;
    result.appendChild(card);
  });

  roller.classList.add('hidden');
  result.classList.remove('hidden');
  result.setAttribute('aria-hidden', 'false');

  triggerConfetti();

  isDrawing = false;
  resetBtn.disabled = false;
  render();
}

function triggerConfetti() {
  const end = Date.now() + 1000;
  const colors = ['#FF6B4A', '#14B8A6', '#FBBF24', '#F43F5E'];

  (function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: colors
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: colors
    });
    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  })();
}

function reset() {
  if (isDrawing) return;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;

  init();
  roller.textContent = '?';
  roller.classList.remove('hidden', 'shake');
  result.classList.remove('size-1', 'size-2', 'size-4', 'size-9', 'size-many');
  result.classList.add('hidden');
  result.setAttribute('aria-hidden', 'true');
  result.innerHTML = '';
  hint.textContent = '点击“开始抽号”开始抽取';
  hideError();
}

function handleTotalChange() {
  if (!validate(true)) return;
  init();
}

function handleCountChange() {
  if (!validate(true)) return;
  perDraw = clamp(parseInt(countInput.value, 10) || 1, 1, total);
  render();
}

// 事件绑定
drawBtn.addEventListener('click', draw);
resetBtn.addEventListener('click', reset);

totalInput.addEventListener('change', handleTotalChange);
countInput.addEventListener('change', handleCountChange);

// 初始化
init();
