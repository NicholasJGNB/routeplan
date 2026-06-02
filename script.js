/* =========================================================
   路径规划算法可视化
   网格寻路 + 动画 + 通俗讲解
   ========================================================= */

// ---------- 网格参数 ----------
const COLS = 35;
const ROWS = 22;
const WEIGHT_COST = 8; // 沼泽的额外移动代价

// 起点 / 终点（行,列）
let start = { r: Math.floor(ROWS / 2), c: 4 };
let end   = { r: Math.floor(ROWS / 2), c: COLS - 5 };

// 每个格子的状态：'empty' | 'wall' | 'weight'
let cellType = [];

// DOM 引用：cells[r][c]
let cells = [];

// ---------- 算法元数据 + 通俗讲解 ----------
const ALGORITHMS = {
  bfs: {
    name: "广度优先 BFS",
    en: "Breadth-First Search",
    tag: "最简单 · 保证步数最短",
    title: "像水波纹一样一圈圈扩散",
    desc: `从起点开始，先看相邻的 4 个格子，再看它们的邻居……一圈一圈往外扩。因为是按"离起点几步"的顺序探索，所以<b>第一次碰到终点时走的步数一定最少</b>。`,
    extra: `缺点是它很"盲目"：朝四面八方平均用力，离终点更近的方向并不会优先探索，所以会探索很多没用的格子。它也不理解"沼泽很慢"——它只数步数，不算代价。`,
    pros: ["无权重时一定找到最短路径", "逻辑最简单，容易理解"],
    cons: ["盲目扩散，探索格子多", "不考虑移动代价（沼泽）"],
    weighted: false,
    heuristic: false,
  },
  dfs: {
    name: "深度优先 DFS",
    en: "Depth-First Search",
    tag: "最简单 · 不保证最短",
    title: "一条路走到黑，撞墙再回头",
    desc: "选一个方向<b>一直往前走</b>，走不通了（撞墙或到边界）才退回上一个岔路口换方向。像走迷宫时一直摸着右边的墙走。",
    extra: `它能找到一条通往终点的路，但<b>几乎不可能是最短的</b>——经常在网格里绕出一条蜿蜒的长龙。它的价值在于实现简单、占用内存少，适合"只要能到就行"的场景。`,
    pros: ["实现简单，内存占用少", "适合探索全部可达区域"],
    cons: ["路径常常绕远，不是最短", "不考虑移动代价"],
    weighted: false,
    heuristic: false,
  },
  dijkstra: {
    name: "Dijkstra 算法",
    en: "Dijkstra's Algorithm",
    tag: "考虑代价 · 保证最优",
    title: `BFS 的"会算账"升级版`,
    desc: `和 BFS 一样一圈圈扩散，但每一步都记录<b>"从起点到这里累计花了多少代价"</b>，并且总是优先扩展"目前累计代价最小"的格子。于是走沼泽（代价 +8）就会被自动避开。`,
    extra: `它保证找到<b>总代价最小</b>的路径。但它依然没有"目标感"——不知道终点在哪个方向，所以还是朝四周均匀扩散，探索量和 BFS 差不多大。`,
    pros: ["考虑权重，保证总代价最小", "结果可靠，应用极广（如导航）"],
    cons: ["没有方向感，探索范围大", "比 A* 慢"],
    weighted: true,
    heuristic: false,
  },
  greedy: {
    name: "贪婪最佳优先",
    en: "Greedy Best-First",
    tag: "很快 · 但可能绕远",
    title: "只盯着终点猛冲",
    desc: `每一步都选<b>"直线看起来离终点最近"</b>的格子去探索（这个"估计还差多远"叫启发式 h）。所以它会笔直地朝终点方向冲过去，速度飞快。`,
    extra: `代价是<b>容易被骗</b>：如果终点方向有一堵墙，它会一头扎进死胡同，绕一大圈才出来。它只看"还差多远"，完全不管"已经走了多远"，所以<b>找到的路往往不是最短的</b>。`,
    pros: ["速度快，探索格子少", "朝目标方向前进，直观"],
    cons: ["不保证最短路径", "遇到障碍容易绕远路"],
    weighted: false,
    heuristic: true,
  },
  astar: {
    name: "A* 算法",
    en: "A-Star",
    tag: "最经典 · 又快又最优",
    title: "Dijkstra + 贪婪，两全其美",
    desc: "对每个格子算一个分数 <b>f = g + h</b>：<br>· <b>g</b> = 从起点到这里已经走了多少（像 Dijkstra）<br>· <b>h</b> = 估计离终点还差多远（像贪婪）<br>每次都挑 f 最小的格子探索。",
    extra: `这样它既有"目标感"（朝终点冲），又"算总账"（不会乱花代价）。只要 h 不高估真实距离，A* 就能<b>像 Dijkstra 一样保证最优，又像贪婪一样快</b>。它是游戏、机器人、导航里最常用的寻路算法。`,
    pros: ["保证最短/最优路径", "有方向感，比 Dijkstra 快很多", "工业界最常用"],
    cons: ["实现稍复杂", "依赖一个好的启发式估计"],
    weighted: true,
    heuristic: true,
  },
};

let currentAlgo = "bfs";
let running = false;
let mouseDown = false;
let dragging = null; // 'start' | 'end' | null
let paintTool = "wall";

// ---------- 初始化网格 ----------
function buildGrid() {
  const gridEl = document.getElementById("grid");
  gridEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
  gridEl.innerHTML = "";
  cells = [];
  cellType = [];

  for (let r = 0; r < ROWS; r++) {
    cells[r] = [];
    cellType[r] = [];
    for (let c = 0; c < COLS; c++) {
      cellType[r][c] = "empty";
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.r = r;
      cell.dataset.c = c;
      gridEl.appendChild(cell);
      cells[r][c] = cell;
    }
  }
  paintSpecial();
  attachGridEvents(gridEl);
}

// 重新绘制起点 / 终点 / 墙 / 沼泽（不动搜索动画）
function paintSpecial() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = cells[r][c];
      el.classList.remove("start", "end", "wall", "weight");
      if (cellType[r][c] === "wall") el.classList.add("wall");
      if (cellType[r][c] === "weight") el.classList.add("weight");
    }
  }
  cells[start.r][start.c].classList.add("start");
  cells[end.r][end.c].classList.add("end");
}

// 清除搜索痕迹（visited/frontier/path）
function clearSearch() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      cells[r][c].classList.remove("visited", "visited-strong", "frontier", "path");
    }
  }
  setStats(0, 0, 0);
}

function isStart(r, c) { return r === start.r && c === start.c; }
function isEnd(r, c) { return r === end.r && c === end.c; }

// ---------- 鼠标 / 触摸交互 ----------
function attachGridEvents(gridEl) {
  const getCell = (target) => {
    if (!target || !target.dataset || target.dataset.r === undefined) return null;
    return { r: +target.dataset.r, c: +target.dataset.c };
  };

  const onDown = (rc) => {
    if (running || !rc) return;
    mouseDown = true;
    if (isStart(rc.r, rc.c)) { dragging = "start"; return; }
    if (isEnd(rc.r, rc.c)) { dragging = "end"; return; }
    applyTool(rc.r, rc.c);
  };

  const onMove = (rc) => {
    if (!mouseDown || running || !rc) return;
    if (dragging) {
      moveEndpoint(dragging, rc.r, rc.c);
    } else {
      applyTool(rc.r, rc.c);
    }
  };

  const onUp = () => { mouseDown = false; dragging = null; };

  gridEl.addEventListener("mousedown", (e) => onDown(getCell(e.target)));
  gridEl.addEventListener("mouseover", (e) => onMove(getCell(e.target)));
  document.addEventListener("mouseup", onUp);

  // 触摸
  gridEl.addEventListener("touchstart", (e) => {
    const t = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
    onDown(getCell(t));
  }, { passive: true });
  gridEl.addEventListener("touchmove", (e) => {
    const t = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
    onMove(getCell(t));
  }, { passive: true });
  gridEl.addEventListener("touchend", onUp);
}

function applyTool(r, c) {
  if (isStart(r, c) || isEnd(r, c)) return;
  if (paintTool === "wall") cellType[r][c] = "wall";
  else if (paintTool === "weight") cellType[r][c] = "weight";
  else cellType[r][c] = "empty";
  paintSpecial();
}

function moveEndpoint(which, r, c) {
  if (cellType[r][c] === "wall") return;
  if (which === "start" && !isEnd(r, c)) start = { r, c };
  if (which === "end" && !isStart(r, c)) end = { r, c };
  paintSpecial();
}

// ---------- 邻居 ----------
function neighbors(r, c) {
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const out = [];
  for (const [dr, dc] of dirs) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    if (cellType[nr][nc] === "wall") continue;
    out.push({ r: nr, c: nc });
  }
  return out;
}

function stepCost(r, c) {
  return cellType[r][c] === "weight" ? 1 + WEIGHT_COST : 1;
}

function heuristic(r, c) {
  // 曼哈顿距离
  return Math.abs(r - end.r) + Math.abs(c - end.c);
}

const key = (r, c) => r * COLS + c;

// ---------- 算法核心：返回探索顺序 + 最终路径 ----------
// 每个算法都返回 { order: [{r,c,frontier?}], parent: Map, found: bool }
function runAlgorithm(algo) {
  const order = [];          // 探索顺序（用于动画）
  const parent = new Map();  // 记录每个格子是从哪来的
  const dist = new Map();    // 累计代价（g）
  const visited = new Set();
  let found = false;

  const startK = key(start.r, start.c);
  dist.set(startK, 0);

  if (algo === "bfs") {
    const queue = [start];
    visited.add(startK);
    while (queue.length) {
      const cur = queue.shift();
      order.push(cur);
      if (isEnd(cur.r, cur.c)) { found = true; break; }
      for (const n of neighbors(cur.r, cur.c)) {
        const k = key(n.r, n.c);
        if (!visited.has(k)) {
          visited.add(k);
          parent.set(k, cur);
          queue.push(n);
        }
      }
    }
  }

  else if (algo === "dfs") {
    // 把"从哪个格子来的"和节点一起压栈，
    // 等真正出栈、第一次访问到它时才记 parent，
    // 这样重建出来的才是 DFS 真实走过的那条路（会很蜿蜒）。
    const stack = [{ node: start, from: null }];
    while (stack.length) {
      const { node: cur, from } = stack.pop();
      const ck = key(cur.r, cur.c);
      if (visited.has(ck)) continue;
      visited.add(ck);
      if (from) parent.set(ck, from);
      order.push(cur);
      if (isEnd(cur.r, cur.c)) { found = true; break; }
      // 逆序压栈，让探索方向更自然
      const ns = neighbors(cur.r, cur.c);
      for (let i = ns.length - 1; i >= 0; i--) {
        const n = ns[i];
        if (!visited.has(key(n.r, n.c))) {
          stack.push({ node: n, from: cur });
        }
      }
    }
  }

  else if (algo === "dijkstra" || algo === "astar" || algo === "greedy") {
    // 用一个简单的优先队列（数组 + 排序）
    const pq = new MinHeap();
    const priority = (n, g) => {
      if (algo === "dijkstra") return g;
      if (algo === "greedy") return heuristic(n.r, n.c);
      return g + heuristic(n.r, n.c); // astar
    };
    pq.push({ node: start, p: priority(start, 0) });

    while (!pq.isEmpty()) {
      const { node: cur } = pq.pop();
      const ck = key(cur.r, cur.c);
      if (visited.has(ck)) continue;
      visited.add(ck);
      order.push(cur);
      if (isEnd(cur.r, cur.c)) { found = true; break; }

      const g = dist.get(ck) ?? Infinity;
      for (const n of neighbors(cur.r, cur.c)) {
        const k = key(n.r, n.c);
        if (visited.has(k)) continue;
        // greedy 不累计代价，但仍记录步数用于 path 还原
        const moveCost = algo === "greedy" ? 1 : stepCost(n.r, n.c);
        const newG = g + moveCost;
        if (newG < (dist.get(k) ?? Infinity)) {
          dist.set(k, newG);
          parent.set(k, cur);
          pq.push({ node: n, p: priority(n, newG) });
        }
      }
    }
  }

  // 还原路径
  let path = [];
  if (found) {
    let cur = end;
    path.push(cur);
    while (!(cur.r === start.r && cur.c === start.c)) {
      const p = parent.get(key(cur.r, cur.c));
      if (!p) break;
      path.push(p);
      cur = p;
    }
    path.reverse();
  }

  // 计算路径总代价
  let totalCost = 0;
  for (let i = 1; i < path.length; i++) {
    totalCost += stepCost(path[i].r, path[i].c);
  }

  return { order, path, found, totalCost };
}

// ---------- 极简二叉堆（优先队列） ----------
class MinHeap {
  constructor() { this.a = []; }
  isEmpty() { return this.a.length === 0; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].p <= a[i].p) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < n && a[l].p < a[smallest].p) smallest = l;
        if (r < n && a[r].p < a[smallest].p) smallest = r;
        if (smallest === i) break;
        [a[smallest], a[i]] = [a[i], a[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

// ---------- 动画播放 ----------
let animTimer = null;

function animate(result) {
  clearSearch();
  const { order, path, found } = result;
  const caption = document.getElementById("caption");

  const speed = +document.getElementById("speed").value;
  // 速度 1~100 → 延迟 ~60ms ~ 1ms
  const delay = Math.max(1, Math.round(62 - speed * 0.6));

  let i = 0;
  let visitedCount = 0;
  running = true;
  setRunningUI(true);

  function step() {
    // 一次处理多个，避免太慢
    const batch = Math.max(1, Math.round(speed / 25));
    for (let b = 0; b < batch && i < order.length; b++, i++) {
      const { r, c } = order[i];
      if (!isStart(r, c) && !isEnd(r, c)) {
        cells[r][c].classList.add("visited");
        // 稍后变深，营造层次
        setTimeout(() => cells[r] && cells[r][c] &&
          cells[r][c].classList.add("visited-strong"), 120);
      }
      visitedCount++;
    }
    setStats(visitedCount, 0, 0);

    if (i < order.length) {
      animTimer = setTimeout(step, delay);
    } else {
      drawPath(path, found, visitedCount, caption);
    }
  }
  step();
}

function drawPath(path, found, visitedCount, caption) {
  if (!found) {
    running = false;
    setRunningUI(false);
    caption.textContent = "😶 找不到通往终点的路——终点被墙完全围住了。";
    return;
  }
  let j = 0;
  function step() {
    if (j < path.length) {
      const { r, c } = path[j];
      if (!isStart(r, c) && !isEnd(r, c)) cells[r][c].classList.add("path");
      j++;
      animTimer = setTimeout(step, 22);
    } else {
      running = false;
      setRunningUI(false);
      const algoName = ALGORITHMS[currentAlgo].name;
      const result = runAlgorithm(currentAlgo); // 重新拿代价（轻量）
      setStats(visitedCount, path.length, result.totalCost);
      caption.innerHTML =
        `✅ <b>${algoName}</b> 探索了 ${visitedCount} 个格子，` +
        `找到一条长 <b>${path.length}</b> 步、总代价 <b>${result.totalCost}</b> 的路径。`;
    }
  }
  step();
}

function setStats(visited, length, cost) {
  document.getElementById("statVisited").textContent = visited;
  document.getElementById("statLength").textContent = length;
  document.getElementById("statCost").textContent = cost;
}

function setRunningUI(isRunning) {
  document.getElementById("runBtn").disabled = isRunning;
  document.getElementById("runBtn").textContent = isRunning ? "搜索中…" : "▶ 开始搜索";
}

function stopAnim() {
  if (animTimer) clearTimeout(animTimer);
  animTimer = null;
  running = false;
  setRunningUI(false);
}

// ---------- 渲染算法列表 + 讲解 ----------
function renderAlgoList() {
  const list = document.getElementById("algoList");
  list.innerHTML = "";
  Object.entries(ALGORITHMS).forEach(([key, a]) => {
    const btn = document.createElement("button");
    btn.className = "algo-btn" + (key === currentAlgo ? " active" : "");
    btn.dataset.key = key;
    btn.innerHTML =
      `<span><span class="name">${a.name}</span><br>` +
      `<span class="en">${a.en}</span></span>` +
      `<span class="tag">${a.tag}</span>`;
    btn.addEventListener("click", () => selectAlgo(key));
    list.appendChild(btn);
  });
  renderExplain();
}

function selectAlgo(key) {
  if (running) return;
  currentAlgo = key;
  document.querySelectorAll(".algo-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.key === key));
  renderExplain();
  clearSearch();
  document.getElementById("caption").textContent =
    `已选择「${ALGORITHMS[key].name}」，点「开始搜索」看它怎么找路。`;
}

function renderExplain() {
  const a = ALGORITHMS[currentAlgo];
  const el = document.getElementById("explain");
  const badges = [];
  badges.push(`<span class="badge ${a.weighted ? "good" : "info"}">${a.weighted ? "会避开沼泽（算代价）" : "只数步数，不算代价"}</span>`);
  badges.push(`<span class="badge ${a.heuristic ? "good" : "info"}">${a.heuristic ? "有方向感（启发式）" : "盲目扩散"}</span>`);

  el.innerHTML = `
    <h3>${a.title}</h3>
    <p>${a.desc}</p>
    <div class="badge-row">${badges.join("")}</div>
    <p style="color:var(--muted)">${a.extra}</p>
    <div class="badge-row">
      ${a.pros.map((p) => `<span class="badge good">👍 ${p}</span>`).join("")}
    </div>
    <div class="badge-row">
      ${a.cons.map((p) => `<span class="badge bad">👎 ${p}</span>`).join("")}
    </div>
  `;
}

// ---------- 随机迷宫 ----------
function randomMaze() {
  if (running) return;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isStart(r, c) || isEnd(r, c)) { cellType[r][c] = "empty"; continue; }
      const rand = Math.random();
      if (rand < 0.22) cellType[r][c] = "wall";
      else if (rand < 0.30) cellType[r][c] = "weight";
      else cellType[r][c] = "empty";
    }
  }
  clearSearch();
  paintSpecial();
}

function clearAll() {
  if (running) return;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) cellType[r][c] = "empty";
  clearSearch();
  paintSpecial();
}

// ---------- 绑定控件 ----------
function bindControls() {
  document.getElementById("runBtn").addEventListener("click", () => {
    if (running) return;
    stopAnim();
    const result = runAlgorithm(currentAlgo);
    animate(result);
  });
  document.getElementById("clearPathBtn").addEventListener("click", () => {
    if (running) { stopAnim(); }
    clearSearch();
    paintSpecial();
  });
  document.getElementById("resetWallBtn").addEventListener("click", clearAll);
  document.getElementById("mazeBtn").addEventListener("click", randomMaze);

  document.querySelectorAll('input[name="tool"]').forEach((radio) => {
    radio.addEventListener("change", (e) => { paintTool = e.target.value; });
  });
}

// ---------- 启动 ----------
buildGrid();
renderAlgoList();
bindControls();
