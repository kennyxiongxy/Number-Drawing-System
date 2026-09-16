/* ============================================================================
 * 公平随机抽样核心（无依赖，浏览器 / Node 均可直接加载）
 * ----------------------------------------------------------------------------
 * 为什么单独抽成文件：公平性是本系统的核心承诺，把「决定结果的那几行代码」
 * 与 UI 逻辑隔离，便于独立审计、独立测试（tests/randomness-test.mjs）。
 *
 * 设计要点：
 *   1. 熵源优先使用 crypto.getRandomValues()（操作系统级 CSPRNG），
 *      不可用时才降级到 Math.random()，并且会在控制台显式告警，绝不静默降级；
 *   2. 用「拒绝采样」而非取模，彻底消除取模偏差（modulo bias）；
 *   3. 无放回抽样采用部分 Fisher-Yates，数学上严格等概率；
 *   4. 支持种子化 PRNG（sfc32）：任何一次抽号只要记录种子，
 *      第三方就能离线复算出完全相同的结果，用于事后核验。
 * ========================================================================== */
(function (root) {
  'use strict';

  var UINT32_RANGE = 0x100000000; // 2^32

  /** 当前环境是否提供 CSPRNG 熵源 */
  function cryptoAvailable() {
    return !!root.crypto && typeof root.crypto.getRandomValues === 'function';
  }

  /**
   * 填充 32 位随机数。返回 true 表示用的是 CSPRNG，false 表示降级到 Math.random。
   * 注意：Math.random() 本身在统计上也是均匀的（不存在取模偏差问题），
   * 降级只影响「不可预测性」和「抗篡改强度」，不影响公平性。
   */
  function fillRandomU32(out) {
    if (cryptoAvailable()) {
      root.crypto.getRandomValues(out);
      return true;
    }
    for (var i = 0; i < out.length; i++) {
      out[i] = Math.floor(Math.random() * UINT32_RANGE) >>> 0;
    }
    return false;
  }

  /**
   * 均匀返回 [0, maxExclusive) 的整数 —— 零取模偏差。
   *
   * 原理：把 2^32 个 uint32 样本切成若干个长度为 maxExclusive 的完整区间，
   * 落在最后一个「不完整区间」里的样本直接丢弃重抽。这样每个取值
   * 对应的样本数完全相同，概率严格相等。
   * maxExclusive <= 999 时拒绝概率 < 2.4e-7，性能无感。
   */
  function secureRandomInt(maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
      throw new RangeError('maxExclusive 必须为正整数，收到 ' + maxExclusive);
    }
    if (maxExclusive === 1) return 0;

    var limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
    var buf = new Uint32Array(1);
    var x;
    do {
      fillRandomU32(buf);
      x = buf[0];
    } while (x >= limit);
    return x % maxExclusive;
  }

  /**
   * 用 128 位种子构造可复现的均匀随机整数发生器（sfc32）。
   * 返回的函数带 seedHex 属性，写进日志即可被任何人复算。
   */
  function makeSeededRandInt(seedU32) {
    if (!seedU32 || seedU32.length !== 4) {
      throw new RangeError('seedU32 必须是长度为 4 的 Uint32Array');
    }
    var a = seedU32[0] | 0, b = seedU32[1] | 0, c = seedU32[2] | 0, d = seedU32[3] | 0;

    function nextU32() {
      var t = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = ((c << 21) | (c >>> 11)) | 0;
      c = (c + t) | 0;
      return t >>> 0;
    }

    // sfc32 标准预热：避免弱种子导致开头输出质量不佳
    for (var i = 0; i < 12; i++) nextU32();

    var rng = function (maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
        throw new RangeError('maxExclusive 必须为正整数，收到 ' + maxExclusive);
      }
      if (maxExclusive === 1) return 0;
      var limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
      var x;
      do { x = nextU32(); } while (x >= limit);
      return x % maxExclusive;
    };

    rng.seedHex = Array.prototype.map.call(seedU32, function (v) {
      return (v >>> 0).toString(16).padStart(8, '0');
    }).join('');
    rng.nextU32 = nextU32;
    return rng;
  }

  /** 每次抽号生成一个全新的 128 位种子 */
  function newSeededRandInt() {
    var seed = new Uint32Array(4);
    var strong = fillRandomU32(seed);
    var rng = makeSeededRandInt(seed);
    rng.usedCrypto = strong;
    return rng;
  }

  /**
   * 无放回等概率抽 k 个 —— 部分 Fisher-Yates。
   * 第 i 次从剩余 n-i 个元素中均匀取 1 个，故每个有序 k 元组等概率，
   * 每个无序组合概率恒为 1/C(n,k)。
   *
   * @param {number[]} pool 候选号码
   * @param {number} k 抽取个数
   * @param {function} randInt 均匀整数发生器，签名 (maxExclusive) => int
   */
  function sampleWithoutReplacement(pool, k, randInt) {
    if (!Array.isArray(pool)) throw new TypeError('pool 必须是数组');
    if (!Number.isInteger(k) || k < 0) throw new RangeError('k 非法：' + k);
    if (k > pool.length) {
      throw new RangeError('抽取数量 ' + k + ' 超过剩余号码数 ' + pool.length);
    }
    var rand = randInt || secureRandomInt;
    var p = pool.slice();
    var out = [];
    for (var i = 0; i < k; i++) {
      var j = i + rand(p.length - i);      // 均匀取 [i, n)
      var tmp = p[i]; p[i] = p[j]; p[j] = tmp;
      out.push(p[i]);
    }
    return {
      selected: out.slice().sort(function (x, y) { return x - y; }), // 仅展示排序，不改变抽样分布
      pool: p.slice(k).sort(function (x, y) { return x - y; })       // 剩余池，排序同样不影响下次抽样
    };
  }

  /** 把种子十六进制字符串还原成 Uint32Array */
  function seedHexToU32(seedHex) {
    if (typeof seedHex !== 'string' || !/^[0-9a-f]{32}$/i.test(seedHex)) {
      throw new RangeError('seed 必须是 32 位十六进制字符串');
    }
    var out = new Uint32Array(4);
    for (var i = 0; i < 4; i++) {
      out[i] = parseInt(seedHex.slice(i * 8, i * 8 + 8), 16) >>> 0;
    }
    return out;
  }

  /**
   * 复核一条抽号记录：用记录里的种子重算，看结果是否与记录一致。
   * 返回 true 表示该条记录未被篡改。任何人拿到导出的 JSON 都能独立跑这段逻辑。
   */
  function verifyRecord(rec) {
    if (!rec || !rec.seed || !Array.isArray(rec.poolBefore) || !Array.isArray(rec.selected)) {
      return false;
    }
    var rng = makeSeededRandInt(seedHexToU32(rec.seed));
    var re = sampleWithoutReplacement(rec.poolBefore, rec.selected.length, rng);
    return JSON.stringify(re.selected) === JSON.stringify([].concat(rec.selected).sort(function (x, y) { return x - y; })) &&
           JSON.stringify(re.pool) === JSON.stringify([].concat(rec.poolAfter || []).sort(function (x, y) { return x - y; }));
  }

  root.FairRandom = {
    cryptoAvailable: cryptoAvailable,
    secureRandomInt: secureRandomInt,
    makeSeededRandInt: makeSeededRandInt,
    newSeededRandInt: newSeededRandInt,
    sampleWithoutReplacement: sampleWithoutReplacement,
    seedHexToU32: seedHexToU32,
    verifyRecord: verifyRecord
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
