/* ============================================================================
 * 随机性与公平性统计检验
 * 运行：node tests/randomness-test.mjs
 *
 * 检验对象是页面真正使用的抽样核心 random.js（不是复刻版本），
 * 所以这里跑通 = 线上代码的抽样分布通过检验。
 * ========================================================================== */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const corePath = path.join(here, '..', 'random.js');

vm.runInThisContext(fs.readFileSync(corePath, 'utf8'), { filename: 'random.js' });
const FR = globalThis.FairRandom;
if (!FR) throw new Error('未能加载 random.js 中的 FairRandom');

let failures = 0;

function chiSquare(observed, expected) {
  let x2 = 0;
  for (let i = 0; i < observed.length; i++) {
    const d = observed[i] - expected;
    x2 += (d * d) / expected;
  }
  return x2;
}

/** 卡方上侧临界值（p=0.01），用于避免偶发误报 */
const CRIT_01 = { 5: 15.09, 9: 21.67, 19: 36.19, 29: 49.59, 49: 74.92, 89: 122.94, 99: 134.64 };

function check(name, x2, df) {
  const crit = CRIT_01[df] ?? df * 2;
  const ok = x2 <= crit;
  if (!ok) failures++;
  console.log(
    `${ok ? '✅ PASS' : '❌ FAIL'}  ${name}\n` +
    `          卡方 = ${x2.toFixed(2)}  df = ${df}  p=0.01 临界值 = ${crit}`
  );
  return ok;
}

console.log('抽样核心：', corePath);
console.log('熵源：', FR.cryptoAvailable() ? 'crypto.getRandomValues (CSPRNG)' : 'Math.random 降级');
console.log('');

/* ------------------------------------------------------------------ 检验 1 */
{
  console.log('— 检验 1：总 10 组、每次抽 1 组，各组被抽中概率是否相等（N = 200000）');
  const N = 200000, total = 10;
  const cnt = new Array(total).fill(0);
  const pool = Array.from({ length: total }, (_, i) => i + 1);
  for (let i = 0; i < N; i++) {
    const { selected } = FR.sampleWithoutReplacement(pool, 1, FR.secureRandomInt);
    cnt[selected[0] - 1]++;
  }
  const exp = N / total;
  console.log('          频次：', cnt.join(', '), '| 期望：', exp);
  check('单次抽取均匀性', chiSquare(cnt, exp), total - 1);
}

/* ------------------------------------------------------------------ 检验 2 */
{
  console.log('\n— 检验 2：总 10 组、每次抽 3 组，每组被抽中概率应均为 30%（N = 100000）');
  const N = 100000, total = 10, per = 3;
  const cnt = new Array(total).fill(0);
  const pool = Array.from({ length: total }, (_, i) => i + 1);
  let dup = 0, wrongLen = 0;
  for (let i = 0; i < N; i++) {
    const { selected } = FR.sampleWithoutReplacement(pool, per, FR.secureRandomInt);
    if (selected.length !== per) wrongLen++;
    if (new Set(selected).size !== per) dup++;
    selected.forEach(n => cnt[n - 1]++);
  }
  const exp = (N * per) / total;
  console.log('          频次：', cnt.join(', '), '| 期望：', exp);
  check('批量抽取各组命中率', chiSquare(cnt, exp), total - 1);
  const okDup = dup === 0 && wrongLen === 0;
  if (!okDup) failures++;
  console.log(`${okDup ? '✅ PASS' : '❌ FAIL'}  单次内部不重复 / 数量正确（重复 ${dup} 次，数量异常 ${wrongLen} 次）`);
}

/* ------------------------------------------------------------------ 检验 3 */
{
  console.log('\n— 检验 3：一轮把 10 组全部抽完，每个位置的号码是否都无偏好（20000 轮）');
  const rounds = 20000, total = 10;
  const pos = Array.from({ length: total }, () => new Array(total).fill(0));
  for (let r = 0; r < rounds; r++) {
    let pool = Array.from({ length: total }, (_, i) => i + 1);
    for (let p = 0; p < total; p++) {
      const out = FR.sampleWithoutReplacement(pool, 1, FR.secureRandomInt);
      pos[p][out.selected[0] - 1]++;
      pool = out.pool;
    }
  }
  let worst = 0, worstPos = -1;
  for (let p = 0; p < total; p++) {
    const x2 = chiSquare(pos[p], rounds / total);
    if (x2 > worst) { worst = x2; worstPos = p; }
  }
  check(`顺序均匀性（最差位置：第 ${worstPos + 1} 位）`, worst, total - 1);
}

/* ------------------------------------------------------------------ 检验 4 */
{
  console.log('\n— 检验 4：拒绝采样本身是否均匀（直接测 secureRandomInt，N = 300000）');
  const N = 300000, m = 7;
  const cnt = new Array(m).fill(0);
  for (let i = 0; i < N; i++) {
    const v = FR.secureRandomInt(m);
    if (v < 0 || v >= m || !Number.isInteger(v)) {
      failures++;
      console.log('❌ FAIL  返回值越界：', v);
      break;
    }
    cnt[v]++;
  }
  console.log('          频次：', cnt.join(', '), '| 期望：', N / m);
  check('拒绝采样均匀性 (0..6)', chiSquare(cnt, N / m), m - 1);
}

/* ------------------------------------------------------------------ 检验 5 */
{
  console.log('\n— 检验 5：种子可复现性与防篡改（公平性可核验的前提）');
  const pool = Array.from({ length: 30 }, (_, i) => i + 1);
  const seed = new Uint32Array([0x1a2b3c4d, 0xdeadbeef, 0x0f0f0f0f, 0x12345678]);
  const hex = FR.makeSeededRandInt(seed).seedHex;
  const a = FR.sampleWithoutReplacement(pool, 6, FR.makeSeededRandInt(FR.seedHexToU32(hex)));
  const b = FR.sampleWithoutReplacement(pool, 6, FR.makeSeededRandInt(FR.seedHexToU32(hex)));
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) failures++;
  console.log(`${same ? '✅ PASS' : '❌ FAIL'}  同种子两次抽样结果完全一致：${a.selected.join('、')}`);

  const rec = {
    seed: hex, poolBefore: pool, selected: a.selected, poolAfter: a.pool
  };
  const okVerify = FR.verifyRecord(rec);
  if (!okVerify) failures++;
  console.log(`${okVerify ? '✅ PASS' : '❌ FAIL'}  verifyRecord 认可未被篡改的记录`);

  const tampered = { ...rec, selected: [...rec.selected.slice(0, -1), 999] };
  const okTamper = FR.verifyRecord(tampered) === false;
  if (!okTamper) failures++;
  console.log(`${okTamper ? '✅ PASS' : '❌ FAIL'}  verifyRecord 能识别被篡改的记录`);

  // 不同种子的抽样分布应独立
  const distinct = new Set();
  for (let i = 0; i < 200; i++) {
    const r = FR.newSeededRandInt();
    distinct.add(FR.sampleWithoutReplacement(pool, 1, r).selected[0] + '|' + r.seedHex);
  }
  const okDistinct = distinct.size === 200;
  if (!okDistinct) failures++;
  console.log(`${okDistinct ? '✅ PASS' : '❌ FAIL'}  200 次独立抽号生成互不相同的种子与结果`);
}

console.log('\n' + '='.repeat(64));
console.log(failures === 0
  ? '全部检验通过：抽样核心在统计意义上公平，且结果可被种子复算核验。'
  : `有 ${failures} 项检验失败，请检查 random.js。`);
process.exit(failures === 0 ? 0 : 1);
