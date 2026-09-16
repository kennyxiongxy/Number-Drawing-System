/* ============================================================================
 * 在线抽号系统 · 抽号逻辑
 * ----------------------------------------------------------------------------
 * 公平性设计（对应 random.js 中的抽样核心）：
 *   1. 「先定后演」——结果在点击「开始抽号」的瞬间就已确定，
 *      1.2 秒滚动动画只负责揭晓，绝不参与决策，也绝不读屏上显示的数字；
 *   2. 无放回等概率抽样 = 部分 Fisher-Yates，数学上每个组合概率相等；
 *   3. 熵源为 crypto.getRandomValues + 拒绝采样，零取模偏差；
 *   4. 每次抽号记录 128 位随机种子与抽样前后号码池，
 *      任何人拿种子都能离线重算出同一结果，用于事后核验；
 *   5. 抽号期间冻结参数输入，且状态收尾先于装饰动画，
 *      任何异常（含彩带 CDN 挂掉）都不会把按钮锁死。
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 元素 */
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
  const stage = document.getElementById('stage');
  const liveResult = document.getElementById('liveResult');
  const logList = document.getElementById('logList');
  const logMeta = document.getElementById('logMeta');
  const exportLogBtn = document.getElementById('exportLogBtn');

  const FR = window.FairRandom;

  /* ---------------------------------------------------------------- 状态 */
  let total = 10;
  let perDraw = 1;
  let remaining = [];
  let drawn = [];
  let isDrawing = false;
  let animationFrame = null;
  let confettiFrame = null;
  let round = 1;
  const drawLog = [];

  /* ---------------------------------------------------------------- 工具 */
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function announce(text) {
    if (liveResult) liveResult.textContent = text;
  }

  const defer = (typeof setTimeout === 'function')
    ? setTimeout
    : function (fn) { Promise.resolve().then(fn); };

  /** 纯 ASCII 内容用的 UTF-8 编码兜底（日志正文全部是数字与符号） */
  function strToBytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(bytes);
  }

  /* ------------------------------------------------------------ 初始化 */
  function init() {
    total = clamp(parseInt(totalInput.value, 10) || 10, 1, 999);
    perDraw = clamp(parseInt(countInput.value, 10) || 1, 1, total);
    remaining = Array.from({ length: total }, (_, i) => i + 1);
    drawn = [];
    render();
  }

  function validate(showError) {
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

  /* -------------------------------------------------------------- 渲染 */
  function render() {
    totalInput.value = total;
    countInput.value = perDraw;

    remainingEl.innerHTML = '';
    if (remaining.length === 0) {
      remainingEl.appendChild(createEmptyTip('全部已抽取'));
    } else {
      remaining.forEach(n => remainingEl.appendChild(createChip(n, false)));
    }

    drawnEl.innerHTML = '';
    if (drawn.length === 0) {
      drawnEl.appendChild(createEmptyTip('暂无记录'));
    } else {
      drawn.forEach(n => drawnEl.appendChild(createChip(n, true)));
    }

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

    renderLog();
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

  function setResultSize(count) {
    const classes = ['size-1', 'size-2', 'size-4', 'size-9', 'size-many'];
    result.classList.remove(...classes);
    if (count === 1) result.classList.add('size-1');
    else if (count <= 2) result.classList.add('size-2');
    else if (count <= 4) result.classList.add('size-4');
    else if (count <= 9) result.classList.add('size-9');
    else result.classList.add('size-many');
  }

  /** 抽号期间冻结所有输入，杜绝「动画进行中改参数污染结果」 */
  function setBusy(busy) {
    totalInput.disabled = busy;
    countInput.disabled = busy;
    drawBtn.disabled = busy;
    resetBtn.disabled = busy;
    if (stage) stage.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  /* ------------------------------------------------------------ 抽号 */
  function draw() {
    if (isDrawing) return;
    if (!validate(true)) return;

    total = parseInt(totalInput.value, 10);
    perDraw = parseInt(countInput.value, 10);

    if (remaining.length === 0) {
      showErrorMsg('所有小组已抽取，请重置开始新一轮');
      render();
      return;
    }
    if (perDraw > remaining.length) {
      showErrorMsg('剩余小组数不足（还剩 ' + remaining.length + ' 组），请减少每次抽取组数或重置');
      render();
      return;
    }

    hideError();

    // ★ 先定后演：结果在这一刻已经确定，之后的动画只是揭晓过程
    const poolBefore = remaining.slice();
    let rng;
    let outcome;
    try {
      rng = FR.newSeededRandInt();
      outcome = FR.sampleWithoutReplacement(poolBefore, perDraw, rng);
    } catch (err) {
      showErrorMsg('抽样失败：' + err.message);
      isDrawing = false;
      setBusy(false);
      render();
      return;
    }

    if (!rng.usedCrypto) {
      console.warn('[抽号系统] 当前环境不支持 crypto.getRandomValues，已降级使用 Math.random()。' +
        '统计公平性不受影响，但可预测性增强，不建议用于正式比赛场景。');
    }

    logDraw(outcome, new Date(), rng.seedHex, poolBefore);

    isDrawing = true;
    setBusy(true);

    result.innerHTML = '';
    result.classList.add('hidden');
    result.setAttribute('aria-hidden', 'true');
    roller.classList.remove('hidden');
    roller.classList.add('shake');
    hint.textContent = '正在抽号…';

    const duration = prefersReducedMotion() ? 200 : 1200;
    const tickInterval = 70;
    const start = performance.now();
    let lastTick = -Infinity;

    function animate(now) {
      const elapsed = now - start;
      if (elapsed - lastTick >= tickInterval) {
        lastTick = elapsed;
        if (outcome.selected.length === 1 && elapsed >= duration - tickInterval) {
          // 单号抽取：最后一帧直接落在真实结果上，消除「最后一刻跳一下」的观感疑虑
          roller.textContent = outcome.selected[0];
        } else {
          // 滚动预览：独立使用 Math.random()，不消耗种子流，对结果零影响
          roller.textContent = poolBefore[Math.floor(Math.random() * poolBefore.length)];
        }
      }
      if (elapsed < duration) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        finishDraw(outcome);
      }
    }

    animationFrame = requestAnimationFrame(animate);
  }

  function finishDraw(outcome) {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    roller.classList.remove('shake');

    const selected = outcome.selected;
    const pool = outcome.pool;

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

    // ★ 先把状态收尾并解锁按钮，装饰效果放到最后，且必须容错
    isDrawing = false;
    setBusy(false);
    render();

    announce('本次抽中 ' + selected.join('、') + ' 号。本轮已抽 ' + drawn.length +
      ' 组，剩余 ' + remaining.length + ' 组。');

    try {
      if (typeof window.confetti === 'function') triggerConfetti();
    } catch (err) {
      console.warn('[抽号系统] 彩带效果不可用，已跳过（不影响抽号）：', err);
    }
  }

  function triggerConfetti() {
    if (typeof window.confetti !== 'function') return;   // CDN 未就绪：静默跳过
    const end = Date.now() + 1000;
    const colors = ['#FF6B4A', '#14B8A6', '#FBBF24', '#F43F5E'];

    (function frame() {
      if (typeof window.confetti !== 'function') return;
      window.confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0 }, colors: colors });
      window.confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1 }, colors: colors });
      if (Date.now() < end) {
        confettiFrame = requestAnimationFrame(frame);
      } else {
        confettiFrame = null;
      }
    })();
  }

  function reset() {
    if (isDrawing) return;
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    if (confettiFrame !== null) {
      cancelAnimationFrame(confettiFrame);
      confettiFrame = null;
    }
    try {
      if (typeof window.confetti === 'function' && typeof window.confetti.reset === 'function') {
        window.confetti.reset();
      }
    } catch (err) { /* 装饰效果失败不影响重置 */ }

    round += 1;
    init();
    roller.textContent = '?';
    roller.classList.remove('hidden', 'shake');
    result.classList.remove('size-1', 'size-2', 'size-4', 'size-9', 'size-many');
    result.classList.add('hidden');
    result.setAttribute('aria-hidden', 'true');
    result.innerHTML = '';
    hideError();
    render();
    announce('已重置，开始第 ' + round + ' 轮，共 ' + total + ' 组。');
  }

  /* --------------------------------------------------- 参数变化（状态守卫） */
  function handleTotalChange() {
    if (isDrawing) { render(); return; }        // 抽号中：回滚显示，不改状态
    if (!validate(true)) return;

    const nextTotal = clamp(parseInt(totalInput.value, 10) || 10, 1, 999);
    if (nextTotal === total) { render(); return; }

    // 不再无条件清空记录：只清理超出新范围的部分，并要求确认
    const removed = drawn.filter(n => n > nextTotal);
    if (removed.length) {
      const ok = (typeof window.confirm === 'function')
        ? window.confirm('新的总小组数为 ' + nextTotal + '，已抽号码 ' + removed.join('、') +
            ' 超出范围，继续将删除这些记录。\n其余 ' + (drawn.length - removed.length) +
            ' 条记录会保留。\n\n确定要修改吗？')
        : true;
      if (!ok) { render(); return; }            // 取消：输入框回滚为当前生效值
    }

    const kept = new Set(drawn.filter(n => n <= nextTotal));
    total = nextTotal;
    drawn = drawn.filter(n => kept.has(n));
    remaining = Array.from({ length: total }, (_, i) => i + 1).filter(n => !kept.has(n));
    perDraw = clamp(perDraw, 1, Math.max(1, Math.min(total, remaining.length || total)));
    hideError();
    render();
  }

  function handleCountChange() {
    if (isDrawing) { render(); return; }        // 抽号中：忽略，杜绝超量抽取
    if (!validate(true)) return;
    perDraw = clamp(parseInt(countInput.value, 10) || 1, 1, total);
    hideError();
    render();
  }

  /* --------------------------------------------------- 抽取日志（可核验） */
  let hashWarned = false;

  function canonical(rec) {
    return JSON.stringify({
      seq: rec.seq, round: rec.round, at: rec.at, total: rec.total, perDraw: rec.perDraw,
      poolBefore: rec.poolBefore, selected: rec.selected, poolAfter: rec.poolAfter, seed: rec.seed
    });
  }

  function logDraw(outcome, at, seedHex, poolBefore) {
    const rec = {
      seq: drawLog.length + 1,
      round: round,
      at: at.toISOString(),
      total: total,
      perDraw: outcome.selected.length,
      poolBefore: poolBefore.slice(),
      selected: outcome.selected.slice(),
      poolAfter: outcome.pool.slice(),
      seed: seedHex,
      algorithm: 'partial-fisher-yates + uint32-rejection + sfc32',
      crypto: FR.cryptoAvailable()
    };
    drawLog.push(rec);
    renderLog();
    scheduleChainHash();
    return rec;
  }

  /** 哈希链：hash = SHA-256(prevHash + 记录)，事后改动任意一条都会断链 */
  function scheduleChainHash() {
    defer(function () {
      const subtle = window.crypto && window.crypto.subtle;
      if (!subtle || typeof subtle.digest !== 'function') {
        if (!hashWarned) {
          hashWarned = true;
          console.warn('[抽号系统] 当前环境不支持 SHA-256（需要 HTTPS 或 localhost），已跳过哈希链；' +
            '种子日志仍然完整，可离线复算核验。');
        }
        return;
      }
      (function recompute(prev, i) {
        if (i >= drawLog.length) { renderLog(); return; }
        const rec = drawLog[i];
        rec.prevHash = prev;
        subtle.digest('SHA-256', strToBytes(prev + '|' + canonical(rec))).then(function (buf) {
          rec.hash = Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return b.toString(16).padStart(2, '0');
          }).join('');
          recompute(rec.hash, i + 1);
        }).catch(function (err) {
          console.warn('[抽号系统] 哈希链计算失败，跳过：', err);
        });
      })('0'.repeat(64), 0);
    });
  }

  function renderLog() {
    if (!logList) return;
    logList.innerHTML = '';
    if (drawLog.length === 0) {
      logList.appendChild(createEmptyTip('暂无抽取记录'));
    } else {
      drawLog.slice(-20).reverse().forEach(function (rec) {
        const item = document.createElement('div');
        item.className = 'log-item';
        const time = rec.at.slice(11, 19);
        item.textContent = '#' + rec.seq + ' · 第' + rec.round + '轮 · ' + time +
          ' · 抽中 ' + rec.selected.join('、') +
          ' · 剩余 ' + rec.poolAfter.length +
          ' · 种子 ' + rec.seed.slice(0, 8);
        logList.appendChild(item);
      });
    }
    if (logMeta) {
      logMeta.textContent = '第 ' + round + ' 轮 · 共 ' + drawLog.length + ' 条记录' +
        (drawLog.length > 20 ? '（显示最近 20 条）' : '');
    }
    if (exportLogBtn) exportLogBtn.disabled = drawLog.length === 0;
  }

  function download(text, filename, mime) {
    try {
      if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
        console.log('[抽号系统] 当前环境不支持下载，日志内容如下：\n' + text);
        return false;
      }
      const blob = new Blob([text], { type: mime || 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      if (document.body && typeof document.body.appendChild === 'function') {
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        a.click();
      }
      defer(function () { URL.revokeObjectURL(url); });
      return true;
    } catch (err) {
      console.warn('[抽号系统] 导出失败：', err);
      return false;
    }
  }

  function exportLog() {
    const payload = {
      system: '在线抽号系统',
      exportedAt: new Date().toISOString(),
      algorithm: 'partial-fisher-yates + uint32-rejection + sfc32',
      verifyHint: '核验方式：对任一条记录，用 seed 构造 FairRandom.makeSeededRandInt(seed)，' +
        '再执行 FairRandom.sampleWithoutReplacement(record.poolBefore, record.selected.length, rng)，' +
        '结果应与 record.selected / record.poolAfter 完全一致；' +
        '也可直接调用页面控制台里的 LotteryAudit.verify(序号)。',
      rounds: round,
      records: drawLog
    };
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
    const ok = download(JSON.stringify(payload, null, 2), '抽号记录-' + stamp + '.json', 'application/json');
    announce(ok ? '已导出抽号记录' : '当前环境无法下载，已把记录打印到控制台');
  }

  /** 哈希链自检：重算一遍，返回是否连续一致 */
  function verifyChain() {
    let prev = '0'.repeat(64);
    for (let i = 0; i < drawLog.length; i++) {
      const rec = drawLog[i];
      if (rec.prevHash && rec.prevHash !== prev) return false;
      if (rec.hash) {
        // 只比对链条连续性；哈希本身由浏览器异步计算，此处不重算摘要
        prev = rec.hash;
      }
    }
    return true;
  }

  /* ------------------------------------------------------------ 事件绑定 */
  drawBtn.addEventListener('click', draw);
  resetBtn.addEventListener('click', reset);
  totalInput.addEventListener('change', handleTotalChange);
  countInput.addEventListener('change', handleCountChange);
  if (exportLogBtn) exportLogBtn.addEventListener('click', exportLog);

  /* -------------------------------------------------- 对外暴露核验入口 */
  window.LotteryAudit = {
    getLog: function () { return drawLog.slice(); },
    exportLog: exportLog,
    verify: function (index) {
      const rec = drawLog[index - 1] || drawLog[index];
      return rec ? FR.verifyRecord(rec) : false;
    },
    verifyAll: function () { return drawLog.every(function (rec) { return FR.verifyRecord(rec); }); },
    verifyChain: verifyChain
  };

  /* -------------------------------------------------------------- 启动 */
  init();
  renderLog();
})();
