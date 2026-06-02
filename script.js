/* =========================================================
   公交地铁换乘规划算法 · 可视化讲解
   零依赖纯前端。一张小地铁网 + 时刻表，逐步演示四种业界常用算法：
     1) 时间依赖 Dijkstra（经典基线）
     2) RAPTOR（轮次法 · 业界最常用）
     3) CSA 连接扫描
     4) Transfer Patterns 换乘模式（预计算加速 · 概念演示）

   核心架构：每个算法跑一遍并“录制”成一串 step 快照，
   播放器只负责把 step 一帧帧渲染到 SVG 地图上。
   ========================================================= */

/* ---------------- 1. 网络数据 ---------------- */
// 站点坐标（SVG 视口 740 x 460）
const STOPS = {
  A: { name: 'A 站', x:  70, y: 130 },
  B: { name: 'B 站', x: 250, y: 130 },
  C: { name: 'C 站', x: 470, y: 130 },
  D: { name: 'D 站', x: 670, y: 130 },
  E: { name: 'E 站', x:  70, y: 330 },
  F: { name: 'F 站', x: 250, y: 330 },
  G: { name: 'G 站', x: 470, y: 330 },
  H: { name: 'H 站', x: 670, y: 330 },
};

// 线路与时刻表。trips 里每个数组是一趟车在各站的“离站时刻”（单位：分钟，0 = 08:00）
const LINES = {
  red:   { name: '1号线', color: '#e8443c', stops: ['A','B','C','D'],
           trips: [[0,5,10,15], [6,11,16,21], [12,17,22,27]] },
  blue:  { name: '2号线', color: '#2f6df6', stops: ['E','F','G','H'],
           trips: [[2,6,10,14], [8,12,16,20], [14,18,22,26]] },
  green: { name: '3号线', color: '#19a974', stops: ['B','F'],
           trips: [[3,8], [11,16], [19,24]] },
};

// 步行换乘（站内通道），双向。min = 步行分钟数
const FOOTPATHS = [ { a: 'C', b: 'G', min: 5 } ];

/* ---------------- 2. 派生结构 ---------------- */
// 每个站属于哪些线路（用于“在这站能坐哪些车”）
const stopLines = {};
Object.keys(STOPS).forEach(s => stopLines[s] = []);
Object.entries(LINES).forEach(([key, L]) => {
  L.stops.forEach((s, i) => stopLines[s].push({ line: key, idx: i }));
});

// 步行邻接表
const footAdj = {};
Object.keys(STOPS).forEach(s => footAdj[s] = []);
FOOTPATHS.forEach(f => {
  footAdj[f.a].push({ to: f.b, min: f.min });
  footAdj[f.b].push({ to: f.a, min: f.min });
});

// 连接（区段）列表：每趟车相邻两站构成一个 connection，CSA 用
const CONNECTIONS = [];
Object.entries(LINES).forEach(([key, L]) => {
  L.trips.forEach((trip, t) => {
    for (let i = 0; i < L.stops.length - 1; i++) {
      CONNECTIONS.push({
        line: key, trip: t,
        from: L.stops[i], to: L.stops[i + 1],
        dep: trip[i], arr: trip[i + 1],
      });
    }
  });
});
CONNECTIONS.sort((a, b) => a.dep - b.dep || a.arr - b.arr);

/* ---------------- 3. 小工具 ---------------- */
const INF = Infinity;
function fmt(m) {
  if (m == null || m === INF) return '—';
  const total = 8 * 60 + m;
  const hh = Math.floor(total / 60), mm = total % 60;
  return hh + ':' + String(mm).padStart(2, '0');
}
function lineTag(key) {
  const L = LINES[key];
  return `<b style="color:${L.color}">${L.name}</b>`;
}
function emptyArr() { const a = {}; Object.keys(STOPS).forEach(s => a[s] = INF); return a; }
function cloneArr(a) { return Object.assign({}, a); }

// 找某线某站之后、发车时刻 >= time 的最早一趟
function earliestTrip(lineKey, stopIdx, time) {
  const L = LINES[lineKey];
  let best = -1, bestDep = INF;
  for (let t = 0; t < L.trips.length; t++) {
    const dep = L.trips[t][stopIdx];
    if (dep >= time && dep < bestDep) { bestDep = dep; best = t; }
  }
  return best < 0 ? null : { trip: best, dep: bestDep };
}

// 从 legs/parent 重建行程站序（从终点回溯到起点）
function rebuildPath(parent, src, dst) {
  if (!parent[dst]) return null;
  const chain = [];
  let cur = dst;
  let guard = 0;
  while (cur && cur !== src && guard++ < 50) {
    const p = parent[cur];
    if (!p) return null;
    chain.push({ from: p.from, to: cur, mode: p.mode, line: p.line, dep: p.dep, arr: p.arr });
    cur = p.from;
  }
  chain.reverse();
  return chain;
}

/* ---------------- 4. 算法：录制成 steps ---------------- */
/* 每个 step 形如：
   { round, ptr, active, edge, arr:{}, narr, result }
   arr：当前各站“最早到达时刻”快照
   active：当前高亮的站
   edge：当前高亮的一条边 {from,to,mode,line}
   ptr：CSA 指针下标（其它算法为 null）
   result：完成时给 {arr, legs}
*/

// ===== 4.1 时间依赖 Dijkstra =====
function buildDijkstra(src, dst, t0) {
  const steps = [];
  const arr = emptyArr(); arr[src] = t0;
  const parent = {};
  const done = {};
  const pushStep = (o) => steps.push(Object.assign({ ptr: null, active: null, edge: null,
    arr: cloneArr(arr), result: null, round: 'Dijkstra' }, o));

  pushStep({ active: src,
    narr: `起点 <b>${STOPS[src].name}</b> 的最早到达时刻 = 出发时刻 <code>${fmt(t0)}</code>。其余站先记为「还到不了」。每一步都挑出<b>目前最早能到</b>的站，从它往外更新邻居——这就是 Dijkstra。` });

  while (true) {
    // 找未处理中 arr 最小的站
    let u = null, best = INF;
    Object.keys(STOPS).forEach(s => { if (!done[s] && arr[s] < best) { best = arr[s]; u = s; } });
    if (u == null) break;
    done[u] = true;

    if (u === dst) {
      pushStep({ active: u,
        narr: `弹出 <b>${STOPS[u].name}</b>（${fmt(arr[u])}），它就是<span class="ok">终点</span>！由于 Dijkstra 总是先弹出最早到达的站，<b>第一次弹出终点时一定是最优解</b>，可以收工。` });
      break;
    }

    let detail = `弹出当前最早能到的站 <b>${STOPS[u].name}</b>（${fmt(arr[u])}），看从这里出发能改进谁：`;
    let improvedAny = false;

    // 坐车：该站所在每条线、且不是终点站
    stopLines[u].forEach(({ line, idx }) => {
      if (idx >= LINES[line].stops.length - 1) return;
      const et = earliestTrip(line, idx, arr[u]);
      if (!et) return;
      const nextStop = LINES[line].stops[idx + 1];
      const reachT = LINES[line].trips[et.trip][idx + 1];
      if (reachT < arr[nextStop]) {
        arr[nextStop] = reachT; parent[nextStop] = { from: u, mode: 'ride', line, dep: et.dep, arr: reachT };
        improvedAny = true;
        steps.push({ ptr: null, active: u, edge: { from: u, to: nextStop, mode: 'ride', line },
          arr: cloneArr(arr), result: null, round: 'Dijkstra',
          narr: `${detail}<br>· 坐 ${lineTag(line)}：在 ${fmt(arr[u])} 到站，最早能赶上 <code>${fmt(et.dep)}</code> 发车那班，<b>${fmt(reachT)}</b> 到 <b>${STOPS[nextStop].name}</b>，刷新它的最早到达。` });
        detail = `继续从 <b>${STOPS[u].name}</b> 看其它方向：`;
      }
    });

    // 步行
    footAdj[u].forEach(({ to, min }) => {
      const cand = arr[u] + min;
      if (cand < arr[to]) {
        arr[to] = cand; parent[to] = { from: u, mode: 'walk', line: null, dep: arr[u], arr: cand };
        improvedAny = true;
        steps.push({ ptr: null, active: u, edge: { from: u, to, mode: 'walk', line: null },
          arr: cloneArr(arr), result: null, round: 'Dijkstra',
          narr: `${detail}<br>· 步行换乘到 <b>${STOPS[to].name}</b>：${fmt(arr[u])} + ${min} 分钟 = <b>${fmt(cand)}</b>，刷新它的最早到达。` });
        detail = `继续从 <b>${STOPS[u].name}</b> 看其它方向：`;
      }
    });

    if (!improvedAny) {
      pushStep({ active: u, narr: `${detail}<br>从 <b>${STOPS[u].name}</b> 出发改进不了任何站（要么没车，要么别人已经更快到了），跳过。` });
    }
  }

  const legs = rebuildPath(parent, src, dst);
  steps.push({ ptr: null, active: dst, edge: null, arr: cloneArr(arr), round: '完成',
    result: { arr: arr[dst], legs }, narr: finishNarr(src, dst, arr[dst], legs) });
  return steps;
}

// ===== 4.2 RAPTOR =====
function buildRaptor(src, dst, t0) {
  const steps = [];
  const arr = emptyArr(); arr[src] = t0;          // 全局最优（任意换乘次数）
  const parent = {};
  const pushStep = (o) => steps.push(Object.assign({ ptr: null, active: null, edge: null,
    arr: cloneArr(arr), result: null, round: 'RAPTOR' }, o));

  pushStep({ active: src, round: '准备',
    narr: `RAPTOR 按<b>轮次</b>算：第 <b>k</b> 轮 = 「最多坐 k 趟车」能到达的最早时刻。先把起点 <b>${STOPS[src].name}</b> 标记为 <code>${fmt(t0)}</code>，作为第 0 轮的成果。` });

  let marked = new Set([src]);
  // 第 0 轮还要把“从起点步行可达”的站也算上（比如出发就在换乘通道边）
  footAdj[src].forEach(({ to, min }) => {
    const cand = t0 + min;
    if (cand < arr[to]) {
      arr[to] = cand; parent[to] = { from: src, mode: 'walk', line: null, dep: t0, arr: cand };
      marked.add(to);
      steps.push({ ptr: null, active: to, edge: { from: src, to, mode: 'walk', line: null },
        arr: cloneArr(arr), result: null, round: '第 0 轮 · 步行',
        narr: `出发点还能<b>步行</b>直达 <b>${STOPS[to].name}</b>：${fmt(t0)} + ${min} 分钟 = <b>${fmt(cand)}</b>。它也作为第 0 轮成果，下一轮可以从这儿坐车。` });
    }
  });
  const K = 5;

  for (let k = 1; k <= K; k++) {
    if (marked.size === 0) break;
    const prevArr = cloneArr(arr);   // 上一轮结束时的到达时刻
    const improvedThisRound = new Set();

    pushStep({ active: null, round: `第 ${k} 轮 · 坐第 ${k} 趟车`,
      narr: `<b>第 ${k} 轮开始。</b> 上一轮新到达的站是 <b>${[...marked].map(s => STOPS[s].name).join('、')}</b>。本轮我们站在这些站上，去坐<b>经过它们的每条线路</b>，看能不能更早地到达下游各站。` });

    // 找出所有“经过 marked 站”的线路
    const routesToScan = new Set();
    marked.forEach(s => stopLines[s].forEach(({ line }) => routesToScan.add(line)));

    routesToScan.forEach(line => {
      const L = LINES[line];
      // 找本线最早一个 marked 站，从它开始“上车”
      let boardIdx = -1;
      for (let i = 0; i < L.stops.length; i++) {
        if (marked.has(L.stops[i])) { boardIdx = i; break; }
      }
      if (boardIdx < 0 || boardIdx >= L.stops.length - 1) return;

      // 从 boardIdx 上车那班（按上一轮到该站的时刻能赶上的最早车）
      const et = earliestTrip(line, boardIdx, prevArr[L.stops[boardIdx]]);
      if (!et) {
        pushStep({ active: L.stops[boardIdx], round: `第 ${k} 轮`,
          narr: `在 <b>${STOPS[L.stops[boardIdx]].name}</b> 想坐 ${lineTag(line)}，但 ${fmt(prevArr[L.stops[boardIdx]])} 之后没有可坐的车了，跳过。` });
        return;
      }
      let curTrip = et.trip;
      let log = `沿 ${lineTag(line)} 扫描：在 <b>${STOPS[L.stops[boardIdx]].name}</b> 赶上 <code>${fmt(et.dep)}</code> 发车那班。`;
      let touched = false;

      for (let i = boardIdx + 1; i < L.stops.length; i++) {
        const stop = L.stops[i];
        const reachT = L.trips[curTrip][i];
        // 用全局最优 + 终点剪枝
        if (reachT < Math.min(arr[stop], arr[dst])) {
          arr[stop] = reachT;
          parent[stop] = { from: L.stops[boardIdx], mode: 'ride', line, dep: et.dep, arr: reachT, multi: true };
          improvedThisRound.add(stop);
          touched = true;
          log += `<br>· <b>${fmt(reachT)}</b> 到 <b>${STOPS[stop].name}</b>，比以前更早 → 刷新。`;
          steps.push({ ptr: null, active: stop, edge: { from: L.stops[boardIdx], to: stop, mode: 'ride', line },
            arr: cloneArr(arr), result: null, round: `第 ${k} 轮`, narr: log });
        }
        // 若在该站，上一轮其实能更早到（可换乘更早的车），则改坐更早班次
        const better = earliestTrip(line, i, prevArr[stop]);
        if (better && better.dep < L.trips[curTrip][i]) {
          curTrip = better.trip;
        }
      }
      if (!touched) {
        pushStep({ active: L.stops[boardIdx], round: `第 ${k} 轮`,
          narr: `${log}<br>这条线沿途各站，都没能比已知更早到达，<span class="skip">没有刷新</span>。` });
      }
    });

    // 步行换乘（同轮内）
    const rideImproved = [...improvedThisRound];
    rideImproved.forEach(s => {
      footAdj[s].forEach(({ to, min }) => {
        const cand = arr[s] + min;
        if (cand < Math.min(arr[to], arr[dst])) {
          arr[to] = cand; parent[to] = { from: s, mode: 'walk', line: null, dep: arr[s], arr: cand };
          improvedThisRound.add(to);
          steps.push({ ptr: null, active: to, edge: { from: s, to, mode: 'walk', line: null },
            arr: cloneArr(arr), result: null, round: `第 ${k} 轮 · 步行`,
            narr: `本轮坐车后，再考虑<b>步行换乘</b>：从 <b>${STOPS[s].name}</b>（${fmt(arr[s])}）走 ${min} 分钟到 <b>${STOPS[to].name}</b> = <b>${fmt(cand)}</b>，刷新。步行不算“坐车”，所以仍属第 ${k} 轮。` });
        }
      });
    });

    marked = improvedThisRound;
    if (marked.size === 0) {
      pushStep({ active: null, round: `第 ${k} 轮 · 结束`,
        narr: `第 ${k} 轮没有任何站被刷新 → 再多换乘也不会更快了，<b>提前收敛</b>，结束。` });
      break;
    } else {
      const got = arr[dst] !== INF ? `目前到 <b>${STOPS[dst].name}</b> 最早 <span class="ok">${fmt(arr[dst])}</span>（最多 ${k} 趟车）。` : `终点还没到达。`;
      pushStep({ active: null, round: `第 ${k} 轮 · 小结`,
        narr: `第 ${k} 轮刷新了：<b>${[...marked].map(s => STOPS[s].name).join('、')}</b>。${got} 进入下一轮看“再多换一次”能不能更快。` });
    }
  }

  const legs = rebuildPath(parent, src, dst);
  steps.push({ ptr: null, active: dst, edge: null, arr: cloneArr(arr), round: '完成',
    result: { arr: arr[dst], legs }, narr: finishNarr(src, dst, arr[dst], legs) });
  return steps;
}

// ===== 4.3 CSA 连接扫描 =====
function buildCSA(src, dst, t0) {
  const steps = [];
  const arr = emptyArr(); arr[src] = t0;
  const parent = {};
  const tripBoarded = {};          // 这趟车是否已经上了
  const tripBoardFrom = {};        // 上车站，用于回溯

  const pushStep = (o) => steps.push(Object.assign({ ptr: null, active: null, edge: null,
    arr: cloneArr(arr), result: null, round: 'CSA' }, o));

  // 起点的步行可达站，先初始化（journey 可能一上来就要走一段通道）
  footAdj[src].forEach(({ to, min }) => {
    const cand = t0 + min;
    if (cand < arr[to]) { arr[to] = cand; parent[to] = { from: src, mode: 'walk', line: null, dep: t0, arr: cand }; }
  });

  pushStep({ active: src, ptr: -1,
    narr: `CSA 把<b>所有区段</b>（一趟车相邻两站之间）按<b>发车时刻</b>排成一长队（见下方扫描条）。指针从左到右扫一遍，对每个区段只问一句：<b>我赶得上吗？</b> 起点 <b>${STOPS[src].name}</b> 记为 <code>${fmt(t0)}</code>（含从起点步行可达的站）。` });

  for (let i = 0; i < CONNECTIONS.length; i++) {
    const c = CONNECTIONS[i];
    const tripKey = c.line + '#' + c.trip;
    const canByBoard = tripBoarded[tripKey];                 // 这趟车之前已上
    const canByCatch = arr[c.from] !== INF && arr[c.from] <= c.dep; // 能在发车前赶到
    // 终点剪枝
    if (arr[dst] !== INF && c.dep > arr[dst]) {
      pushStep({ active: dst, ptr: i,
        narr: `指针走到发车时刻 <code>${fmt(c.dep)}</code> 的区段，已经<b>晚于</b>终点的到达时刻 <span class="ok">${fmt(arr[dst])}</span>。后面的车只会更晚发，不可能更优 → <b>提前停止</b>。` });
      break;
    }

    if (canByBoard || canByCatch) {
      if (!tripBoarded[tripKey]) { tripBoarded[tripKey] = true; tripBoardFrom[tripKey] = { from: c.from, dep: c.dep }; }
      const reason = canByBoard
        ? `已经在这趟 ${lineTag(c.line)} 上（之前上的车，继续坐）`
        : `${fmt(arr[c.from])} 已到 <b>${STOPS[c.from].name}</b>，赶得上 <code>${fmt(c.dep)}</code> 发车`;
      if (c.arr < arr[c.to]) {
        arr[c.to] = c.arr;
        const bf = tripBoardFrom[tripKey];
        parent[c.to] = { from: bf.from, mode: 'ride', line: c.line, dep: bf.dep, arr: c.arr };
        // 步行连带更新
        let walkLog = '';
        footAdj[c.to].forEach(({ to, min }) => {
          const cand = c.arr + min;
          if (cand < arr[to]) {
            arr[to] = cand; parent[to] = { from: c.to, mode: 'walk', line: null, dep: c.arr, arr: cand };
            walkLog += `<br>· 顺带步行到 <b>${STOPS[to].name}</b> = <b>${fmt(cand)}</b>，也刷新。`;
          }
        });
        pushStep({ active: c.to, ptr: i, edge: { from: c.from, to: c.to, mode: 'ride', line: c.line },
          narr: `区段 <b>${STOPS[c.from].name}→${STOPS[c.to].name}</b>（${fmt(c.dep)}→${fmt(c.arr)}）：${reason}。<b>${fmt(c.arr)}</b> 到 <b>${STOPS[c.to].name}</b>，比以前早 → <span class="ok">刷新</span>。${walkLog}`, used: true });
      } else {
        pushStep({ active: c.from, ptr: i, edge: { from: c.from, to: c.to, mode: 'ride', line: c.line },
          narr: `区段 <b>${STOPS[c.from].name}→${STOPS[c.to].name}</b>（${fmt(c.dep)}→${fmt(c.arr)}）：${reason}，但 <b>${STOPS[c.to].name}</b> 已经能更早到（${fmt(arr[c.to])}），不刷新。` });
      }
    } else {
      pushStep({ active: c.from, ptr: i,
        narr: `区段 <b>${STOPS[c.from].name}→${STOPS[c.to].name}</b>（发车 ${fmt(c.dep)}）：${arr[c.from] === INF ? `还到不了 <b>${STOPS[c.from].name}</b>` : `${fmt(arr[c.from])} 才到 ${STOPS[c.from].name}，赶不上 ${fmt(c.dep)} 的车`}，<span class="skip">跳过</span>。` });
    }
  }

  const legs = rebuildPath(parent, src, dst);
  steps.push({ ptr: CONNECTIONS.length, active: dst, edge: null, arr: cloneArr(arr), round: '完成',
    result: { arr: arr[dst], legs }, narr: finishNarr(src, dst, arr[dst], legs) });
  return steps;
}

// ===== 4.4 Transfer Patterns（概念演示，复用最优结果） =====
function buildTransferPatterns(src, dst, t0) {
  // 先用 Dijkstra 求真实最优，拿到换乘骨架
  const base = buildDijkstra(src, dst, t0);
  const final = base[base.length - 1];
  const legs = final.result.legs;
  const arr = emptyArr(); arr[src] = t0;
  const steps = [];
  const pushStep = (o) => steps.push(Object.assign({ ptr: null, active: null, edge: null,
    arr: cloneArr(arr), result: null, round: 'Transfer Patterns' }, o));

  if (!legs) {
    pushStep({ active: src, round: '① 离线预计算',
      narr: `预计算阶段会为「每个站 → 每个站」存一份最优换乘骨架。但在这张小网里，<b>${STOPS[src].name} → ${STOPS[dst].name}</b> 没有可行路线（线路是单向的），所以这一对查不到骨架。换个起终点试试。` });
    steps.push({ ptr: null, active: dst, edge: null, arr: cloneArr(arr), round: '完成',
      result: { arr: INF, legs: null }, narr: finishNarr(src, dst, INF, null) });
    return steps;
  }

  pushStep({ active: null, round: '① 离线预计算（提前几小时算好）',
    narr: `谷歌地图级别的城市，实时跑 RAPTOR/CSA 仍可能不够快。Transfer Patterns 的思路：<b>提前</b>把「每个站到每个站」的<b>最优换乘骨架</b>都算出来存好。骨架只记<b>坐哪几条线、在哪几站换</b>，不含具体时刻。` });

  // 骨架描述
  const skeleton = legs.map(l => l.mode === 'walk'
    ? `步行(${STOPS[l.from].name}→${STOPS[l.to].name})`
    : `${LINES[l.line].name}`);
  const dedupSkeleton = skeleton.filter((s, i) => i === 0 || s !== skeleton[i - 1]);

  pushStep({ active: src, round: '② 查询：直接查表',
    narr: `用户输入「<b>${STOPS[src].name} → ${STOPS[dst].name}</b>」。系统<b>不再搜索</b>，而是直接查出预存的换乘骨架：<br><span class="pill">${dedupSkeleton.join('</span> → <span class="pill">')}</span>` });

  // 沿骨架把时刻填进去（逐腿动画）
  let t = t0;
  let prevStop = src;
  legs.forEach((l) => {
    if (l.mode === 'walk') {
      arr[l.to] = l.arr;
      pushStep({ active: l.to, edge: { from: l.from, to: l.to, mode: 'walk', line: null }, round: '③ 填入时刻',
        narr: `骨架第 ⟶ 步是<b>步行换乘</b>：${STOPS[l.from].name}（${fmt(l.dep)}）走到 ${STOPS[l.to].name} = <b>${fmt(l.arr)}</b>。` });
    } else {
      arr[l.to] = l.arr;
      pushStep({ active: l.to, edge: { from: l.from, to: l.to, mode: 'ride', line: l.line }, round: '③ 填入时刻',
        narr: `骨架里这一段坐 ${lineTag(l.line)}：从 ${STOPS[l.from].name} 上车，查实时时刻表赶最早一班，<b>${fmt(l.arr)}</b> 到 ${STOPS[l.to].name}。只需在<b>这几条线</b>上查时刻，范围极小，所以毫秒级出结果。` });
    }
    prevStop = l.to;
  });

  // 完整重建（沿骨架）
  const fullLegs = legs;
  steps.push({ ptr: null, active: dst, edge: null, arr: cloneArr(arr), round: '完成',
    result: { arr: arr[dst], legs: fullLegs },
    narr: finishNarr(src, dst, arr[dst], fullLegs) + `<br><b>关键点：</b>答案和 Dijkstra/RAPTOR 完全一致，但查询时几乎没做搜索——<b>用离线空间换在线时间</b>。` });
  return steps;
}

// 收尾解说（所有算法共用）
function finishNarr(src, dst, arrT, legs) {
  if (arrT === INF || !legs) {
    return `搜索结束：从 <b>${STOPS[src].name}</b> 到 <b>${STOPS[dst].name}</b> <span class="skip">没有可行的换乘路线</span>（在这张小网里）。换个起终点试试。`;
  }
  const transfers = countTransfers(legs);
  const parts = describeLegs(legs);
  return `<span class="ok">搞定！</span> 从 <b>${STOPS[src].name}</b> 到 <b>${STOPS[dst].name}</b> 最早 <b>${fmt(arrT)}</b> 到达，换乘 <b>${transfers}</b> 次：<br>${parts}`;
}
function countTransfers(legs) {
  // 相邻的“坐车腿”如果换了线就算一次换乘；步行也算一次衔接
  let lastLine = null, t = 0;
  legs.forEach(l => {
    if (l.mode === 'ride') {
      if (lastLine !== null && lastLine !== l.line) t++;
      lastLine = l.line;
    } else { // walk
      if (lastLine !== null) t++;
      lastLine = null;
    }
  });
  return t;
}
function describeLegs(legs) {
  // 把连续同线的坐车腿合并显示
  const merged = [];
  legs.forEach(l => {
    const last = merged[merged.length - 1];
    if (l.mode === 'ride' && last && last.mode === 'ride' && last.line === l.line) {
      last.to = l.to; last.arr = l.arr;
    } else {
      merged.push(Object.assign({}, l));
    }
  });
  return merged.map(l => l.mode === 'walk'
    ? `&nbsp;&nbsp;🚶 步行 ${STOPS[l.from].name} → ${STOPS[l.to].name}（${fmt(l.dep)}→${fmt(l.arr)}）`
    : `&nbsp;&nbsp;🚇 ${lineTag(l.line)} ${STOPS[l.from].name} → ${STOPS[l.to].name}（${fmt(l.dep)}→${fmt(l.arr)}）`
  ).join('<br>');
}

/* ---------------- 5. 算法元信息 + 讲解文案 ---------------- */
const ALGOS = {
  dijkstra: {
    name: '时间依赖 Dijkstra', tag: '经典基线', build: buildDijkstra, strip: false,
    explain: `
      <p>把整张地铁网当成一张「<b>带时刻表的图</b>」：站是点，坐一段车 / 走一段路是边，边的代价是<b>到达时刻</b>（含等车时间）。</p>
      <h4>它怎么想？</h4>
      <ol>
        <li>起点到达时刻 = 出发时刻，其它站 = ∞。</li>
        <li>每次挑出<b>当前最早能到</b>的站，处理它。</li>
        <li>从这站坐各条线 / 走通道，<b>刷新</b>邻居更早的到达时刻。</li>
        <li>第一次弹出终点时，结果一定最优。</li>
      </ol>
      <p>优点：直观、保证最优。缺点：站一多、优先队列频繁进出，<b>较慢</b>，也不直接告诉你「换乘几次」。</p>`,
  },
  raptor: {
    name: 'RAPTOR', tag: '业界最常用', build: buildRaptor, strip: false,
    explain: `
      <p>RAPTOR = Round-Based Public Transit Router。<b>不用优先队列</b>，按「<b>换乘次数</b>」一轮轮算。</p>
      <h4>它怎么想？</h4>
      <ol>
        <li><b>第 0 轮：</b>只有起点，时刻 = 出发时刻。</li>
        <li><b>第 k 轮：</b>站在「上一轮新到达的站」上，去坐<b>经过它们的每条线</b>，一路刷新下游各站的最早到达。</li>
        <li>坐完车再加一遍<b>步行换乘</b>。</li>
        <li>某轮没刷新任何站 → 收敛结束。</li>
      </ol>
      <p>第 k 轮的结果天然就是「<b>最多坐 k 趟车</b>的最优解」，所以它<b>同时</b>给出「最快」和「换乘最少」的多个方案。对缓存友好、易并行，是 12306、各大地图后端的主力。</p>`,
  },
  csa: {
    name: 'CSA 连接扫描', tag: '极简极快', build: buildCSA, strip: true,
    explain: `
      <p>CSA = Connection Scan Algorithm。把<b>所有区段</b>（一趟车相邻两站）按<b>发车时刻</b>排成一个大数组。</p>
      <h4>它怎么想？</h4>
      <ol>
        <li>起点到达时刻 = 出发时刻。</li>
        <li>指针从头到尾<b>扫一遍</b>数组。</li>
        <li>每个区段只问：<b>我赶得上这班车吗？</b>（已在车上，或在它发车前已到出发站）赶得上就更新到达站。</li>
        <li>一旦扫到的发车时刻晚于终点已知到达，<b>提前停止</b>。</li>
      </ol>
      <p>核心循环就是一层 for + 几个比较，<b>没有优先队列</b>，顺序访问内存、对 CPU 缓存极友好，实现只有几十行。下方<b>扫描条</b>会显示指针怎么走。</p>`,
  },
  tp: {
    name: 'Transfer Patterns', tag: '谷歌地图同款', build: buildTransferPatterns, strip: false,
    explain: `
      <p>城市超大、查询超多时，连 RAPTOR 都嫌慢。Transfer Patterns 用「<b>空间换时间</b>」。</p>
      <h4>它怎么想？</h4>
      <ol>
        <li><b>离线预计算：</b>提前把「每个站 → 每个站」的<b>最优换乘骨架</b>（坐哪几条线、在哪换）都算好存起来。</li>
        <li><b>在线查询：</b>用户一查，直接<b>取出骨架</b>，不再全网搜索。</li>
        <li>只在骨架涉及的<b>少数几条线</b>上查实时时刻、填入具体班次。</li>
      </ol>
      <p>查询从「搜索几十万班次」缩小到「查表 + 填几条线的时刻」，<b>毫秒级</b>响应。代价是预计算耗时、要存大量骨架（工程上用 Hub 站等技巧压缩）。谷歌地图公交路线即源于此。</p>
      <p class="pill">本页此项为<b>概念演示</b>：先算出最优骨架，再演示「查表→填时刻」。</p>`,
  },
};

/* ---------------- 6. 渲染层 ---------------- */
const svg = document.getElementById('map');
const SVGNS = 'http://www.w3.org/2000/svg';
const el = (n, attrs) => { const e = document.createElementNS(SVGNS, n); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

let stopEls = {};      // id -> {circle, time}
let edgeHighlight;     // 复用的高亮边
let pathGroup;         // 最终行程

function buildMap() {
  svg.innerHTML = '';

  // 线路（坐车）—— 画在底层
  Object.entries(LINES).forEach(([key, L]) => {
    const pts = L.stops.map(s => `${STOPS[s].x},${STOPS[s].y}`).join(' ');
    svg.appendChild(el('polyline', { points: pts, class: 'edge-ride', stroke: L.color }));
  });
  // 步行换乘（虚线）
  FOOTPATHS.forEach(f => {
    svg.appendChild(el('line', { x1: STOPS[f.a].x, y1: STOPS[f.a].y, x2: STOPS[f.b].x, y2: STOPS[f.b].y, class: 'edge-walk' }));
    // 步行时间标注
    const mx = (STOPS[f.a].x + STOPS[f.b].x) / 2, my = (STOPS[f.a].y + STOPS[f.b].y) / 2;
    const t = el('text', { x: mx + 8, y: my, class: 'stop-time dim' }); t.textContent = `步行${f.min}分`;
    t.setAttribute('text-anchor', 'start'); svg.appendChild(t);
  });

  // 线路名小标签（画在起点附近）
  Object.entries(LINES).forEach(([key, L]) => {
    const s0 = STOPS[L.stops[0]];
    const t = el('text', { x: s0.x - 6, y: s0.y - 22, class: 'stop-time' });
    t.setAttribute('text-anchor', 'end'); t.setAttribute('fill', L.color);
    t.textContent = L.name; svg.appendChild(t);
  });

  // 最终路径层（先建空 group，后面填充）
  pathGroup = el('g', {}); svg.appendChild(pathGroup);
  // 高亮边（复用）
  edgeHighlight = el('line', { x1: 0, y1: 0, x2: 0, y2: 0, class: 'edge-highlight', visibility: 'hidden' });
  svg.appendChild(edgeHighlight);

  // 站点
  stopEls = {};
  Object.entries(STOPS).forEach(([id, s]) => {
    const g = el('g', {});
    const c = el('circle', { cx: s.x, cy: s.y, r: 13, class: 'stop-circle' });
    const labelAbove = s.y > 240;        // 下排站名画上方，上排画下方，避免压线
    const name = el('text', { x: s.x, y: labelAbove ? s.y - 20 : s.y - 22, class: 'stop-name' });
    name.textContent = s.name;
    const time = el('text', { x: s.x, y: labelAbove ? s.y + 34 : s.y + 36, class: 'stop-time dim' });
    time.textContent = '—';
    g.appendChild(c); g.appendChild(name); g.appendChild(time);
    svg.appendChild(g);
    stopEls[id] = { circle: c, time };
  });
}

function renderStep(step, query) {
  const { src, dst } = query;
  // 站点状态 + 到达时刻
  Object.keys(STOPS).forEach(id => {
    const { circle, time } = stopEls[id];
    circle.setAttribute('class', 'stop-circle');
    const a = step.arr ? step.arr[id] : INF;
    time.textContent = fmt(a);
    time.classList.toggle('dim', a === INF);
    if (a !== INF) circle.classList.add('reached');
    if (id === src) circle.classList.add('src');
    if (id === dst) circle.classList.add('dst');
    if (id === step.active) circle.classList.add('active');
    circle.setAttribute('r', 13);
  });

  // 高亮边
  if (step.edge) {
    const a = STOPS[step.edge.from], b = STOPS[step.edge.to];
    edgeHighlight.setAttribute('x1', a.x); edgeHighlight.setAttribute('y1', a.y);
    edgeHighlight.setAttribute('x2', b.x); edgeHighlight.setAttribute('y2', b.y);
    edgeHighlight.setAttribute('stroke', step.edge.mode === 'walk' ? 'var(--walk)' : (LINES[step.edge.line] ? LINES[step.edge.line].color : 'var(--active)'));
    edgeHighlight.setAttribute('visibility', 'visible');
    edgeHighlight.setAttribute('class', step.edge.mode === 'walk' ? 'edge-highlight' : 'edge-highlight');
  } else {
    edgeHighlight.setAttribute('visibility', 'hidden');
  }

  // 最终行程
  pathGroup.innerHTML = '';
  if (step.result && step.result.legs) {
    step.result.legs.forEach(l => {
      const a = STOPS[l.from], b = STOPS[l.to];
      const e = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'edge-path' + (l.mode === 'walk' ? ' walk' : '') });
      if (l.mode === 'ride' && LINES[l.line]) e.setAttribute('stroke', 'var(--path)');
      pathGroup.appendChild(e);
    });
  }

  // 文案 / 徽章 / 进度
  document.getElementById('narration').innerHTML = step.narr;
  document.getElementById('roundBadge').textContent = step.round || '';
  // 结果 chip
  const chip = document.getElementById('resultChip');
  const aDst = step.arr ? step.arr[dst] : INF;
  if (step.result) {
    if (step.result.arr === INF) chip.innerHTML = `无可行路线`;
    else chip.innerHTML = `到 ${STOPS[dst].name}：<b>${fmt(step.result.arr)}</b> · 换乘 ${countTransfers(step.result.legs)} 次`;
  } else {
    chip.innerHTML = aDst === INF ? `终点尚未到达` : `当前到终点：<b>${fmt(aDst)}</b>`;
  }

  // CSA 扫描条
  if (currentAlgo.strip) renderStrip(step);
}

/* CSA 扫描条 */
const connStrip = document.getElementById('connStrip');
const connTrack = document.getElementById('connTrack');
let connCells = [];
function buildStrip() {
  connTrack.innerHTML = '';
  connCells = CONNECTIONS.map(c => {
    const cell = document.createElement('div');
    cell.className = 'conn-cell';
    cell.innerHTML = `<div class="seg">${c.from}→${c.to}</div><div class="tm">${fmt(c.dep)}→${fmt(c.arr)}</div>`;
    connTrack.appendChild(cell);
    return cell;
  });
}
function renderStrip(step) {
  const ptr = step.ptr;
  connCells.forEach((cell, i) => {
    cell.className = 'conn-cell';
    if (ptr != null && i < ptr) cell.classList.add('done');
    if (ptr != null && i === ptr) {
      cell.classList.add('cur');
      cell.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
    if (step.used && ptr != null && i === ptr) cell.classList.add('used');
  });
}

/* ---------------- 7. 播放器 ---------------- */
let steps = [];
let idx = 0;
let timer = null;
let currentAlgoKey = 'raptor';
let currentAlgo = ALGOS[currentAlgoKey];
let query = { src: 'A', dst: 'H', dep: 0 };

function recompute() {
  stopPlay();
  currentAlgo = ALGOS[currentAlgoKey];
  steps = currentAlgo.build(query.src, query.dst, query.dep);
  idx = 0;
  connStrip.hidden = !currentAlgo.strip;
  if (currentAlgo.strip) buildStrip();
  renderStep(steps[0], query);
  updateProgress();
}

function updateProgress() {
  const total = steps.length - 1;
  document.getElementById('progressText').textContent = `第 ${idx} / ${total} 步`;
  document.getElementById('progressBar').style.width = (total ? (idx / total * 100) : 0) + '%';
  document.getElementById('prevBtn').disabled = idx === 0;
  document.getElementById('stepBtn').disabled = idx >= total;
}

function go(i) {
  idx = Math.max(0, Math.min(steps.length - 1, i));
  renderStep(steps[idx], query);
  updateProgress();
  if (idx >= steps.length - 1) stopPlay();
}

function play() {
  if (idx >= steps.length - 1) idx = 0;
  setPlayBtn(true);
  const speed = +document.getElementById('speed').value;
  const delay = 1500 - speed * 13;  // 1..100 -> ~1487ms .. 200ms
  timer = setInterval(() => {
    if (idx >= steps.length - 1) { stopPlay(); return; }
    go(idx + 1);
  }, Math.max(180, delay));
}
function stopPlay() { if (timer) { clearInterval(timer); timer = null; } setPlayBtn(false); }
function setPlayBtn(playing) {
  const b = document.getElementById('playBtn');
  b.textContent = playing ? '⏸ 暂停' : '▶ 自动播放';
  b.classList.toggle('btn-primary', !playing);
}

/* ---------------- 8. 初始化 + 事件 ---------------- */
function initAlgoList() {
  const list = document.getElementById('algoList');
  list.innerHTML = '';
  Object.entries(ALGOS).forEach(([key, a]) => {
    const b = document.createElement('button');
    b.className = 'algo-btn' + (key === currentAlgoKey ? ' active' : '');
    b.innerHTML = `<span class="name">${a.name}</span><span class="tag">${a.tag}</span>`;
    b.onclick = () => {
      currentAlgoKey = key;
      document.querySelectorAll('.algo-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      document.getElementById('explain').innerHTML = a.explain;
      recompute();
    };
    list.appendChild(b);
  });
  document.getElementById('explain').innerHTML = ALGOS[currentAlgoKey].explain;
}

function initSelectors() {
  const srcSel = document.getElementById('srcSel');
  const dstSel = document.getElementById('dstSel');
  const depSel = document.getElementById('depSel');
  Object.entries(STOPS).forEach(([id, s]) => {
    srcSel.add(new Option(s.name, id, false, id === query.src));
    dstSel.add(new Option(s.name, id, false, id === query.dst));
  });
  for (let m = 0; m <= 12; m += 2) depSel.add(new Option(fmt(m) + ' 出发', m, false, m === query.dep));
  srcSel.onchange = () => { query.src = srcSel.value; recompute(); };
  dstSel.onchange = () => { query.dst = dstSel.value; recompute(); };
  depSel.onchange = () => { query.dep = +depSel.value; recompute(); };
}

document.getElementById('playBtn').onclick = () => { if (timer) stopPlay(); else play(); };
document.getElementById('stepBtn').onclick = () => { stopPlay(); go(idx + 1); };
document.getElementById('prevBtn').onclick = () => { stopPlay(); go(idx - 1); };
document.getElementById('resetBtn').onclick = () => { stopPlay(); go(0); };

buildMap();
initAlgoList();
initSelectors();
recompute();
