/**
 * DD2419 Unified Map Tool Logic
 * Handles both generation and evaluation in a single-page interface.
 */

// --- CONSTANTS ---
const WORKSPACE_DATA = [
    { x: 0, y: 0 },
    { x: 522, y: 0 },
    { x: 800, y: 202 },
    { x: 1001, y: 204 },
    { x: 1000, y: 422 },
    { x: 860, y: 423 },
    { x: 859, y: 267 },
    { x: 0, y: 270 },
];

const START_POSES = [
    { x: 49, y: 50, angle: 0 },
    { x: 49, y: 50, angle: 90 },
    { x: 240, y: 200, angle: -90 },
    { x: 240, y: 200, angle: 0 },
    { x: 522, y: 221, angle: -90 },
    { x: 522, y: 221, angle: 0 },
    { x: 925, y: 378, angle: -90 },
];

const OBJECTS = [
    { x: 877, y: 383, angle: 0 },
    { x: 969, y: 312, angle: 0 },
    { x: 966, y: 234, angle: 0 },
    { x: 226, y: 15, angle: 0 },
    { x: 266, y: 19, angle: 0 },
    { x: 23, y: 249, angle: 0 },
    { x: 133, y: 222, angle: 0 },
    { x: 320, y: 146, angle: 0 },
    { x: 320, y: 233, angle: 0 },
    { x: 422, y: 122, angle: 0 },
    { x: 518, y: 24, angle: 0 },
    { x: 522, y: 124, angle: 0 },
    { x: 684, y: 130, angle: 0 },
    { x: 637, y: 251, angle: 0 },
];

const BOXES = [
    { x: 876, y: 343, angle: 90 },
    { x: 140, y: 16, angle: 0 },
    { x: 420, y: 155, angle: 90 },
    { x: 639, y: 100, angle: 40 },
];

const OBSTACLE_X_RANGE = [10, 500];
const OBSTACLE_Y_RANGE = [10, 250];
const OBSTACLE_DISTANCE_THRESHOLD = 50.0;

// --- STATE ---
let currentMode = 'generate'; // 'generate', 'evaluate'
let currentTask = null; // Generated task
let evalData = null; // Evaluation data (workspace, gt, solution)
let evaluationResult = null;
let currentView = 'truth'; // Canvas view filter
let hoverItem = null;
let panelHoverItem = null; // Item hovered in results panel (highlights on canvas)
let legendHoverKey = null; // Legend item being hovered (dims non-matching canvas items)
let legendFadeKey = null;   // Key that was hovered when fade-out started
let legendFadeAlpha = 1;    // Current alpha for non-matching items during fade (0.12 → 1)
let legendFadeRAF = null;
let lastEvalTab = 'input'; // Remembered across mode switches
let lastGenerateView = 'truth'; // Remembered when switching to evaluate and back

// Viewport state (zoom/pan)
let vpZoom = 1;
let vpPanX = 0, vpPanY = 0;
let vpDragStart = null;
let vpTouchState = null;
let vpLastPinchDist = 0, vpLastPinchCx = 0, vpLastPinchCy = 0;

// Placement guide obstacle drag state
let placementObsDrag = null; // { idx, offsetX, offsetY }
let placementDragJustCompleted = false;

function resetViewport() { vpZoom = 1; vpPanX = 0; vpPanY = 0; }

// Recent seeds (last 5, localStorage-persisted) — entries are {taskId, ts} or legacy strings
let recentSeeds = JSON.parse(localStorage.getItem('dd2419_recent_seeds') || '[]').map(e => typeof e === 'string' ? { taskId: e, ts: 0 } : e);

// --- SETTINGS PERSISTENCE ---
function saveSettings() {
    localStorage.setItem('dd2419_settings', JSON.stringify({
        knownObjects: document.getElementById('knownObjects').value,
        unknownObjects: document.getElementById('unknownObjects').value,
        knownBoxes: document.getElementById('knownBoxes').value,
        unknownBoxes: document.getElementById('unknownBoxes').value,
        obstaclesCount: document.getElementById('obstaclesCount').value,
        transformX: document.getElementById('transformX').value,
        transformY: document.getElementById('transformY').value,
        transformAngle: document.getElementById('transformAngle').value,
    }));
}
function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem('dd2419_settings') || 'null');
        if (!s) return;
        if (s.knownObjects != null) document.getElementById('knownObjects').value = s.knownObjects;
        if (s.unknownObjects != null) document.getElementById('unknownObjects').value = s.unknownObjects;
        if (s.knownBoxes != null) document.getElementById('knownBoxes').value = s.knownBoxes;
        if (s.unknownBoxes != null) document.getElementById('unknownBoxes').value = s.unknownBoxes;
        if (s.obstaclesCount != null) document.getElementById('obstaclesCount').value = s.obstaclesCount;
        if (s.transformX != null) document.getElementById('transformX').value = s.transformX;
        if (s.transformY != null) document.getElementById('transformY').value = s.transformY;
        if (s.transformAngle != null) document.getElementById('transformAngle').value = s.transformAngle;
    } catch (e) { }
}

// Evaluation history (session)
let evalHistory = JSON.parse(localStorage.getItem('dd2419_eval_history') || '[]').map(e => {
    if (typeof e === 'string') return { seed: e, verdict: '', hash: '0000', solutionText: '', time: '' };
    return e;
});

let currentEvalHash = null;
let lastRawSolution = null;
let detailUIDCounter = 0;
JSON.parse(localStorage.getItem('dd2419_eval_history') || '[]').map(e => {
    // Migrate old history format if needed
    if (typeof e === 'string') return { seed: e, verdict: '', hash: '0000', solutionText: '', time: '' };
    return e;
});

let hoverWorldCoords = null; // {x, y} in world cm, updated on mousemove
let hoverInWorkspace = false; // true when cursor is inside WORKSPACE_DATA polygon (placement mode)
let showGrid = true;         // Toggle grid overlay on canvas
let pinnedItem = null;       // Item pinned by double-click; tooltip stays visible
let pinnedMouse = { x: 0, y: 0 }; // Canvas-container position when item was pinned

function startLegendFade() {
    if (legendFadeRAF) cancelAnimationFrame(legendFadeRAF);
    const DURATION = 500;
    const startTime = performance.now();
    const startAlpha = legendFadeAlpha;
    function step(now) {
        const t = Math.min((now - startTime) / DURATION, 1);
        const eased = t * (2 - t); // ease-out
        legendFadeAlpha = startAlpha + (1 - startAlpha) * eased;
        draw();
        if (t < 1) legendFadeRAF = requestAnimationFrame(step);
        else { legendFadeAlpha = 1; legendFadeKey = null; legendFadeRAF = null; }
    }
    legendFadeRAF = requestAnimationFrame(step);
}
let hoverMouse = { x: 0, y: 0 }; // Mouse position relative to canvas element (CSS px)
let hoverViewport = { x: 0, y: 0 }; // Mouse position in viewport (clientX/Y) for fixed tooltip
let pinnedViewport = { x: 0, y: 0 }; // Viewport position when tooltip was pinned
const layerVisible = {}; // false = hidden, undefined/true = visible
const vis = (key) => layerVisible[key] !== false;

// --- RECENT SEEDS ---
function pushRecentSeed(taskId) {
    const entry = { taskId, ts: Date.now() };
    recentSeeds = [entry, ...recentSeeds.filter(e => e.taskId !== taskId)].slice(0, 5);
    localStorage.setItem('dd2419_recent_seeds', JSON.stringify(recentSeeds));
    renderRecentSeeds();
}

function formatRecentTs(ts) {
    if (!ts) return 'older';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderRecentSeeds() {
    const el = document.getElementById('recentSeedsList');
    const wrap = document.getElementById('recentSeedsWrap');
    if (!el || !wrap) return;
    wrap.classList.toggle('hidden', recentSeeds.length === 0);
    el.innerHTML = '';
    recentSeeds.forEach(({ taskId, ts, solutionText }) => {
        const container = document.createElement('div');
        container.className = 'recent-seed-container';

        const btn = document.createElement('button');
        btn.className = 'recent-seed-btn';
        btn.textContent = formatRecentTs(ts);
        btn.title = 'Load this task';
        btn.addEventListener('click', () => {
            loadTaskFromId(taskId);
        });

        container.appendChild(btn);

        el.appendChild(container);
    });
}
// Snap base item positions to nearest pool entry to fix floating-point drift from inverse transform
const snapToPool = (items, pool) => items.map(item => {
    let nearest = null, minDist = Infinity;
    pool.forEach(p => {
        const d = Math.hypot(p.x - item.x, p.y - item.y);
        if (d < minDist) {
            minDist = d;
            nearest = p;
        } else if (d === minDist && p.angle !== undefined && item.angle !== undefined) {
            // If distance is same (e.g. multiple angles at same x,y), pick closest angle
            const ad = Math.abs(((p.angle - item.angle + 180) % 360) - 180);
            const prevAd = Math.abs(((nearest.angle - item.angle + 180) % 360) - 180);
            if (ad < prevAd) nearest = p;
        }
    });
    if (nearest && minDist < 1) {
        const res = { ...item, x: nearest.x, y: nearest.y };
        if (nearest.angle !== undefined) res.angle = nearest.angle;
        return res;
    }
    return item;
});

async function loadTaskFromId(taskId) {
    let taskData;
    try { taskData = parseTaskIdText(await decodeTaskId(taskId)); } catch { return false; }
    const { workspace, start, gtKnown, gtUnknown, obstacles, savedTransform } = taskData;
    const params = {
        nkO: gtKnown.filter(i => i.Type === 'O').length,
        nuO: gtUnknown.filter(i => i.Type === 'O').length,
        nkB: gtKnown.filter(i => i.Type === 'B').length,
        nuB: gtUnknown.filter(i => i.Type === 'B').length,
        nObs: obstacles.length,
    };
    const transformed = {
        workspace,
        startPose: start ?? { x: 0, y: 0, angle: 0 },
        knownObjs: gtKnown.filter(i => i.Type === 'O'),
        knownBoxes: gtKnown.filter(i => i.Type === 'B'),
        unknownObjs: gtUnknown.filter(i => i.Type === 'O'),
        unknownBoxes: gtUnknown.filter(i => i.Type === 'B'),
        obstacles
    };

    // If transform metadata is encoded, recover base positions by inverting the transform
    let transform = { translate: { x: 0, y: 0 }, angleRad: 0 };
    let base = transformed;
    if (savedTransform) {
        const { tx, ty, angleDeg } = savedTransform;
        const ar = angleDeg * Math.PI / 180;
        transform = { translate: { x: tx, y: ty }, angleRad: ar };
        // Invert: translate back then rotate back
        const invT = i => {
            const r = rotatePoint(i.x - tx, i.y - ty, -ar);
            return { ...i, x: r.x, y: r.y, angle: i.angle - angleDeg };
        };
        const invP = p => { const r = rotatePoint(p.x - tx, p.y - ty, -ar); return { x: r.x, y: r.y }; };
        base = {
            workspace: workspace.map(invP),
            startPose: snapToPool([invT(transformed.startPose)], START_POSES)[0],
            knownObjs: transformed.knownObjs.map(invT),
            knownBoxes: transformed.knownBoxes.map(invT),
            unknownObjs: transformed.unknownObjs.map(invT),
            unknownBoxes: transformed.unknownBoxes.map(invT),
            obstacles: transformed.obstacles.map(invP),
        };
    }

    base.knownObjs = snapToPool(base.knownObjs, OBJECTS);
    base.unknownObjs = snapToPool(base.unknownObjs, OBJECTS);
    base.knownBoxes = snapToPool(base.knownBoxes, BOXES);
    base.unknownBoxes = snapToPool(base.unknownBoxes, BOXES);

    currentTask = { seed: null, obsSeed: null, params, transform, base, transformed, taskId };

    // Sync UI inputs to loaded task state
    const kOEl = document.getElementById('knownObjects');
    const uOEl = document.getElementById('unknownObjects');
    const kBEl = document.getElementById('knownBoxes');
    const uBEl = document.getElementById('unknownBoxes');
    const obsEl = document.getElementById('obstaclesCount');
    if (kOEl) kOEl.value = params.nkO;
    if (uOEl) uOEl.value = params.nuO;
    if (kBEl) kBEl.value = params.nkB;
    if (uBEl) uBEl.value = params.nuB;
    if (obsEl) obsEl.value = params.nObs;
    const txEl = document.getElementById('transformX');
    const tyEl = document.getElementById('transformY');
    const taEl = document.getElementById('transformAngle');
    if (txEl) txEl.value = savedTransform ? savedTransform.tx : 0;
    if (tyEl) tyEl.value = savedTransform ? savedTransform.ty : 0;
    if (taEl) taEl.value = savedTransform ? savedTransform.angleDeg : 0;

    if (currentMode === 'generate') {
        document.getElementById('tabSeedBadge')?.classList.remove('hidden');
        document.getElementById('btnSaveAll')?.classList.remove('hidden');
    }
    animateTaskIn();
    updateSaveTooltips();
    resetViewport();
    history.replaceState(null, '', '#' + taskId);
    draw();
    return true;
}

// --- EVAL HISTORY ---
function pushEvalHistory(seed, verdict, solutionText) {
    const s = evaluationResult?.stats;
    if (!s) return;
    const hash = hashString(solutionText);
    currentEvalHash = hash;

    // Deduplication: remove existing entry with same seed and hash
    const existingIdx = evalHistory.findIndex(h => h.seed === seed && h.hash === hash);
    if (existingIdx !== -1) evalHistory.splice(existingIdx, 1);

    evalHistory.unshift({
        seed, verdict, hash, solutionText,
        kO: `${s.knownObjMatched}/${s.knownObjTotal}`,
        kB: `${s.knownBoxMatched}/${s.knownBoxTotal}`,
        dO: s.unknownObjMatched, dB: s.unknownBoxMatched,
        pO: s.penaltyObjs, pB: s.penaltyBoxes,
        time: new Date().toLocaleTimeString()
    });
    if (evalHistory.length > 20) evalHistory.pop();
    try {
        localStorage.setItem('dd2419_eval_history', JSON.stringify(evalHistory));
    } catch (e) {
        console.error("Failed to save evaluation history to localStorage:", e);
    }
    renderEvalHistory();
}

function clearEvalHistory() {
    if (!confirm("Clear evaluation history?")) return;
    evalHistory = [];
    localStorage.removeItem('dd2419_eval_history');
    renderEvalHistory();
}

function renderEvalHistory() {
    const renderTo = (listId, wrapId) => {
        const el = document.getElementById(listId);
        const wrap = document.getElementById(wrapId);
        if (!el || !wrap) return;

        if (listId === 'evalHistoryListInput') {
            wrap.classList.remove('hidden'); // Always show in Input tab
        } else {
            wrap.classList.toggle('hidden', evalHistory.length === 0);
        }

        el.innerHTML = '';
        evalHistory.forEach((h, i) => {
            const div = document.createElement('div');
            const isCurrent = (h.seed === currentTask?.taskId) && (h.hash === currentEvalHash);
            div.className = 'history-item' + (isCurrent ? ' history-item--current' : '');
            div.title = h.solutionText ? 'Click to load this evaluation' : 'Click to copy seed';

            const shortSeed = h.seed.length > 8 ? h.seed.slice(0, 8) : h.seed;

            div.innerHTML =
                `<span class="history-time-main">${h.time}</span>` +
                `<span class="history-verdict history-verdict--${h.verdict.split(' ')[0].toLowerCase()}">${h.verdict}</span>` +
                `<button class="history-remove-btn" title="Remove from History"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`;

            div.addEventListener('click', (e) => {
                if (e.target.closest('.history-remove-btn')) {
                    evalHistory.splice(i, 1);
                    renderEvalHistory();
                    return;
                }
                if (h.solutionText) {
                    // Only switch tab if triggered from Results tab
                    const shouldSwitch = listId === 'evalHistoryList';
                    loadEvaluation(h.seed, h.solutionText, shouldSwitch);
                } else {
                    navigator.clipboard.writeText(h.seed).catch(() => { });
                }
            });
            el.appendChild(div);
        });
    };

    renderTo('evalHistoryList', 'evalHistoryWrap');
    renderTo('evalHistoryListInput', 'evalHistoryWrapInput');
    renderTo('evalHistoryListDetail', 'evalHistoryWrapDetail');
}


// --- COPY RESULTS ---
function copyResultsToClipboard() {
    if (!evaluationResult) return;
    const s = evaluationResult.stats;
    const minDiscObj = getMinDiscObj(), minDiscBox = getMinDiscBox();
    const missingMaintained = s.knownTotal - s.knownMatched;
    const effObj = s.unknownObjMatched - s.penaltyObjs;
    const effBox = s.unknownBoxMatched - s.penaltyBoxes;
    const perfect = s.knownMatched === s.knownTotal && s.unknownMatched === s.unknownTotal && s.penaltyObjs === 0 && s.penaltyBoxes === 0;
    const accepted = effObj >= minDiscObj && effBox >= minDiscBox;
    const verdict = perfect ? 'Perfect' : missingMaintained > 0 ? 'Failed (missing maintained)' : accepted ? 'Accepted' : 'Failed';
    const seed = document.getElementById('evalTaskShortId')?.textContent.trim() || 'unknown';
    const avgErr = evaluationResult.matches.length ? (evaluationResult.matches.reduce((a, m) => a + m.dist, 0) / evaluationResult.matches.length).toFixed(1) : 'N/A';
    const text = [
        `DD2419 Evaluation — ${seed}`,
        `Verdict: ${verdict}`,
        ``,
        `Maintained Obj:  ${s.knownObjMatched}/${s.knownObjTotal}`,
        `Maintained Box:  ${s.knownBoxMatched}/${s.knownBoxTotal}`,
        `Discovered Obj:  ${s.unknownObjMatched}  (−${s.penaltyObjs} pen → ${effObj} net, need ≥${minDiscObj})`,
        `Discovered Box:  ${s.unknownBoxMatched}  (−${s.penaltyBoxes} pen → ${effBox} net, need ≥${minDiscBox})`,
        `Avg match error: ${avgErr} cm  (threshold ${getThreshold()} cm)`,
    ].join('\n');
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copySummaryBtn');
        if (btn) {
            btn.classList.add('copied');
            setTimeout(() => btn.classList.remove('copied'), 1800);
        }
    }).catch(() => { });
}

function resetEvalDefaults() {
    document.getElementById('evalThreshold').value = 20;
    document.getElementById('minDiscObj').value = 2;
    document.getElementById('minDiscBox').value = 1;
    if (evaluationResult) {
        runTaskEvaluation(false);
    }
}

function getThreshold() { return Math.max(0, parseInt(document.getElementById('evalThreshold')?.value) || 20); }
function getMinDiscObj() { const v = parseInt(document.getElementById('minDiscObj')?.value); return isNaN(v) ? 2 : Math.max(0, v); }
function getMinDiscBox() { const v = parseInt(document.getElementById('minDiscBox')?.value); return isNaN(v) ? 1 : Math.max(0, v); }

function getHoverNearestDist(item) {
    if (!evaluationResult || !evalData) return null;
    const ref = item._ref || item;
    const dist2 = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    if (item._label?.startsWith('Missing')) {
        const matchedSols = new Set(evaluationResult.matches.map(m => m.sol));
        const ds = evalData.solution.filter(s => !matchedSols.has(s)).map(s => dist2(ref, s));
        return ds.length ? Math.min(...ds) : null;
    } else if (item._label?.startsWith('Penalty')) {
        const matchedGTs = new Set(evaluationResult.matches.map(m => m.gt));
        const ds = [...evalData.gt.known, ...evalData.gt.unknown].filter(g => !matchedGTs.has(g)).map(g => dist2(ref, g));
        return ds.length ? Math.min(...ds) : null;
    }
    return null;
}

// --- CSS COLOR RESOLVER ---
// getPropertyValue() on custom properties returns the raw token string (e.g. "light-dark(...)"),
// which canvas and SVG don't understand. Applying the var() to a real CSS property forces the
// browser to evaluate light-dark() and return a concrete color string.
const _cssColorProbe = document.createElement('span');
_cssColorProbe.style.cssText = 'position:fixed;pointer-events:none;opacity:0;';
// Script is at end of <body> so document.body exists — append immediately.
document.body.appendChild(_cssColorProbe);

function resolveCSSColor(varName) {
    _cssColorProbe.style.color = `var(${varName})`;
    return getComputedStyle(_cssColorProbe).color;
}

// --- UTILS ---
let currentSeed = null;
let prng = null;

function mulberry32(a) {
    return function () {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

function setSeed(s) {
    currentSeed = parseInt(s);
    prng = mulberry32(currentSeed);
}

function getRand() { return prng ? prng() : Math.random(); }

function hashString(str) {
    if (!str) return '0000';
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).slice(-4);
}

async function loadEvaluation(taskId, solutionText, switchToResults = true) {
    const ok = await loadTaskFromId(taskId);
    if (!ok) return;

    const h = hashString(solutionText);
    currentEvalHash = h;
    const solNameEl = document.querySelector('.file-drop-name');
    if (solNameEl) solNameEl.textContent = "Loaded Solution (hash: " + h + ")";

    switchMode('evaluate');
    await runTaskEvaluation(switchToResults, solutionText, false);
}


function copyCanvasToClipboard() {
    const canvas = document.getElementById('mapCanvas');
    canvas.toBlob(blob => {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            .then(() => {
                const btn = document.getElementById('btnCopyCanvas');
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 1800);
            })
            .catch(() => { });
    }, 'image/png');
}

function copySeed() {
    const id = currentTask?.taskId;
    if (!id) return;
    navigator.clipboard.writeText(id).then(() => {
        const btn = document.getElementById('copySeedBtn');
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 2000);
    }).catch(err => {
        console.error("Failed to copy task ID: ", err);
    });
}
function randomInt(min, max) { return Math.floor(getRand() * (max - min + 1)) + min; }
function sample(array, n) {
    const arr = [...array];
    const result = [];
    for (let i = 0; i < n; i++) {
        const idx = Math.floor(getRand() * arr.length);
        result.push(arr.splice(idx, 1)[0]);
    }
    return result;
}

function rotatePoint(x, y, angleRad) {
    return {
        x: x * Math.cos(angleRad) - y * Math.sin(angleRad),
        y: x * Math.sin(angleRad) + y * Math.cos(angleRad)
    };
}

function applyTransform(item, translate, angleRad) {
    const r = rotatePoint(item.x, item.y, angleRad);
    return {
        ...item,
        x: r.x + translate.x,
        y: r.y + translate.y,
        angle: item.angle + (angleRad * 180 / Math.PI)
    };
}

function invertTransform(item, translate, angleRad) {
    const x = item.x - translate.x;
    const y = item.y - translate.y;
    const r = rotatePoint(x, y, -angleRad);
    return {
        ...item,
        x: r.x,
        y: r.y,
        angle: item.angle - (angleRad * 180 / Math.PI)
    };
}

function invertTransformPoint(p, translate, angleRad) {
    const x = p.x - translate.x;
    const y = p.y - translate.y;
    return rotatePoint(x, y, -angleRad);
}

function invertTransform(item, translate, angleRad) {
    const x = item.x - translate.x;
    const y = item.y - translate.y;
    const r = rotatePoint(x, y, -angleRad);
    return {
        ...item,
        x: r.x,
        y: r.y,
        angle: item.angle - (angleRad * 180 / Math.PI)
    };
}

function invertTransformPoint(p, translate, angleRad) {
    const x = p.x - translate.x;
    const y = p.y - translate.y;
    return rotatePoint(x, y, -angleRad);
}

function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 1) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const obj = {};
        headers.forEach((h, i) => {
            const val = values[i];
            obj[h] = isNaN(val) ? val : parseFloat(val);
        });
        return obj;
    });
}

// --- TASK ID (base64-gzipped compact CSV) ---
// Encodes workspace + GT into a compact, version-stable identifier.
// Workspace rows have 2 fields (x,y). GT rows have type prefix:
//   S=start, O/B=known obj/box, o/b=unknown obj/box, X=obstacle
async function buildTaskId(task) {
    const d = task.transformed;
    const tr = task.transform;
    const lines = [];
    // Store transform so it can be restored on load
    const angleDeg = (tr?.angleRad ?? 0) * 180 / Math.PI;
    lines.push(`T,${csvFmt(tr?.translate?.x ?? 0)},${csvFmt(tr?.translate?.y ?? 0)},${csvFmt(angleDeg)}`);
    d.workspace.forEach(p => lines.push(`${csvFmt(p.x)},${csvFmt(p.y)}`));
    lines.push(csvItemRow('S', d.startPose.x, d.startPose.y, d.startPose.angle));
    d.knownObjs.forEach(o => lines.push(csvItemRow('O', o.x, o.y, o.angle)));
    d.knownBoxes.forEach(b => lines.push(csvItemRow('B', b.x, b.y, b.angle)));
    d.unknownObjs.forEach(o => lines.push(csvItemRow('o', o.x, o.y, o.angle)));
    d.unknownBoxes.forEach(b => lines.push(csvItemRow('b', b.x, b.y, b.angle)));
    d.obstacles.forEach(p => lines.push(csvItemRow('X', p.x, p.y, 0)));
    const bytes = new TextEncoder().encode(lines.join('\n'));
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(bytes); writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    let bin = '';
    new Uint8Array(buf).forEach(b => bin += String.fromCharCode(b));
    // URL-safe base64 (no +, /, = — safe for URLs, filenames, CSV first line)
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function decodeTaskId(b64) {
    const std = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = std + '='.repeat((4 - std.length % 4) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes); writer.close();
    return await new Response(ds.readable).text();
}

function parseTaskIdText(text) {
    const workspace = [], gtKnown = [], gtUnknown = [], obstacles = [];
    let start = null;
    let savedTransform = null;
    for (const line of text.trim().split('\n')) {
        const parts = line.split(',');
        if (parts[0] === 'T' && parts.length >= 4) {
            savedTransform = { tx: parseFloat(parts[1]), ty: parseFloat(parts[2]), angleDeg: parseFloat(parts[3]) };
        } else if (parts.length === 2) {
            workspace.push({ x: parseFloat(parts[0]), y: parseFloat(parts[1]) });
        } else {
            const t = parts[0], x = parseFloat(parts[1]), y = parseFloat(parts[2]);
            const angle = parts.length >= 4 ? parseFloat(parts[3]) : 0;
            const item = { Type: t.toUpperCase(), x, y, angle };
            if (t === 'S') start = item;
            else if (t === 'X') obstacles.push(item);
            else if (t === t.toUpperCase()) gtKnown.push(item);  // uppercase = known
            else gtUnknown.push(item);                            // lowercase = unknown
        }
    }
    return { workspace, start, gtKnown, gtUnknown, obstacles, savedTransform };
}

// Short display ID: skip the constant gzip header prefix (~12 base64 chars) and use 8 unique chars
function taskShortId() { return currentTask?.taskId?.slice(12, 20) ?? ''; }

// --- HUNGARIAN ALGORITHM ---
// Returns r90/r90p functions that apply a 90° CCW rotation if the workspace is landscape (W > H)
function makeRot90(workspace) {
    const xs = workspace.map(p => p.x), ys = workspace.map(p => p.y);
    const rot = (Math.max(...xs) - Math.min(...xs)) > (Math.max(...ys) - Math.min(...ys));
    const r90 = i => rot ? { ...i, x: -i.y, y: i.x, ...(i.angle != null ? { angle: i.angle + 90 } : {}) } : i;
    const r90p = p => rot ? { x: -p.y, y: p.x } : p;
    return { r90, r90p };
}

function pointToSegmentDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.sqrt((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2);
}

function hungarianAlgorithm(matrix) {
    let n = matrix.length; let m = matrix[0].length;
    if (n === 0 || m === 0) return [];
    let transposed = false;
    if (n > m) { matrix = matrix[0].map((_, colIdx) => matrix.map(row => row[colIdx]));[n, m] = [m, n]; transposed = true; }
    let u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
        p[0] = i; let j0 = 0, minv = new Array(m + 1).fill(Infinity), used = new Array(m + 1).fill(false);
        do {
            used[j0] = true; let i0 = p[j0], delta = Infinity, j1 = 0;
            for (let j = 1; j <= m; j++) {
                if (!used[j]) {
                    let cur = matrix[i0 - 1][j - 1] - u[i0] - v[j];
                    if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                    if (minv[j] < delta) { delta = minv[j]; j1 = j; }
                }
            }
            for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
            j0 = j1;
        } while (p[j0] !== 0);
        do { let j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 !== 0);
    }
    let result = [];
    for (let j = 1; j <= m; j++) { if (p[j] !== 0) { if (transposed) result.push([j - 1, p[j] - 1]); else result.push([p[j] - 1, j - 1]); } }
    return result;
}

// --- ACTIONS ---
// --- THEME ---
function initTheme() {
    const theme = localStorage.getItem('theme') || 'auto';
    if (theme === 'auto') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
    updateThemeIcon(theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'auto';
    let next = 'auto';
    if (current === 'auto') next = 'dark';
    else if (current === 'dark') next = 'light';
    else next = 'auto';

    if (next === 'auto') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', next);
    }
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
    draw();
}

function updateThemeIcon(theme) {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    if (theme === 'dark') {
        btn.textContent = '🌙';
        btn.title = 'Theme: Dark (Click for Auto)';
    } else if (theme === 'light') {
        btn.textContent = '☀️';
        btn.title = 'Theme: Light (Click for Dark)';
    } else {
        btn.textContent = '🖥️';
        btn.title = 'Theme: Auto (Click for Light)';
    }
}

function switchMode(mode) {
    if (mode === currentMode) return;
    const prevMode = currentMode;
    currentMode = mode;
    panelHoverItem = null;
    pinnedItem = null;
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    document.getElementById('generateControls').classList.toggle('hidden', mode !== 'generate');
    document.getElementById('evaluateControls').classList.toggle('hidden', mode !== 'evaluate');

    // Update tabs and canvas state
    const tabsEl = document.querySelector('.tabs');
    const tabSeedBadge = document.getElementById('tabSeedBadge');
    if (mode === 'generate') {
        tabsEl.classList.remove('hidden');
        const tabs = document.querySelectorAll('.tab-btn[data-tab]');
        tabs[0].textContent = 'Ground Truth'; tabs[0].dataset.tab = 'truth';
        tabs[1].textContent = 'Known'; tabs[1].dataset.tab = 'known';
        tabs[2].textContent = 'Placement Guide'; tabs[2].dataset.tab = 'placement';
        currentView = lastGenerateView;
        document.getElementById('btnSaveAll').classList.toggle('hidden', !currentTask);
        document.getElementById('btnSaveEval').classList.add('hidden');
        document.getElementById('btnSaveSolution').classList.add('hidden');
        tabSeedBadge.classList.toggle('hidden', !currentTask);
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === currentView));
    } else {
        tabsEl.classList.add('hidden');
        document.getElementById('btnSaveAll').classList.add('hidden');
        document.getElementById('btnSaveEval').classList.toggle('hidden', !evaluationResult);
        document.getElementById('btnSaveSolution')?.classList.toggle('hidden', !lastRawSolution);
        if (prevMode === 'generate') lastGenerateView = currentView;
        currentView = 'all';
        tabSeedBadge.classList.add('hidden');
        // Reset single-file seed UI
        document.getElementById('seedExtracted')?.classList.add('hidden');
        document.getElementById('seedManualEntry')?.classList.add('hidden');
        switchEvalSidebarTab(lastEvalTab);
    }
    updateLegend();
    draw();
}

async function generateTask() {
    // UI Parameters
    const params = {
        nkO: parseInt(document.getElementById('knownObjects').value),
        nuO: parseInt(document.getElementById('unknownObjects').value),
        nkB: parseInt(document.getElementById('knownBoxes').value),
        nuB: parseInt(document.getElementById('unknownBoxes').value),
        nObs: parseInt(document.getElementById('obstaclesCount').value),
    };

    const txVal = parseFloat(document.getElementById('transformX').value) || 0;
    const tyVal = parseFloat(document.getElementById('transformY').value) || 0;
    const taDeg = parseFloat(document.getElementById('transformAngle').value) || 0;
    const translate = { x: txVal, y: tyVal };
    const angleRad = taDeg * Math.PI / 180;

    setSeed(Math.floor(Math.random() * 1000000));

    currentTask = recreateTask(params.nkO, params.nuO, params.nkB, params.nuB, params.nObs, translate, angleRad);
    currentTask.taskId = await buildTaskId(currentTask);


    document.getElementById('tabSeedBadge').classList.remove('hidden');
    animateTaskIn();
    document.getElementById('btnSaveAll').classList.remove('hidden');
    updateSaveTooltips();
    resetViewport();
    history.replaceState(null, '', '#' + currentTask.taskId);
    draw();
    pushRecentSeed(currentTask.taskId);
}

function updateSaveTooltips() { }

/** Recreates task data given parameters and an active PRNG.
 *  obsSeed: if provided, obstacles use this independent seed instead of the main PRNG,
 *           allowing obstacle-only re-rolls without changing anything else. */
function recreateTask(nkO, nuO, nkB, nuB, nObs, translate = { x: 0, y: 0 }, angleRad = 0, obsSeed = null) {

    // 2. Start pose
    const startPose = sample(START_POSES, 1)[0];

    // 3. Boxes
    const allBoxes = sample(BOXES, nkB + nuB);
    const knownBoxes = allBoxes.slice(0, nkB);
    const unknownBoxes = allBoxes.slice(nkB);

    // 4. Objects
    const allObjs = sample(OBJECTS, nkO + nuO);
    const knownObjs = allObjs.slice(0, nkO);
    const unknownObjs = allObjs.slice(nkO);

    // 5. Obstacles — use a separate PRNG so they can be re-rolled independently
    const resolvedObsSeed = obsSeed ?? Math.floor(getRand() * 1000000);
    const obsRng = mulberry32(resolvedObsSeed);
    const obsRandomInt = (min, max) => Math.floor(obsRng() * (max - min + 1)) + min;

    const obstacles = [];
    const forbidden = [startPose, ...allObjs, ...allBoxes];
    let attempts = 0;
    while (obstacles.length < nObs && attempts < 100) {
        const obs = { x: obsRandomInt(OBSTACLE_X_RANGE[0], OBSTACLE_X_RANGE[1]), y: obsRandomInt(OBSTACLE_Y_RANGE[0], OBSTACLE_Y_RANGE[1]) };
        const tooClose = forbidden.some(f => Math.sqrt((f.x - obs.x) ** 2 + (f.y - obs.y) ** 2) < OBSTACLE_DISTANCE_THRESHOLD) ||
            obstacles.some(o => Math.sqrt((o.x - obs.x) ** 2 + (o.y - obs.y) ** 2) < OBSTACLE_DISTANCE_THRESHOLD);
        if (!tooClose) obstacles.push(obs);
        attempts++;
    }

    const transform = (i) => applyTransform(i, translate, angleRad);
    const transformPoint = (p) => { const r = rotatePoint(p.x, p.y, angleRad); return { x: r.x + translate.x, y: r.y + translate.y }; };
    return {
        seed: currentSeed, obsSeed: resolvedObsSeed,
        params: { nkO, nuO, nkB, nuB, nObs },
        transform: { translate, angleRad },
        base: { workspace: WORKSPACE_DATA, startPose, knownObjs, unknownObjs, knownBoxes, unknownBoxes, obstacles },
        transformed: {
            workspace: WORKSPACE_DATA.map(transformPoint),
            startPose: transform(startPose),
            knownObjs: knownObjs.map(transform), unknownObjs: unknownObjs.map(transform),
            knownBoxes: knownBoxes.map(transform), unknownBoxes: unknownBoxes.map(transform),
            obstacles: obstacles.map(transformPoint)
        }
    };
}

function animateTaskIn() {
    const canvas = document.getElementById('mapCanvas');
    canvas.style.opacity = '0';
    requestAnimationFrame(() => { canvas.style.opacity = '1'; });
}

/** Re-applies the stored transform from base → transformed after a manual placement edit. */
async function applyItemInputs() {
    if (!currentTask) return;
    const base = currentTask.base;
    const p = currentTask.params;

    const nkO = parseInt(document.getElementById('knownObjects').value) || 0;
    const nuO = parseInt(document.getElementById('unknownObjects').value) || 0;
    const nkB = parseInt(document.getElementById('knownBoxes').value) || 0;
    const nuB = parseInt(document.getElementById('unknownBoxes').value) || 0;
    const nObs = parseInt(document.getElementById('obstaclesCount').value) || 0;

    // Adjust an item list toward target, removing from end or adding from unused pool entries
    function adjustFromPool(list, target, pool, getUsed) {
        if (list.length > target) { list.splice(target); return; }
        while (list.length < target) {
            const used = getUsed();
            const available = pool.filter(pi => !used.some(u => Math.hypot(u.x - pi.x, u.y - pi.y) < 1));
            if (!available.length) break;
            list.push({ ...available[Math.floor(Math.random() * available.length)] });
        }
    }

    adjustFromPool(base.knownObjs, nkO, OBJECTS, () => [...base.knownObjs, ...base.unknownObjs]);
    adjustFromPool(base.unknownObjs, nuO, OBJECTS, () => [...base.knownObjs, ...base.unknownObjs]);
    adjustFromPool(base.knownBoxes, nkB, BOXES, () => [...base.knownBoxes, ...base.unknownBoxes]);
    adjustFromPool(base.unknownBoxes, nuB, BOXES, () => [...base.knownBoxes, ...base.unknownBoxes]);

    if (base.obstacles.length > nObs) {
        base.obstacles.splice(nObs);
    } else {
        const forbidden = [base.startPose, ...base.knownObjs, ...base.unknownObjs, ...base.knownBoxes, ...base.unknownBoxes];
        let attempts = 0;
        while (base.obstacles.length < nObs && attempts < 200) {
            const obs = {
                x: Math.round(OBSTACLE_X_RANGE[0] + Math.random() * (OBSTACLE_X_RANGE[1] - OBSTACLE_X_RANGE[0])),
                y: Math.round(OBSTACLE_Y_RANGE[0] + Math.random() * (OBSTACLE_Y_RANGE[1] - OBSTACLE_Y_RANGE[0]))
            };
            if (![...forbidden, ...base.obstacles].some(f => Math.hypot(f.x - obs.x, f.y - obs.y) < OBSTACLE_DISTANCE_THRESHOLD))
                base.obstacles.push(obs);
            attempts++;
        }
    }

    // Reflect actual counts back (pool may be exhausted)
    p.nkO = base.knownObjs.length; document.getElementById('knownObjects').value = p.nkO;
    p.nuO = base.unknownObjs.length; document.getElementById('unknownObjects').value = p.nuO;
    p.nkB = base.knownBoxes.length; document.getElementById('knownBoxes').value = p.nkB;
    p.nuB = base.unknownBoxes.length; document.getElementById('unknownBoxes').value = p.nuB;
    p.nObs = base.obstacles.length; document.getElementById('obstaclesCount').value = p.nObs;

    // Always re-read transform from inputs so new items are transformed into the correct space
    const tx = parseFloat(document.getElementById('transformX').value) || 0;
    const ty = parseFloat(document.getElementById('transformY').value) || 0;
    const ar = (parseFloat(document.getElementById('transformAngle').value) || 0) * Math.PI / 180;
    currentTask.transform = { translate: { x: tx, y: ty }, angleRad: ar };

    syncTransformedFromBase();
    currentTask.taskId = await buildTaskId(currentTask);
    history.replaceState(null, '', '#' + currentTask.taskId);
    draw();
}

function applyTransformInputs() {
    if (!currentTask) return;
    const tx = parseFloat(document.getElementById('transformX').value) || 0;
    const ty = parseFloat(document.getElementById('transformY').value) || 0;
    const angleRad = (parseFloat(document.getElementById('transformAngle').value) || 0) * Math.PI / 180;
    currentTask.transform = { translate: { x: tx, y: ty }, angleRad };
    syncTransformedFromBase();
    buildTaskId(currentTask).then(id => {
        currentTask.taskId = id;
        history.replaceState(null, '', '#' + id);
    });
    draw();
}

function syncTransformedFromBase() {
    const { translate, angleRad } = currentTask.transform;
    const t = i => applyTransform(i, translate, angleRad);
    const tp = p => { const r = rotatePoint(p.x, p.y, angleRad); return { x: r.x + translate.x, y: r.y + translate.y }; };
    const b = currentTask.base;
    currentTask.transformed = {
        workspace: b.workspace.map(tp),
        startPose: t(b.startPose),
        knownObjs: b.knownObjs.map(t), unknownObjs: b.unknownObjs.map(t),
        knownBoxes: b.knownBoxes.map(t), unknownBoxes: b.unknownBoxes.map(t),
        obstacles: b.obstacles.map(tp)
    };
}

function syncPlacementInputs() {
    const b = currentTask?.base;
    if (!b) return;
    const el = id => document.getElementById(id);
    if (el('knownObjects')) el('knownObjects').value = b.knownObjs.length;
    if (el('unknownObjects')) el('unknownObjects').value = b.unknownObjs.length;
    if (el('knownBoxes')) el('knownBoxes').value = b.knownBoxes.length;
    if (el('unknownBoxes')) el('unknownBoxes').value = b.unknownBoxes.length;
    if (el('obstaclesCount')) el('obstaclesCount').value = b.obstacles.length;
}

async function handlePlacementClick(item) {
    if (!currentTask) return;
    const base = currentTask.base;

    // Check start pose click → cycle poses at/near this position
    // For consolidated pose groups, item.x/y is the position; find all poses at that position
    const posePoses = START_POSES.filter(p => p.x === item.x && p.y === item.y);
    if (posePoses.length > 0) {
        if (posePoses.length > 1) {
            const curIdx = posePoses.findIndex(p => p.x === base.startPose.x && p.y === base.startPose.y && p.angle === base.startPose.angle);
            base.startPose = { ...posePoses[(curIdx >= 0 ? curIdx + 1 : 0) % posePoses.length] };
        } else {
            base.startPose = { ...posePoses[0] };
        }
        // Update hoverItem to reflect new active state immediately
        if (hoverItem) {
            const newActive = base.startPose;
            hoverItem._label = 'Start Pose (active)';
            hoverItem.angle = newActive.angle;
            if (hoverItem._poseAngles) {
                hoverItem._poseAngles = posePoses.map(p => ({ angle: p.angle, isActive: p.angle === newActive.angle }));
            }
        }
        syncTransformedFromBase();
        currentTask.taskId = await buildTaskId(currentTask);
        history.replaceState(null, '', '#' + currentTask.taskId);
        draw();
        return;
    }

    // Check object click → cycle known → unknown → unused → known
    const matchedObj = OBJECTS.find(o => o.x === item.x && o.y === item.y);
    if (matchedObj) {
        const isKnown = base.knownObjs.some(o => o.x === matchedObj.x && o.y === matchedObj.y);
        const isUnknown = base.unknownObjs.some(o => o.x === matchedObj.x && o.y === matchedObj.y);
        if (isKnown) {
            base.knownObjs = base.knownObjs.filter(o => !(o.x === matchedObj.x && o.y === matchedObj.y));
            base.unknownObjs = [...base.unknownObjs, { ...matchedObj, Type: 'O' }];
            if (hoverItem) hoverItem._label = 'Unknown Object';
        } else if (isUnknown) {
            base.unknownObjs = base.unknownObjs.filter(o => !(o.x === matchedObj.x && o.y === matchedObj.y));
            if (hoverItem) hoverItem._label = 'Unused Object';
        } else {
            base.knownObjs = [...base.knownObjs, { ...matchedObj, Type: 'O' }];
            if (hoverItem) hoverItem._label = 'Known Object';
        }
        syncPlacementInputs();
        syncTransformedFromBase();
        currentTask.taskId = await buildTaskId(currentTask);
        history.replaceState(null, '', '#' + currentTask.taskId);
        draw();
        return;
    }

    // Check box click → cycle known → unknown → unused → known
    const matchedBox = BOXES.find(b => b.x === item.x && b.y === item.y);
    if (matchedBox) {
        const isKnown = base.knownBoxes.some(b => b.x === matchedBox.x && b.y === matchedBox.y);
        const isUnknown = base.unknownBoxes.some(b => b.x === matchedBox.x && b.y === matchedBox.y);
        if (isKnown) {
            base.knownBoxes = base.knownBoxes.filter(b => !(b.x === matchedBox.x && b.y === matchedBox.y));
            base.unknownBoxes = [...base.unknownBoxes, { ...matchedBox, Type: 'B' }];
            if (hoverItem) hoverItem._label = 'Unknown Box';
        } else if (isUnknown) {
            base.unknownBoxes = base.unknownBoxes.filter(b => !(b.x === matchedBox.x && b.y === matchedBox.y));
            if (hoverItem) hoverItem._label = 'Unused Box';
        } else {
            base.knownBoxes = [...base.knownBoxes, { ...matchedBox, Type: 'B' }];
            if (hoverItem) hoverItem._label = 'Known Box';
        }
        syncPlacementInputs();
        syncTransformedFromBase();
        currentTask.taskId = await buildTaskId(currentTask);
        history.replaceState(null, '', '#' + currentTask.taskId);
        draw();
        return;
    }

    // Check obstacle click → remove
    const obsIdx = base.obstacles.findIndex(o => o.x === item.x && o.y === item.y);
    if (obsIdx >= 0) {
        base.obstacles.splice(obsIdx, 1);
        syncPlacementInputs();
        hoverItem = null;
        syncTransformedFromBase();
        currentTask.taskId = await buildTaskId(currentTask);
        history.replaceState(null, '', '#' + currentTask.taskId);
        draw();
    }
}


/** Converts a mouse event to world coordinates using the WORKSPACE_DATA coordinate system. */
function canvasEventToWorld(e) {
    const canvas = document.getElementById('mapCanvas');
    const rect = canvas.getBoundingClientRect();
    const ws = WORKSPACE_DATA;
    const minX = Math.min(...ws.map(p => p.x)), maxX = Math.max(...ws.map(p => p.x));
    const minY = Math.min(...ws.map(p => p.y)), maxY = Math.max(...ws.map(p => p.y));
    const pad = 120;
    const dataW = maxX - minX + pad * 2, dataH = maxY - minY + pad * 2;
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / dataW, H / dataH);
    const offX = (W - dataW * scale) / 2;
    const offY = (H - dataH * scale) / 2;
    const scaleX = W / rect.width, scaleY = H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const pivX = W / 2, pivY = H / 2;
    const ucx = (cx - pivX - vpPanX * scaleX) / vpZoom + pivX;
    const ucy = (cy - pivY - vpPanY * scaleY) / vpZoom + pivY;
    return { x: (ucx - offX) / scale + minX - pad, y: maxY - (ucy - offY) / scale + pad };
}

function regenerateObstacles() {
    if (!currentTask) return;
    const p = currentTask.params;
    setSeed(currentTask.seed);
    const newObsSeed = Math.floor(Math.random() * 1000000);
    const { translate, angleRad } = currentTask.transform;
    currentTask = recreateTask(p.nkO, p.nuO, p.nkB, p.nuB, p.nObs, translate, angleRad, newObsSeed);
    animateTaskIn();
    draw();
}


async function runTaskEvaluation(switchToResults = true, overrideRaw = null, addToHistory = true) {
    let raw;
    if (overrideRaw) {
        raw = overrideRaw;
    } else {
        const solFile = document.getElementById('seedSolutionFile').files[0];
        if (!solFile) {
            if (lastRawSolution) {
                raw = lastRawSolution;
            } else {
                alert("Please upload a solution file.");
                return;
            }
        } else {
            const readText = f => new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsText(f); });
            raw = await readText(solFile);
        }
    }
    const lines = raw.trim().split('\n');
    lastRawSolution = raw;
    currentEvalHash = hashString(raw);

    // First line is the taskId; remaining lines are the CSV (header + solution rows)
    const resolvedId = lines[0].trim();
    const csvBody = lines.slice(1).join('\n');

    if (!resolvedId || !/^[A-Za-z0-9\-_]{50,}$/.test(resolvedId)) {
        alert("No valid task ID found in the first line of the solution file.");
        return;
    }

    let taskData;
    try {
        const decoded = await decodeTaskId(resolvedId);
        taskData = parseTaskIdText(decoded);
    } catch (e) {
        alert("Failed to decode task ID from the first line of the solution file.");
        return;
    }

    const { workspace, start, gtKnown, gtUnknown, obstacles, savedTransform } = taskData;

    const invT = (i) => {
        if (!savedTransform) return i;
        return invertTransform(i, { x: savedTransform.tx, y: savedTransform.ty }, savedTransform.angleDeg * Math.PI / 180);
    };
    const invTP = (p) => {
        if (!savedTransform) return p;
        return invertTransformPoint(p, { x: savedTransform.tx, y: savedTransform.ty }, savedTransform.angleDeg * Math.PI / 180);
    };

    const baseWS = workspace.map(invTP);
    const { r90, r90p } = makeRot90(baseWS);

    const withCsv = item => {
        const inv = invT(item);
        const rot = r90(inv);
        return { ...rot, _csvX: item.x, _csvY: item.y, _uid: detailUIDCounter++ };
    };

    const gt = {
        known: gtKnown.map(withCsv),
        unknown: gtUnknown.map(withCsv),
        obstacles: obstacles.map(p => r90p(invTP(p))),
        start: start ? r90(invT(start)) : null
    };

    const solData = parseCSV(csvBody).filter(i => i.Type === 'O' || i.Type === 'B');
    const solItems = solData.map(withCsv);

    // Ensure currentTask is synced for history logging
    if (!currentTask) currentTask = {};
    currentTask.taskId = resolvedId;

    performEvaluation(baseWS.map(r90p), gt, solItems, switchToResults, addToHistory);

    // Update recentSeeds solutionText
    const rs = recentSeeds.find(r => r.taskId === resolvedId);
    if (rs) {
        rs.solutionText = raw;
        localStorage.setItem('dd2419_recent_seeds', JSON.stringify(recentSeeds));
        renderRecentSeeds();
    }
}

function saveSolution() {
    if (!lastRawSolution) return;
    const blob = new Blob([lastRawSolution], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'solution.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi))
            inside = !inside;
    }
    return inside;
}

function performEvaluation(workspace, gt, solution, switchToResults = true, addToHistory = true) {
    const inWS = (i) => pointInPolygon(i, workspace);
    const solItems = solution;
    const solEligible = solItems.filter(inWS);
    const thresh = getThreshold();
    const matchType = (type, gtL) => {
        const solL = solEligible.filter(i => i.Type === type);
        if (!gtL.length || !solL.length) return [];
        const matrix = gtL.map(g => solL.map(s => {
            const d = Math.sqrt((g.x - s.x) ** 2 + (g.y - s.y) ** 2);
            return d > thresh ? thresh * 10 : d;
        }));
        return hungarianAlgorithm(matrix).map(([gi, si]) => ({ gt: gtL[gi], sol: solL[si], dist: Math.sqrt((gtL[gi].x - solL[si].x) ** 2 + (gtL[gi].y - solL[si].y) ** 2) }))
            .filter(m => m.dist <= thresh);
    };

    const matches = [...matchType('O', gt.known.filter(i => i.Type === 'O').concat(gt.unknown.filter(i => i.Type === 'O'))),
    ...matchType('B', gt.known.filter(i => i.Type === 'B').concat(gt.unknown.filter(i => i.Type === 'B')))];

    const knownGTSet2 = new Set(gt.known);
    const matchedSolSet2 = new Set(matches.map(m => m.sol));
    const knownObjMatched = matches.filter(m => knownGTSet2.has(m.gt) && m.gt.Type === 'O').length;
    const knownBoxMatched = matches.filter(m => knownGTSet2.has(m.gt) && m.gt.Type === 'B').length;
    const unknownObjMatched = matches.filter(m => !knownGTSet2.has(m.gt) && m.gt.Type === 'O').length;
    const unknownBoxMatched = matches.filter(m => !knownGTSet2.has(m.gt) && m.gt.Type === 'B').length;
    const penaltyObjs = solItems.filter(i => !matchedSolSet2.has(i) && i.Type === 'O').length;
    const penaltyBoxes = solItems.filter(i => !matchedSolSet2.has(i) && i.Type === 'B').length;

    evalData = { workspace, gt, solution: solItems };
    evaluationResult = {
        matches,
        stats: {
            knownMatched: knownObjMatched + knownBoxMatched, knownTotal: gt.known.length,
            unknownMatched: unknownObjMatched + unknownBoxMatched, unknownTotal: gt.unknown.length,
            penalties: solItems.length - matches.length,
            avgError: matches.length ? matches.reduce((s, m) => s + m.dist, 0) / matches.length : 0,
            knownObjMatched, knownBoxMatched,
            knownObjTotal: gt.known.filter(i => i.Type === 'O').length,
            knownBoxTotal: gt.known.filter(i => i.Type === 'B').length,
            unknownObjMatched, unknownBoxMatched,
            unknownObjTotal: gt.unknown.filter(i => i.Type === 'O').length,
            unknownBoxTotal: gt.unknown.filter(i => i.Type === 'B').length,
            penaltyObjs, penaltyBoxes
        }
    };

    resetViewport();
    displayResults(addToHistory);
    if (switchToResults) switchEvalSidebarTab('results');
    else if (lastEvalTab === 'detail') buildResultsPanel();
    draw();
}

function displayResults(addToHistory = false) {
    const resDiv = document.getElementById('evaluationResults');
    const s = evaluationResult.stats;
    resDiv.classList.remove('hidden');
    document.getElementById('btnSaveEval')?.classList.remove('hidden');
    document.getElementById('btnSaveSolution')?.classList.remove('hidden');
    document.getElementById('evalSettingsDivider')?.classList.remove('hidden');
    document.getElementById('evalSettingsGrid')?.classList.remove('hidden');
    document.getElementById('evalSummaryDivider')?.classList.remove('hidden');

    const minDiscObj = getMinDiscObj();
    const minDiscBox = getMinDiscBox();

    const perfect = s.knownMatched === s.knownTotal && s.unknownMatched === s.unknownTotal && s.penalties === 0;
    const netObj = s.unknownObjMatched - s.penaltyObjs;
    const netBox = s.unknownBoxMatched - s.penaltyBoxes;
    const accepted = !perfect && (netObj >= minDiscObj) && (netBox >= minDiscBox);

    const mntObjOk = s.knownObjMatched === s.knownObjTotal;
    const mntBoxOk = s.knownBoxMatched === s.knownBoxTotal;
    const mntObjClass = mntObjOk ? 'stat-maintained' : 'stat-penalty';
    const mntBoxClass = mntBoxOk ? 'stat-maintained' : 'stat-penalty';
    const dscClass = 'stat-discovered';
    const penClass = 'stat-penalty';
    const missingMaintained = s.knownTotal - s.knownMatched;

    let verdictClass, verdictIcon, verdictText, tooltipHtml;
    if (perfect) {
        verdictClass = 'verdict-perfect'; verdictIcon = '✓'; verdictText = 'Perfect';
        tooltipHtml =
            `<div><strong>All ${s.knownTotal} known and ${s.unknownTotal} unknown GT items matched.</strong></div>` +
            `<div>No false detections (penalties).</div>`;
    } else if (missingMaintained > 0) {
        verdictClass = 'verdict-failed'; verdictIcon = '✗'; verdictText = 'Failed';
        tooltipHtml =
            `<div><strong>Automatic fail: ${missingMaintained} maintained item${missingMaintained > 1 ? 's' : ''} missing.</strong></div>` +
            `<div>All known GT items must be present in the solution.</div>`;
    } else if (accepted) {
        verdictClass = 'verdict-accepted'; verdictIcon = '✓'; verdictText = 'Accepted';
        const objOk = netObj >= minDiscObj, boxOk = netBox >= minDiscBox;
        tooltipHtml =
            `<div><strong>Accepted criteria met:</strong></div>` +
            `<div>Disc. Obj − Pen. Obj = ${s.unknownObjMatched} − ${s.penaltyObjs} = <strong>${netObj}</strong> ≥ ${minDiscObj} ${objOk ? '✓' : '✗'}</div>` +
            `<div>Disc. Box − Pen. Box = ${s.unknownBoxMatched} − ${s.penaltyBoxes} = <strong>${netBox}</strong> ≥ ${minDiscBox} ${boxOk ? '✓' : '✗'}</div>`;
    } else {
        verdictClass = 'verdict-failed'; verdictIcon = '✗'; verdictText = 'Failed';
        const objOk = netObj >= minDiscObj, boxOk = netBox >= minDiscBox;
        tooltipHtml =
            `<div><strong>Accepted criteria not met:</strong></div>` +
            `<div>Disc. Obj − Pen. Obj = ${s.unknownObjMatched} − ${s.penaltyObjs} = <strong>${netObj}</strong>, need ≥ ${minDiscObj} ${objOk ? '✓' : '✗'}</div>` +
            `<div>Disc. Box − Pen. Box = ${s.unknownBoxMatched} − ${s.penaltyBoxes} = <strong>${netBox}</strong>, need ≥ ${minDiscBox} ${boxOk ? '✓' : '✗'}</div>`;
    }

    const missingWarn = missingMaintained > 0
        ? `<div class="maintained-warning">⚠ ${missingMaintained} maintained item${missingMaintained > 1 ? 's' : ''} missing from solution — this is a critical error</div>`
        : '';

    resDiv.innerHTML = `
        <div class="eval-stats-grid">
            <div class="stat-card ${mntObjClass}">
                <div class="stat-label">Maint. Obj</div>
                <div class="stat-fraction"><span class="stat-value">${s.knownObjMatched}</span><span class="stat-total">/${s.knownObjTotal}</span></div>
            </div>
            <div class="stat-card ${mntBoxClass}">
                <div class="stat-label">Maint. Box</div>
                <div class="stat-fraction"><span class="stat-value">${s.knownBoxMatched}</span><span class="stat-total">/${s.knownBoxTotal}</span></div>
            </div>
            <div class="stat-card ${dscClass}">
                <div class="stat-label">Disc. Obj</div>
                <div class="stat-fraction"><span class="stat-value">${s.unknownObjMatched}</span><span class="stat-total">/${s.unknownObjTotal}</span></div>
            </div>
            <div class="stat-card ${dscClass}">
                <div class="stat-label">Disc. Box</div>
                <div class="stat-fraction"><span class="stat-value">${s.unknownBoxMatched}</span><span class="stat-total">/${s.unknownBoxTotal}</span></div>
            </div>
            <div class="stat-card ${penClass}">
                <div class="stat-label">Pen. Obj</div>
                <div class="stat-fraction"><span class="stat-value">${s.penaltyObjs}</span></div>
            </div>
            <div class="stat-card ${penClass}">
                <div class="stat-label">Pen. Box</div>
                <div class="stat-fraction"><span class="stat-value">${s.penaltyBoxes}</span></div>
            </div>
        </div>
        <div class="eval-avg-error">Avg Error: <strong>${s.avgError.toFixed(1)} cm</strong></div>
        ${missingWarn}
        <div class="verdict-box ${verdictClass} verdict-has-tip">
            ${verdictIcon} ${verdictText}
            <div class="verdict-tooltip">${tooltipHtml}</div>
        </div>
    `;

    // Trigger verdict animation
    requestAnimationFrame(() => {
        const vEl = resDiv.querySelector('.verdict-box');
        if (vEl) { vEl.classList.remove('verdict-pulse'); void vEl.offsetWidth; vEl.classList.add('verdict-pulse'); }
    });

    if (addToHistory) {
        const seed = currentTask?.taskId || 'unknown';
        pushEvalHistory(seed, verdictText, lastRawSolution);
    }
    renderEvalHistory();
}

function buildResultsPanel() {
    const container = document.getElementById('evalDetailedResults');
    if (!container) return;
    if (!evaluationResult || !evalData) {
        container.innerHTML = `<div class="eval-detail-empty">Run an evaluation first.</div>`;
        return;
    }

    const getC = resolveCSSColor;
    const matchKnownColor = getC('--viz-match-known');
    const matchUnknownColor = getC('--viz-match-unknown');
    const missingColorStr = getC('--viz-missing');
    const penaltyColorStr = getC('--viz-penalty');

    const knownGTSet = new Set(evalData.gt.known);
    const matchedGTSet = new Set(evaluationResult.matches.map(m => m.gt));
    const matchedSolSet = new Set(evaluationResult.matches.map(m => m.sol));

    // Build sections
    const maintainedMatches = evaluationResult.matches.filter(m => knownGTSet.has(m.gt)).sort((a, b) => a.dist - b.dist);
    const discoveredMatches = evaluationResult.matches.filter(m => !knownGTSet.has(m.gt)).sort((a, b) => a.dist - b.dist);
    const missingUnknownItems = evalData.gt.unknown.filter(i => !matchedGTSet.has(i));
    const missingKnownItems = evalData.gt.known.filter(i => !matchedGTSet.has(i));
    const allMissingItems = [...missingUnknownItems, ...missingKnownItems];
    const penaltyItems = evalData.solution.filter(i => !matchedSolSet.has(i));

    // Compute nearest dist for missing/penalty for sorting
    const dist2 = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    const nearestForMissing = (item) => {
        const ds = penaltyItems.map(s => dist2(item, s));
        return ds.length ? Math.min(...ds) : null;
    };
    const nearestForPenalty = (item) => {
        const ds = allMissingItems.map(g => dist2(item, g));
        return ds.length ? Math.min(...ds) : null;
    };

    missingUnknownItems.sort((a, b) => (nearestForMissing(a) ?? Infinity) - (nearestForMissing(b) ?? Infinity));
    missingKnownItems.sort((a, b) => (nearestForMissing(a) ?? Infinity) - (nearestForMissing(b) ?? Infinity));
    penaltyItems.sort((a, b) => (nearestForPenalty(a) ?? Infinity) - (nearestForPenalty(b) ?? Infinity));

    let html = `<div class="eval-detail-header-row">
        <span class="eval-detail-type-hdr">Type</span>
        <span class="eval-detail-x-hdr">x</span>
        <span class="eval-detail-y-hdr">y</span>
        <span class="eval-detail-error-hdr">Error (cm)</span>
    </div>`;

    const makeSection = (title, color, items, makeRow) => {
        if (!items.length) return;
        html += `<div class="eval-detail-section">`;
        html += `<div class="eval-detail-section-header"><div class="eval-detail-section-dot" style="background:${color}"></div>${title} (${items.length})</div>`;
        items.forEach((item, idx) => { html += makeRow(item, idx); });
        html += `</div>`;
    };

    const csvX = (item) => (item._csvX ?? item.x).toFixed(1);
    const csvY = (item) => (item._csvY ?? item.y).toFixed(1);

    const matchRow = (m, color, side) => {
        const item = side === 'gt' ? m.gt : m.sol;
        const typeLabel = item.Type === 'B' ? 'Box' : 'Obj';
        return `<div class="eval-detail-row" data-uid="${item._uid}" data-match-idx="${evaluationResult.matches.indexOf(m)}" data-row-type="match">
            <span class="eval-detail-type">${typeLabel}</span>
            <span class="eval-detail-x">${csvX(item)}</span>
            <span class="eval-detail-y">${csvY(item)}</span>
            <span class="eval-detail-error" style="color:${color}">${m.dist.toFixed(1)}</span>
        </div>`;
    };

    const unmatchedRow = (item, idx, color, rowType, nearestDist) => {
        const typeLabel = item.Type === 'B' ? 'Box' : 'Obj';
        const errStr = nearestDist !== null ? nearestDist.toFixed(1) : '—';
        return `<div class="eval-detail-row" data-uid="${item._uid}" data-item-idx="${idx}" data-row-type="${rowType}">
            <span class="eval-detail-type">${typeLabel}</span>
            <span class="eval-detail-x">${csvX(item)}</span>
            <span class="eval-detail-y">${csvY(item)}</span>
            <span class="eval-detail-error" style="color:${color}">${errStr}</span>
        </div>`;
    };

    makeSection('Maintained', matchKnownColor, maintainedMatches, (m) => matchRow(m, matchKnownColor, 'gt'));
    makeSection('Discovered', matchUnknownColor, discoveredMatches, (m) => matchRow(m, matchUnknownColor, 'gt'));
    makeSection('Missing', missingColorStr, missingUnknownItems, (item, i) => unmatchedRow(item, i, missingColorStr, 'missing', nearestForMissing(item)));
    makeSection('Known Missing', penaltyColorStr, missingKnownItems, (item, i) => unmatchedRow(item, i, penaltyColorStr, 'missing', nearestForMissing(item)));
    makeSection('Penalty', penaltyColorStr, penaltyItems, (item, i) => unmatchedRow(item, i, penaltyColorStr, 'penalty', nearestForPenalty(item)));

    const hasContent = maintainedMatches.length || discoveredMatches.length || allMissingItems.length || penaltyItems.length;
    if (!hasContent) html = `<div class="eval-detail-empty">No items to show.</div>`;
    container.innerHTML = html;

    // Attach hover listeners
    container.querySelectorAll('.eval-detail-row').forEach(row => {
        const uid = parseInt(row.dataset.uid);
        const rowType = row.dataset.rowType;

        // Robust lookup by UID
        let item = evalData.gt.known.find(i => i._uid === uid) ||
            evalData.gt.unknown.find(i => i._uid === uid) ||
            evalData.solution.find(i => i._uid === uid);

        if (item) {
            if (rowType === 'match') {
                const m = evaluationResult.matches.find(m => m.gt._uid === uid || m.sol._uid === uid);
                if (m) item = { ...item, _isMatch: true, _matchRef: m, _label: 'Match' };
            } else if (rowType === 'missing') {
                item = { ...item, _ref: item, _label: `Missing ${item.Type === 'B' ? 'Box' : 'Object'}`, _side: 'left' };
            } else if (rowType === 'penalty') {
                item = { ...item, _ref: item, _label: `Penalty ${item.Type === 'B' ? 'Box' : 'Object'}`, _side: 'right' };
            }

            row.addEventListener('mouseenter', () => {
                panelHoverItem = item;
                draw();
            });
            row.addEventListener('mouseleave', () => {
                panelHoverItem = null;
                draw();
            });
        }
    });
}

function switchEvalSidebarTab(panel) {
    lastEvalTab = panel;
    document.querySelectorAll('.eval-sidebar-tab').forEach(t => t.classList.toggle('active', t.dataset.panel === panel));
    document.getElementById('evalInputPanel').classList.toggle('hidden', panel !== 'input');
    document.getElementById('evalResultsPanel').classList.toggle('hidden', panel !== 'results');
    document.getElementById('evalDetailPanel').classList.toggle('hidden', panel !== 'detail');
    if (panel === 'detail') buildResultsPanel();
}

// --- CANVAS ---
function updateCanvasDropHint() {
    const hint = document.getElementById('canvasDropHint');
    if (!hint) return;
    const show = currentMode === 'evaluate' && !evalData;
    hint.classList.toggle('hidden', !show);
}

function draw() {
    const canvas = document.getElementById('mapCanvas');
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;
    const btnSave = document.getElementById('btnDLSVG');
    if (btnSave) btnSave.classList.add('hidden');
    document.getElementById('btnCopyCanvas')?.classList.add('hidden');

    // Fit canvas to container, scaled for device pixel ratio (sharp on HiDPI)
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = rect.width, H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    const data = currentMode === 'generate' ? (currentTask ? (currentView === 'placement' ? currentTask.base : currentTask.transformed) : null) : evalData;
    updateCanvasDropHint();
    const hasContent = !!data;
    document.getElementById('btnGridToggle')?.classList.toggle('hidden', !hasContent);
    document.getElementById('legend')?.classList.toggle('hidden', !hasContent);
    if (!data) {
        if (currentMode === 'generate') {
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = resolveCSSColor('--text-secondary');
            ctx.font = 'bold 17px Inter, system-ui, sans-serif';
            ctx.fillText('No task generated yet', W / 2, H / 2 - 14);
            ctx.globalAlpha = 0.22;
            ctx.font = '13px Inter, system-ui, sans-serif';
            ctx.fillText('Press Space or click Generate New Task', W / 2, H / 2 + 14);
            ctx.restore();
        }
        return;
    }
    if (currentMode === 'generate') {
        btnSave?.classList.remove('hidden');
        document.getElementById('btnCopyCanvas')?.classList.remove('hidden');
    }

    const alphaFor = key => {
        if (legendHoverKey) return legendHoverKey === key ? 1 : 0.12;
        if (legendFadeAlpha >= 1 || !legendFadeKey) return 1;
        return legendFadeKey === key ? 1 : legendFadeAlpha;
    };

    // Get Colors from CSS
    const getC = resolveCSSColor;

    const gridColor = getC('--viz-grid');
    const textColor = getC('--viz-text');
    const obstacleColor = getC('--viz-obstacle');
    const wsColor = getC('--viz-workspace');
    const startColor = getC('--viz-start');
    const objColor = getC('--viz-obj');
    const boxColor = getC('--viz-box');
    const matchKnown = getC('--viz-match-known');
    const matchUnknown = getC('--viz-match-unknown');
    const penaltyColor = getC('--viz-penalty');
    const missingColor = getC('--viz-missing');
    const hoverColor = getC('--viz-hover');
    const axisColor = getC('--viz-axis');
    const unusedColor = getC('--viz-unused');
    const borderProminent = getC('--ui-border-prominent');

    // Placement guide always uses the fixed physical workspace — never apply any transform
    const ws = (currentMode === 'generate' && currentView === 'placement') ? WORKSPACE_DATA : data.workspace;
    const minX = Math.min(...ws.map(p => p.x)), maxX = Math.max(...ws.map(p => p.x)), minY = Math.min(...ws.map(p => p.y)), maxY = Math.max(...ws.map(p => p.y));
    const pad = 120;
    const dataW = maxX - minX + pad * 2, dataH = maxY - minY + pad * 2;

    const isSplit = (currentMode === 'evaluate');
    const viewWidth = isSplit ? W / 2 : W;
    const scale = Math.min(viewWidth / dataW, H / dataH);
    const offY = (H - dataH * scale) / 2;

    const getToX = (isRight = false) => {
        const offX = (viewWidth - dataW * scale) / 2 + (isRight ? W / 2 : 0);
        return x => offX + (x - minX + pad) * scale;
    };
    const toY = y => offY + ((maxY - y) + pad) * scale;
    const toX = getToX(false); // Default toX for tooltips/single-view

    ctx.clearRect(0, 0, W, H);

    // Draw split-view divider and labels OUTSIDE the viewport transform (they stay fixed)
    if (isSplit) {
        ctx.strokeStyle = borderProminent; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
        ctx.fillStyle = textColor; ctx.font = 'bold 16px Inter'; ctx.textAlign = 'center';
        ctx.fillText('GROUND TRUTH', W / 4, 30);
        ctx.fillText('SOLUTION', 3 * W / 4, 30);
    }

    // Apply viewport transform for all world content
    ctx.save();
    ctx.translate(W / 2 + vpPanX, H / 2 + vpPanY);
    ctx.scale(vpZoom, vpZoom);
    ctx.translate(-W / 2, -H / 2);

    const drawWorld = (toX, worldData, isGT = true) => {
        // Grid — uniform thin lines every 100 cm, labels every 500 cm
        const fontSize = Math.max(9, Math.min(13, 11 * scale));
        const step = 100, labelStep = 500;
        const gxStart = Math.floor(minX / step) * step;
        const gyStart = Math.floor(minY / step) * step;

        if (showGrid) {
            ctx.strokeStyle = gridColor; ctx.lineWidth = 0.4;
            ctx.fillStyle = textColor; ctx.font = `${fontSize}px Inter`;

            // Vertical lines
            for (let x = gxStart; x <= maxX; x += step) {
                ctx.beginPath(); ctx.moveTo(toX(x), toY(minY)); ctx.lineTo(toX(x), toY(maxY)); ctx.stroke();
                if (x % labelStep === 0) {
                    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                    ctx.fillText(`${x}`, toX(x), toY(minY) + 4);
                }
            }
            // Horizontal lines
            for (let y = gyStart; y <= maxY; y += step) {
                ctx.beginPath(); ctx.moveTo(toX(minX), toY(y)); ctx.lineTo(toX(maxX), toY(y)); ctx.stroke();
                if (y % labelStep === 0) {
                    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
                    ctx.fillText(`${y}`, toX(minX) - 5, toY(y));
                }
            }
        } // end showGrid

        // Axis unit labels
        if (showGrid) {
            ctx.font = `bold ${fontSize}px Inter`; ctx.fillStyle = axisColor;
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText('X (cm)', (toX(minX) + toX(maxX)) / 2, toY(minY) + 16);
            const yCenterY = (toY(minY) + toY(maxY)) / 2;
            ctx.save();
            ctx.translate(toX(minX) - 28, yCenterY);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('Y (cm)', 0, 0);
            ctx.restore();
        } // end showGrid axis labels

        // Workspace
        if (vis('workspace')) {
            ctx.globalAlpha = alphaFor('workspace');
            ctx.strokeStyle = wsColor; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(toX(ws[0].x), toY(ws[0].y)); ws.forEach(p => ctx.lineTo(toX(p.x), toY(p.y))); ctx.closePath(); ctx.stroke();
            ctx.globalAlpha = 1;
        }

        const drawItem = (i, type, color, h = false, labelText = null) => {
            ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2;
            if (type === 'O') {
                const outerAlpha = ctx.globalAlpha;
                ctx.save(); ctx.translate(toX(i.x), toY(i.y)); ctx.rotate(-(i.angle * Math.PI / 180));
                const hw = Math.max(3, 6 * scale), hh = hw;
                ctx.globalAlpha = outerAlpha;
                if (h) ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
                else ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
                ctx.restore();
            } else if (type === 'B') {
                const outerAlpha = ctx.globalAlpha;
                ctx.save(); ctx.translate(toX(i.x), toY(i.y)); ctx.rotate(-(i.angle * Math.PI / 180));
                ctx.globalAlpha = outerAlpha * 0.6; ctx.strokeRect(-12 * scale, -8 * scale, 24 * scale, 16 * scale);
                if (!h) ctx.fillRect(-12 * scale, -8 * scale, 24 * scale, 16 * scale); ctx.restore();
            } else if (type === 'X') {
                const cx = toX(i.x), cy = toY(i.y);
                ctx.strokeStyle = obstacleColor; ctx.beginPath(); ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx + 5, cy + 5); ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx - 5, cy + 5); ctx.stroke();
            }
            if (labelText) {
                const cx = toX(i.x), cy = toY(i.y);
                ctx.fillStyle = color; ctx.font = `${Math.max(8, fontSize * 0.85)}px Inter`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                ctx.fillText(labelText, cx, cy + Math.max(4, 9 * scale) + 3);
            }
        };

        const sp = isGT ? (currentMode === 'generate' ? worldData.startPose : worldData.gt.start) : (worldData.gt.start); // Use GT start for solution view too
        if (currentMode === 'generate' && currentView === 'placement') {
            // Show all possible start poses; active one full-opacity, others dimmed
            const activeX = worldData.startPose?.x, activeY = worldData.startPose?.y, activeA = worldData.startPose?.angle;
            START_POSES.forEach(pose => {
                const isActive = pose.x === activeX && pose.y === activeY && pose.angle === activeA;
                ctx.globalAlpha = isActive ? 1 : 0.25;
                ctx.save(); ctx.translate(toX(pose.x), toY(pose.y)); ctx.rotate(-(pose.angle * Math.PI / 180));
                ctx.strokeStyle = startColor; ctx.fillStyle = startColor; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(15, 0); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(25, 0); ctx.lineTo(15, -5); ctx.lineTo(15, 5); ctx.fill(); ctx.restore();
                ctx.globalAlpha = 1;
            });
        } else if (sp && vis('start')) {
            ctx.globalAlpha = alphaFor('start');
            ctx.save(); ctx.translate(toX(sp.x), toY(sp.y)); ctx.rotate(-(sp.angle * Math.PI / 180));
            ctx.strokeStyle = startColor; ctx.fillStyle = startColor; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(15, 0); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(25, 0); ctx.lineTo(15, -5); ctx.lineTo(15, 5); ctx.fill(); ctx.restore();
            ctx.globalAlpha = 1;
        }

        if (currentMode === 'generate') {
            if (currentView === 'placement') {
                // Show every possible object/box position; label unused ones
                const usedObjKeys = new Set([...worldData.knownObjs, ...worldData.unknownObjs].map(o => `${o.x},${o.y}`));
                const usedBoxKeys = new Set([...worldData.knownBoxes, ...worldData.unknownBoxes].map(b => `${b.x},${b.y}`));
                OBJECTS.forEach(o => {
                    const key = `${o.x},${o.y}`;
                    if (usedObjKeys.has(key)) {
                        const isKnown = worldData.knownObjs.some(k => k.x === o.x && k.y === o.y);
                        if (isKnown && vis('known_obj')) { ctx.globalAlpha = alphaFor('known_obj'); drawItem(o, 'O', objColor); }
                        else if (!isKnown && vis('unknown_obj')) { ctx.globalAlpha = alphaFor('unknown_obj'); drawItem(o, 'O', objColor, true); }
                    } else {
                        if (vis('unused')) { ctx.globalAlpha = alphaFor('unused'); drawItem(o, 'O', unusedColor); }
                    }
                });
                BOXES.forEach(b => {
                    const key = `${b.x},${b.y}`;
                    if (usedBoxKeys.has(key)) {
                        const isKnown = worldData.knownBoxes.some(k => k.x === b.x && k.y === b.y);
                        if (isKnown && vis('known_box')) { ctx.globalAlpha = alphaFor('known_box'); drawItem(b, 'B', boxColor); }
                        else if (!isKnown && vis('unknown_box')) { ctx.globalAlpha = alphaFor('unknown_box'); drawItem(b, 'B', boxColor, true); }
                    } else {
                        if (vis('unused')) { ctx.globalAlpha = alphaFor('unused'); drawItem(b, 'B', unusedColor); }
                    }
                });
                ctx.globalAlpha = 1;
                if (vis('obstacle')) { ctx.globalAlpha = alphaFor('obstacle'); worldData.obstacles.forEach(o => drawItem(o, 'X', obstacleColor)); ctx.globalAlpha = 1; }
            } else {
                if (vis('known_obj')) { ctx.globalAlpha = alphaFor('known_obj'); worldData.knownObjs.forEach(o => drawItem(o, 'O', objColor)); ctx.globalAlpha = 1; }
                if (vis('known_box')) { ctx.globalAlpha = alphaFor('known_box'); worldData.knownBoxes.forEach(b => drawItem(b, 'B', boxColor)); ctx.globalAlpha = 1; }
                if (currentView !== 'known') {
                    if (vis('unknown_obj')) { ctx.globalAlpha = alphaFor('unknown_obj'); worldData.unknownObjs.forEach(o => drawItem(o, 'O', objColor, currentView === 'truth')); ctx.globalAlpha = 1; }
                    if (vis('unknown_box')) { ctx.globalAlpha = alphaFor('unknown_box'); worldData.unknownBoxes.forEach(b => drawItem(b, 'B', boxColor, currentView === 'truth')); ctx.globalAlpha = 1; }
                    if (vis('obstacle')) { ctx.globalAlpha = alphaFor('obstacle'); worldData.obstacles.forEach(o => drawItem(o, 'X', obstacleColor)); ctx.globalAlpha = 1; }
                }
            }
        } else { // evaluate mode
            const knownGT = new Set(worldData.gt.known);
            if (isGT) {
                if (evaluationResult) {
                    const matchedGT = new Set(evaluationResult.matches.map(m => m.gt));
                    if (vis('maintained')) { ctx.globalAlpha = alphaFor('maintained'); worldData.gt.known.filter(i => matchedGT.has(i)).forEach(i => drawItem(i, i.Type, matchKnown)); ctx.globalAlpha = 1; }
                    if (vis('discovered')) { ctx.globalAlpha = alphaFor('discovered'); worldData.gt.unknown.filter(i => matchedGT.has(i)).forEach(i => drawItem(i, i.Type, matchUnknown)); ctx.globalAlpha = 1; }

                    // Unknown-GT missing: amber
                    if (vis('missing_u')) {
                        ctx.globalAlpha = alphaFor('missing_u');
                        worldData.gt.unknown.filter(i => !matchedGT.has(i)).forEach(i => drawItem(i, i.Type, missingColor));
                        ctx.globalAlpha = 1;
                    }
                    // Known-GT missing: red (auto-fail) + dashed warning ring
                    if (vis('missing_k')) {
                        ctx.globalAlpha = alphaFor('missing_k');
                        const missingKnown = worldData.gt.known.filter(i => !matchedGT.has(i));
                        missingKnown.forEach(i => {
                            drawItem(i, i.Type, penaltyColor);
                            const ix = toX(i.x), iy = toY(i.y);
                            const ringR = Math.max(10, 14 * scale);
                            ctx.strokeStyle = penaltyColor; ctx.lineWidth = 1.5;
                            ctx.globalAlpha = alphaFor('missing_k') * 0.7;
                            ctx.setLineDash([4, 3]);
                            ctx.beginPath(); ctx.arc(ix, iy, ringR, 0, Math.PI * 2); ctx.stroke();
                            ctx.setLineDash([]);
                        });
                        ctx.globalAlpha = 1;
                    }
                } else {
                    worldData.gt.known.forEach(i => drawItem(i, i.Type, matchKnown));
                    worldData.gt.unknown.forEach(i => drawItem(i, i.Type, matchUnknown));
                }
                if (vis('obstacle')) { ctx.globalAlpha = alphaFor('obstacle'); worldData.gt.obstacles.forEach(o => drawItem(o, 'X', obstacleColor)); ctx.globalAlpha = 1; }
            } else {
                if (evaluationResult) {
                    const matchedByKnown = new Set(evaluationResult.matches.filter(m => knownGT.has(m.gt)).map(m => m.sol));
                    const matchedByUnknown = new Set(evaluationResult.matches.filter(m => !knownGT.has(m.gt)).map(m => m.sol));
                    const matchedAll = new Set([...matchedByKnown, ...matchedByUnknown]);
                    const sol = worldData.solution;
                    if (vis('maintained')) { ctx.globalAlpha = alphaFor('maintained'); sol.filter(i => matchedByKnown.has(i)).forEach(i => drawItem(i, i.Type, matchKnown)); ctx.globalAlpha = 1; }
                    if (vis('discovered')) { ctx.globalAlpha = alphaFor('discovered'); sol.filter(i => matchedByUnknown.has(i)).forEach(i => drawItem(i, i.Type, matchUnknown)); ctx.globalAlpha = 1; }
                    if (vis('penalty')) { ctx.globalAlpha = alphaFor('penalty'); sol.filter(i => !matchedAll.has(i)).forEach(i => drawItem(i, i.Type, penaltyColor)); ctx.globalAlpha = 1; }
                } else {
                    worldData.solution.forEach(i => drawItem(i, i.Type, objColor));
                }
                if (vis('obstacle')) { ctx.globalAlpha = alphaFor('obstacle'); worldData.gt.obstacles.forEach(o => drawItem(o, 'X', obstacleColor)); ctx.globalAlpha = 1; }
            }
        }
    };

    if (!isSplit) {
        drawWorld(getToX(false), data, currentView !== 'sol');
    } else {
        const toXLeft = getToX(false);
        const toXRight = getToX(true);
        drawWorld(toXLeft, data, true);
        drawWorld(toXRight, data, false);

        if (evaluationResult) {
            const knownGTSet = new Set(data.gt.known);
            evaluationResult.matches.forEach(m => {
                const isMaintained = knownGTSet.has(m.gt);
                if (isMaintained && (!vis('maintained') || !vis('matched_maintained'))) return;
                if (!isMaintained && (!vis('discovered') || !vis('matched_discovered'))) return;
                const isHovered = hoverItem && hoverItem._isMatch && hoverItem._matchRef === m;
                const lineKey = isMaintained ? 'matched_maintained' : 'matched_discovered';
                ctx.strokeStyle = isMaintained ? matchKnown : matchUnknown;
                ctx.setLineDash([5, 5]); ctx.lineWidth = isHovered ? 2.5 : 1; ctx.globalAlpha = (isHovered ? 1 : 0.6) * alphaFor(lineKey);
                ctx.beginPath(); ctx.moveTo(toXLeft(m.gt.x), toY(m.gt.y)); ctx.lineTo(toXRight(m.sol.x), toY(m.sol.y)); ctx.stroke();
                ctx.setLineDash([]); ctx.globalAlpha = 1;
            });
        }
    }

    const activeHighlight = hoverItem || panelHoverItem || pinnedItem;
    if (activeHighlight) {
        const hoverItem = activeHighlight; // shadow for the block below
        const threshR = getThreshold() * scale;
        ctx.strokeStyle = hoverColor; ctx.lineWidth = 2;
        if (hoverItem._isMatch) {
            const m = hoverItem._matchRef;
            const r = Math.max(5, (10 * scale) / 2);
            const highlightItem = (item, fn, circleItem = item) => {
                ctx.fillStyle = hoverColor; ctx.strokeStyle = hoverColor; ctx.lineWidth = 2;
                if (item.Type !== 'B') {
                    ctx.fillRect(fn(item.x) - r, toY(item.y) - r, r * 2, r * 2);
                } else {
                    ctx.save(); ctx.translate(fn(item.x), toY(item.y)); ctx.rotate(-(item.angle * Math.PI / 180));
                    ctx.globalAlpha = 0.8; ctx.fillRect(-12 * scale, -8 * scale, 24 * scale, 16 * scale);
                    ctx.restore(); ctx.globalAlpha = 1;
                }
                ctx.strokeStyle = hoverColor; ctx.beginPath(); ctx.arc(fn(circleItem.x), toY(circleItem.y), threshR, 0, Math.PI * 2); ctx.stroke();
            };
            highlightItem(m.gt, getToX(false));
            highlightItem(m.sol, getToX(true), m.gt);
        } else {
            const hy = toY(hoverItem.y);
            const nearestDist = getHoverNearestDist(hoverItem);
            const isMissing = hoverItem._label?.startsWith('Missing');
            const isPenalty = hoverItem._label?.startsWith('Penalty');
            const errorCircleColor = isMissing ? missingColor : (isPenalty ? penaltyColor : hoverColor);
            if (isSplit && (hoverItem._side === 'left' || hoverItem._side === 'right')) {
                // Primary ring on the item's own side
                const primaryFn = hoverItem._side === 'left' ? getToX(false) : getToX(true);
                ctx.strokeStyle = hoverColor; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(primaryFn(hoverItem.x), hy, threshR, 0, Math.PI * 2); ctx.stroke();
                // Draw a faded ring on the other side: at the matched item's position if matched, else same coordinate
                const otherFn = hoverItem._side === 'left' ? getToX(true) : getToX(false);
                let otherX = hoverItem.x, otherY = hoverItem.y;
                if (evaluationResult) {
                    const ref = hoverItem._ref || hoverItem;
                    const match = hoverItem._side === 'left'
                        ? evaluationResult.matches.find(m => m.gt === ref)
                        : evaluationResult.matches.find(m => m.sol === ref);
                    if (match) { const otherItem = hoverItem._side === 'left' ? match.sol : match.gt; otherX = otherItem.x; otherY = otherItem.y; }
                }
                ctx.globalAlpha = 0.35; ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.arc(otherFn(otherX), toY(otherY), threshR, 0, Math.PI * 2); ctx.stroke();
                ctx.setLineDash([]); ctx.globalAlpha = 1;
                // Error circle (nearest-unmatched dist) on both sides
                if (nearestDist !== null) {
                    ctx.strokeStyle = errorCircleColor; ctx.lineWidth = 1.5;
                    ctx.globalAlpha = 0.8; ctx.setLineDash([3, 3]);
                    ctx.beginPath(); ctx.arc(primaryFn(hoverItem.x), hy, nearestDist * scale, 0, Math.PI * 2); ctx.stroke();
                    ctx.beginPath(); ctx.arc(otherFn(otherX), toY(otherY), nearestDist * scale, 0, Math.PI * 2); ctx.stroke();
                    ctx.setLineDash([]); ctx.globalAlpha = 1;
                }
            } else {
                const ringFns = isSplit ? [toX, getToX(true)] : [toX];
                ringFns.forEach(fn => { ctx.beginPath(); ctx.arc(fn(hoverItem.x), hy, threshR, 0, Math.PI * 2); ctx.stroke(); });
                if (nearestDist !== null) {
                    ctx.strokeStyle = errorCircleColor; ctx.lineWidth = 1.5;
                    ctx.globalAlpha = 0.8; ctx.setLineDash([3, 3]);
                    ringFns.forEach(fn => { ctx.beginPath(); ctx.arc(fn(hoverItem.x), hy, nearestDist * scale, 0, Math.PI * 2); ctx.stroke(); });
                    ctx.setLineDash([]); ctx.globalAlpha = 1;
                }
            }
        }
    }
    ctx.restore(); // end viewport transform

    // Cursor world-coordinates readout (bottom-left corner)
    if (hoverWorldCoords) {
        const text = `${hoverWorldCoords.x.toFixed(1)}, ${hoverWorldCoords.y.toFixed(1)} cm`;
        ctx.save();
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        const tw = ctx.measureText(text).width;
        const pad = 5;
        const bx = 16;
        const by = H - 30;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.roundRect(bx - pad, by - pad, tw + pad * 2, 20, 4);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.93)';
        ctx.fillText(text, bx, by + 11);
        ctx.restore();
    }

    document.getElementById('btnResetViewport')?.classList.toggle('hidden', vpZoom === 1 && vpPanX === 0 && vpPanY === 0);
    updateHoverTooltip();
    updateLegend();
    updateDetailTabHighlight();
}

function updateDetailTabHighlight() {
    const active = hoverItem || panelHoverItem;
    const uid = active?._uid;
    document.querySelectorAll('.eval-detail-row').forEach(row => {
        const isMatch = uid !== undefined && row.dataset.uid === String(uid);
        row.classList.toggle('panel-hover-active', isMatch);
        // Only auto-scroll if highlighted from canvas hover
        if (isMatch && hoverItem && active === hoverItem) {
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}

function updateHoverTooltip() {
    const el = document.getElementById('mapTooltip');
    const isShowingPinned = !hoverItem && !!pinnedItem;
    const item = hoverItem || pinnedItem;
    if (!item) { el.classList.add('hidden'); return; }
    el.classList.toggle('map-tooltip--pinned', isShowingPinned);

    if (item._isMatch) {
        const m = item._matchRef;
        const type = m.gt.Type === 'B' ? 'Box' : 'Object';
        el.innerHTML =
            `<div class="map-tooltip-label">Match — ${type}</div>` +
            `<div class="map-tooltip-row"><span>error</span><span>${m.dist.toFixed(1)} cm</span></div>` +
            `<div class="map-tooltip-row"><span>GT x,y</span><span>${m.gt.x.toFixed(1)}, ${m.gt.y.toFixed(1)}</span></div>` +
            `<div class="map-tooltip-row"><span>sol x,y</span><span>${m.sol.x.toFixed(1)}, ${m.sol.y.toFixed(1)}</span></div>`;
    } else {
        const label = item._label || item.Type || 'Item';
        const hasAngle = item.angle !== undefined && item.angle !== null;
        const ref = item._ref || item;
        const match = evaluationResult?.matches?.find(m => m.gt === ref || m.sol === ref);
        const nearestDist = !match ? getHoverNearestDist(item) : null;

        const angleRows = item._poseAngles
            ? item._poseAngles.map(pa => `<div class="map-tooltip-row"><span>angle</span><span>${pa.isActive ? '▶\u202f' : ''}${pa.angle}°</span></div>`).join('')
            : (hasAngle ? `<div class="map-tooltip-row"><span>angle</span><span>${item.angle.toFixed(1)}°</span></div>` : '');
        el.innerHTML =
            `<div class="map-tooltip-label">${label}</div>` +
            `<div class="map-tooltip-row"><span>x</span><span>${item.x.toFixed(1)} cm</span></div>` +
            `<div class="map-tooltip-row"><span>y</span><span>${item.y.toFixed(1)} cm</span></div>` +
            angleRows +
            (match ? `<div class="map-tooltip-row"><span>error</span><span>${match.dist.toFixed(1)} cm</span></div>` : '') +
            (nearestDist !== null ? `<div class="map-tooltip-row"><span>nearest</span><span>${nearestDist.toFixed(1)} cm</span></div>` : '');
    }

    // Position using fixed viewport coordinates (tooltip is position:fixed at body level)
    const vpos = isShowingPinned ? pinnedViewport : hoverViewport;
    const cx = vpos.x, cy = vpos.y;
    const flipX = cx > window.innerWidth * 0.72;
    el.style.left = `${cx}px`;
    el.style.right = '';
    el.style.top = `${cy}px`;
    el.style.transform = flipX ? 'translate(calc(-100% - 14px), -50%)' : 'translate(14px, -50%)';
    el.classList.remove('hidden');
}

function updateLegend() {
    const getC = resolveCSSColor;
    const L = document.getElementById('legend'); L.innerHTML = '';
    const hint = document.createElement('div');
    hint.className = 'legend-hint';
    hint.title = 'Click any legend item to show or hide that category in the map';
    hint.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> Click items to show/hide';
    L.appendChild(hint);
    const ws = { n: 'Workspace', key: 'workspace', c: getC('--viz-workspace') };
    const sp = { n: 'Start', key: 'start', c: getC('--viz-start') };
    const ko = { n: 'Known Object', key: 'known_obj', c: getC('--viz-obj') };
    const kb = { n: 'Known Box', key: 'known_box', c: getC('--viz-box') };
    const uo = { n: 'Unknown Object', key: 'unknown_obj', c: getC('--viz-obj'), h: true };
    const ub = { n: 'Unknown Box', key: 'unknown_box', c: getC('--viz-box'), h: true };
    const ob = { n: 'Obstacle', key: 'obstacle', c: getC('--viz-obstacle'), x: true };
    const un = { n: 'Unused', key: 'unused', c: getC('--viz-unused'), h: true };
    const mnt = { n: 'Maintained', key: 'maintained', c: getC('--viz-match-known') };
    const dsc = { n: 'Discovered', key: 'discovered', c: getC('--viz-match-unknown') };
    const mis_u = { n: 'Missing', key: 'missing_u', c: getC('--viz-missing') };
    const mis_k = { n: 'Known Missing', key: 'missing_k', c: getC('--viz-penalty') };
    const pen = { n: 'Penalty', key: 'penalty', c: getC('--viz-penalty') };
    const lmnt = { n: 'Maintained match', key: 'matched_maintained', c: getC('--viz-match-known'), d: true };
    const ldsc = { n: 'Discovered match', key: 'matched_discovered', c: getC('--viz-match-unknown'), d: true };

    const items = currentMode === 'generate' ? {
        truth: [ws, sp, ko, kb, uo, ub, ob],
        known: [ws, sp, ko, kb],
        placement: [ws, sp, ko, kb, uo, ub, ob, un],
    }[currentView] ?? [] : [ws, sp, ob, mnt, dsc, mis_u, mis_k, pen, lmnt, ldsc];
    items.forEach(i => {
        const d = document.createElement('div');
        d.className = 'legend-item' + (vis(i.key) ? '' : ' layer-hidden');
        let p = `<div class="legend-patch" style="background:${i.c}; ${i.h ? 'border:2px solid ' + i.c + '; background:transparent' : ''}"></div>`;
        if (i.x) p = `<div class="legend-patch" style="background:transparent; color:${i.c}; display:flex; align-items:center; justify-content:center; font-weight:bold">×</div>`;
        if (i.l) p = `<div class="legend-patch" style="border-top:2px solid ${i.c}; height:0; margin-top:8px"></div>`;
        if (i.d) p = `<div class="legend-patch" style="border-top:2px dashed ${i.c}; height:0; margin-top:8px"></div>`;
        d.innerHTML = `${p} <span>${i.n}</span>`;
        d.dataset.legendKey = i.key;
        d.onclick = () => { layerVisible[i.key] = !vis(i.key); updateLegend(); draw(); };
        L.appendChild(d);
    });
    L.addEventListener('mouseover', (e) => {
        const rawKey = e.target.closest('[data-legend-key]')?.dataset.legendKey ?? null;
        const key = rawKey && vis(rawKey) ? rawKey : null;
        if (legendHoverKey === key) return;
        if (key !== null) {
            // Entering a legend item: cancel any running fade, highlight immediately
            if (legendFadeRAF) { cancelAnimationFrame(legendFadeRAF); legendFadeRAF = null; }
            legendHoverKey = key;
            legendFadeAlpha = 0.12;
            draw();
        } else {
            // Moving to a gap or hint inside the legend: start fade
            legendFadeKey = legendHoverKey;
            legendHoverKey = null;
            startLegendFade();
        }
    });
    L.addEventListener('mouseleave', () => {
        if (legendHoverKey === null && legendFadeAlpha >= 1) return;
        legendFadeKey = legendHoverKey;
        legendHoverKey = null;
        startLegendFade();
    });
}

function downloadAllCSV() {
    ['workspace', 'map', 'map_gt'].forEach(type => downloadCSV(type));
}

function downloadAllSVGs() {
    if (!currentTask) return;
    const id = taskShortId();
    const views = [
        { view: 'truth', name: 'gt' },
        { view: 'known', name: 'known' },
        { view: 'placement', name: 'placement_guide' },
    ];
    const savedView = currentView;
    views.forEach(({ view, name }) => {
        currentView = view;
        const svgStr = _buildSVGString();
        if (!svgStr) return;
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${name}.svg`; a.click();
    });
    currentView = savedView;
    draw();
}

async function downloadZip() {
    if (!currentTask || typeof window.JSZip === 'undefined') return;
    const id = taskShortId();
    const zip = new window.JSZip();

    // CSV files
    const nameMap = { workspace: 'workspace', map: 'map', map_gt: 'gt' };
    ['workspace', 'map', 'map_gt'].forEach(type => {
        const data = currentTask.transformed;
        let csv = type === 'workspace'
            ? "x,y\n" + data.workspace.map(p => `${csvFmt(p.x)},${csvFmt(p.y)}`).join("\n")
            : "Type,x,y,angle\n";
        if (type !== 'workspace') {
            csv += csvItemRow('S', data.startPose.x, data.startPose.y, data.startPose.angle) + '\n';
            data.knownObjs.forEach(o => csv += csvItemRow('O', o.x, o.y, o.angle) + '\n');
            data.knownBoxes.forEach(b => csv += csvItemRow('B', b.x, b.y, b.angle) + '\n');
            if (type === 'map_gt') {
                data.unknownObjs.forEach(o => csv += csvItemRow('O', o.x, o.y, o.angle) + '\n');
                data.unknownBoxes.forEach(b => csv += csvItemRow('B', b.x, b.y, b.angle) + '\n');
                data.obstacles.forEach(p => csv += csvItemRow('X', p.x, p.y, 0) + '\n');
            }
        }
        zip.file(`${nameMap[type]}.csv`, csv);
    });

    // solution_template.csv — first line is the taskId for evaluation
    const taskId = currentTask.taskId ?? '';
    zip.file(`solution_template.csv`, `${taskId}\nType,x,y,angle\n`);

    // SVG files — temporarily switch view to generate each
    const savedView = currentView;
    const svgViews = [
        { view: 'truth', name: 'gt' },
        { view: 'known', name: 'known' },
        { view: 'placement', name: 'placement_guide' },
    ];
    for (const { view, name } of svgViews) {
        currentView = view;
        const svgStr = _buildSVGString();
        if (svgStr) zip.file(`${name}.svg`, svgStr);
    }
    currentView = savedView;
    draw(); // restore canvas

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `task.zip`; a.click();
}

// Format a number to 1 decimal place, stripping trailing ".0" (e.g. 122.0 → "122", 302.3 → "302.3")
const csvFmt = n => { const s = n.toFixed(1); return s.endsWith('.0') ? s.slice(0, -2) : s; };
// Build a CSV item row
const csvItemRow = (type, x, y, angle) => `${type},${csvFmt(x)},${csvFmt(y)},${csvFmt(angle)}`;

// Legacy — replaced by taskShortId(); kept only as reference
// function csvSeedStr() { ... }

function downloadCSV(type) {
    if (!currentTask) return;
    const data = currentTask.transformed;
    let csv = type === 'workspace'
        ? "x,y\n" + data.workspace.map(p => `${csvFmt(p.x)},${csvFmt(p.y)}`).join("\n")
        : "Type,x,y,angle\n";
    if (type !== 'workspace') {
        csv += csvItemRow('S', data.startPose.x, data.startPose.y, data.startPose.angle) + '\n';
        data.knownObjs.forEach(o => csv += csvItemRow('O', o.x, o.y, o.angle) + '\n');
        data.knownBoxes.forEach(b => csv += csvItemRow('B', b.x, b.y, b.angle) + '\n');
        if (type === 'map_gt') {
            data.unknownObjs.forEach(o => csv += csvItemRow('O', o.x, o.y, o.angle) + '\n');
            data.unknownBoxes.forEach(b => csv += csvItemRow('B', b.x, b.y, b.angle) + '\n');
            data.obstacles.forEach(p => csv += csvItemRow('X', p.x, p.y, 0) + '\n');
        }
    }
    const nameMap = { workspace: 'workspace', map: 'map', map_gt: 'gt' };
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${nameMap[type]}.csv`; a.click();
}

function generateSVGContent(viewOverride) {
    const savedView = currentView;
    if (viewOverride) currentView = viewOverride;
    const svgString = _buildSVGString();
    currentView = savedView;
    return svgString;
}

function downloadSVG() {
    if (currentMode === 'evaluate') { downloadEvalSVG(); return; }
    const svgString = _buildSVGString();
    if (!svgString) return;
    const typeMap = { truth: 'gt', known: 'known', placement: 'placement_guide' };
    const viewType = typeMap[currentView] || currentView;
    const id = taskShortId() || 'task';
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${viewType}.svg`; a.click();
}

function downloadEvalSVG() {
    const svgString = _buildSVGString();
    if (!svgString) return;
    const id = document.getElementById('evalTaskShortId')?.textContent.trim() || 'eval';
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `eval.svg`; a.click();
}

function _buildSVGString() {
    const canvas = document.getElementById('mapCanvas');
    const data = currentMode === 'generate' ? (currentTask ? (currentView === 'placement' ? currentTask.base : currentTask.transformed) : null) : evalData;
    if (!data) return;

    const getC = resolveCSSColor;
    const bg = getC('--viz-bg'), gridColor = getC('--viz-grid'), textColor = getC('--viz-text'), axisColor = getC('--viz-axis');
    const obstacleColor = getC('--viz-obstacle'), wsColor = getC('--viz-workspace'), startColor = getC('--viz-start');
    const objColor = getC('--viz-obj'), boxColor = getC('--viz-box'), unusedColor = getC('--viz-unused');
    const borderProm = getC('--ui-border-prominent');
    const matchKnown = getC('--viz-match-known'), matchUnknown = getC('--viz-match-unknown'), penaltyColor = getC('--viz-penalty'), missingColor = getC('--viz-missing');
    const panelBg = getC('--bg-color'), panelText = getC('--text-primary'), panelSecondary = getC('--text-secondary'), accentColor = getC('--accent-primary');
    const successColor = getC('--success');

    const ws = (currentMode === 'generate' && currentView === 'placement') ? WORKSPACE_DATA : data.workspace;
    const minX = Math.min(...ws.map(p => p.x)), maxX = Math.max(...ws.map(p => p.x));
    const minY = Math.min(...ws.map(p => p.y)), maxY = Math.max(...ws.map(p => p.y));
    const pad = 120;
    const dataW = maxX - minX + pad * 2, dataH = maxY - minY + pad * 2;

    const isSplit = (currentMode === 'evaluate');
    const mapW = parseFloat(canvas.style.width) || canvas.offsetWidth;
    const mapH = parseFloat(canvas.style.height) || canvas.offsetHeight;
    const viewWidth = isSplit ? mapW / 2 : mapW;

    const scale = Math.min(viewWidth / dataW, mapH / dataH);
    const offX0 = (viewWidth - dataW * scale) / 2;
    const offY0 = (mapH - dataH * scale) / 2;

    // Map a world point to SVG canvas coordinates (matches canvas toX/toY exactly).
    // xShift offsets within the map area (used for split right panel). mapOffset shifts the map area itself.
    const map = (wx, wy, xShift = 0) => ({
        cx: mapOffset + xShift + offX0 + (wx - minX + pad) * scale,
        cy: offY0 + (maxY - wy + pad) * scale
    });

    const PANEL_W = 240;
    const LEFT_PANEL_W = (isSplit && evaluationResult) ? 240 : 0;
    const mapOffset = LEFT_PANEL_W;
    let py = 0, lpy = 0, ly = 0;
    const svgW = mapOffset + mapW + PANEL_W;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="##HEIGHT##" viewBox="0 0 ${svgW} ##HEIGHT##">`;
    svg += `<style>text { font-family: Inter, sans-serif; }</style>`;
    if (LEFT_PANEL_W > 0) {
        svg += `<rect x="0" y="0" width="${LEFT_PANEL_W}" height="##HEIGHT##" fill="${panelBg}" />`;
        svg += `<line x1="${LEFT_PANEL_W}" y1="0" x2="${LEFT_PANEL_W}" y2="##HEIGHT##" stroke="${borderProm}" stroke-width="1" />`;
    }
    svg += `<rect x="${mapOffset}" y="0" width="${mapW}" height="##HEIGHT##" fill="${panelBg}" />`; // Background for legend Area
    svg += `<rect x="${mapOffset}" y="0" width="${mapW}" height="${mapH}" fill="${bg}" />`;
    svg += `<rect x="${mapOffset + mapW}" y="0" width="${PANEL_W}" height="##HEIGHT##" fill="${panelBg}" />`;
    svg += `<line x1="${mapOffset + mapW}" y1="0" x2="${mapOffset + mapW}" y2="##HEIGHT##" stroke="${borderProm}" stroke-width="1" />`;

    const drawWorldSVG = (xShift, worldData, isGT = true) => {
        const fontSize = Math.max(9, Math.min(13, 11 * scale));
        const step = 100, labelStep = 500;
        const gxStart = Math.floor(minX / step) * step, gyStart = Math.floor(minY / step) * step;

        // Vertical lines for world X, horizontal for world Y
        if (showGrid) {
            for (let x = gxStart; x <= maxX; x += step) {
                const { cx } = map(x, minY, xShift), cy1 = map(x, minY, xShift).cy, cy2 = map(x, maxY, xShift).cy;
                svg += `<line x1="${cx}" y1="${cy1}" x2="${cx}" y2="${cy2}" stroke="${gridColor}" stroke-width="0.4" />`;
                if (x % labelStep === 0) svg += `<text x="${cx}" y="${cy1 + 4}" fill="${textColor}" font-size="${fontSize}" text-anchor="middle" dominant-baseline="hanging">${x}</text>`;
            }
            for (let y = gyStart; y <= maxY; y += step) {
                const { cy } = map(minX, y, xShift), cx1 = map(minX, y, xShift).cx, cx2 = map(maxX, y, xShift).cx;
                svg += `<line x1="${cx1}" y1="${cy}" x2="${cx2}" y2="${cy}" stroke="${gridColor}" stroke-width="0.4" />`;
                if (y % labelStep === 0) svg += `<text x="${cx1 - 5}" y="${cy}" fill="${textColor}" font-size="${fontSize}" text-anchor="end" dominant-baseline="middle">${y}</text>`;
            }
        } // end showGrid
        const midCX = (map(minX, 0, xShift).cx + map(maxX, 0, xShift).cx) / 2;
        const bottomCY = map(0, minY, xShift).cy;
        const midCY = (map(0, minY, xShift).cy + map(0, maxY, xShift).cy) / 2;
        const leftCX = map(minX, 0, xShift).cx;
        if (showGrid) {
            svg += `<text x="${midCX}" y="${bottomCY + 16}" fill="${axisColor}" font-size="${fontSize}" font-weight="bold" text-anchor="middle" dominant-baseline="hanging">X (cm)</text>`;
            svg += `<text x="0" y="0" fill="${axisColor}" font-size="${fontSize}" font-weight="bold" text-anchor="middle" dominant-baseline="middle" transform="translate(${leftCX - 28},${midCY}) rotate(-90)">Y (cm)</text>`;
        }

        // Workspace
        if (vis('workspace')) {
            const pts = ws.map(p => { const m = map(p.x, p.y, xShift); return `${m.cx},${m.cy}`; }).join(' ');
            svg += `<polygon points="${pts}" fill="none" stroke="${wsColor}" stroke-width="3" />`;
        }

        const addIcon = (i, type, color, h = false) => {
            const { cx, cy } = map(i.x, i.y, xShift);
            if (type === 'O') {
                const hw = Math.max(3, 6 * scale), dispAngle = -(i.angle ?? 0);
                if (!h) svg += `<rect x="${-hw}" y="${-hw}" width="${hw * 2}" height="${hw * 2}" fill="${color}" transform="translate(${cx},${cy}) rotate(${dispAngle})" />`;
                else svg += `<rect x="${-hw}" y="${-hw}" width="${hw * 2}" height="${hw * 2}" fill="none" stroke="${color}" stroke-width="2" transform="translate(${cx},${cy}) rotate(${dispAngle})" />`;
            } else if (type === 'B') {
                const dispAngle = -(i.angle ?? 0);
                svg += `<rect x="${-12 * scale}" y="${-8 * scale}" width="${24 * scale}" height="${16 * scale}" fill="${color}" fill-opacity="${h ? 0 : 0.6}" stroke="${color}" stroke-width="2" transform="translate(${cx},${cy}) rotate(${dispAngle})" />`;
            } else if (type === 'X') {
                svg += `<line x1="${cx - 5}" y1="${cy - 5}" x2="${cx + 5}" y2="${cy + 5}" stroke="${obstacleColor}" stroke-width="2" />`;
                svg += `<line x1="${cx + 5}" y1="${cy - 5}" x2="${cx - 5}" y2="${cy + 5}" stroke="${obstacleColor}" stroke-width="2" />`;
            }
        };

        // Start pose
        if (vis('start')) {
            const sp = isGT ? (currentMode === 'generate' ? worldData.startPose : worldData.gt.start) : worldData.gt.start;
            if (sp) {
                const { cx, cy } = map(sp.x, sp.y, xShift);
                const dispAngle = -sp.angle;
                svg += `<g transform="translate(${cx},${cy}) rotate(${dispAngle})"><line x1="0" y1="0" x2="15" y2="0" stroke="${startColor}" stroke-width="2" /><polygon points="25,0 15,-5 15,5" fill="${startColor}" /></g>`;
            }
        }

        if (currentMode === 'generate') {
            if (currentView === 'placement') {
                const usedObjKeys = new Set([...worldData.knownObjs, ...worldData.unknownObjs].map(o => `${o.x},${o.y}`));
                const usedBoxKeys = new Set([...worldData.knownBoxes, ...worldData.unknownBoxes].map(b => `${b.x},${b.y}`));
                OBJECTS.forEach(o => {
                    const key = `${o.x},${o.y}`;
                    if (usedObjKeys.has(key)) {
                        const isKnown = worldData.knownObjs.some(k => k.x === o.x && k.y === o.y);
                        if (isKnown && vis('known_obj')) addIcon(o, 'O', objColor);
                        else if (!isKnown && vis('unknown_obj')) addIcon(o, 'O', objColor, true);
                    } else { if (vis('unused')) addIcon(o, 'O', unusedColor); }
                });
                BOXES.forEach(b => {
                    const key = `${b.x},${b.y}`;
                    if (usedBoxKeys.has(key)) {
                        const isKnown = worldData.knownBoxes.some(k => k.x === b.x && k.y === b.y);
                        if (isKnown && vis('known_box')) addIcon(b, 'B', boxColor);
                        else if (!isKnown && vis('unknown_box')) addIcon(b, 'B', boxColor, true);
                    } else { if (vis('unused')) addIcon(b, 'B', unusedColor); }
                });
                if (vis('obstacle')) worldData.obstacles.forEach(o => addIcon(o, 'X', obstacleColor));
            } else {
                if (vis('known_obj')) worldData.knownObjs.forEach(o => addIcon(o, 'O', objColor));
                if (vis('known_box')) worldData.knownBoxes.forEach(b => addIcon(b, 'B', boxColor));
                if (currentView !== 'known') {
                    if (vis('unknown_obj')) worldData.unknownObjs.forEach(o => addIcon(o, 'O', objColor, currentView === 'truth'));
                    if (vis('unknown_box')) worldData.unknownBoxes.forEach(b => addIcon(b, 'B', boxColor, currentView === 'truth'));
                    if (vis('obstacle')) worldData.obstacles.forEach(o => addIcon(o, 'X', obstacleColor));
                }
            }
        } else { // evaluate mode
            const knownGT = new Set(worldData.gt.known);
            if (isGT) {
                if (evaluationResult) {
                    const matchedGT = new Set(evaluationResult.matches.map(m => m.gt));
                    if (vis('maintained')) worldData.gt.known.filter(i => matchedGT.has(i)).forEach(i => addIcon(i, i.Type, matchKnown));
                    if (vis('discovered')) worldData.gt.unknown.filter(i => matchedGT.has(i)).forEach(i => addIcon(i, i.Type, matchUnknown));
                    if (vis('missing_u')) {
                        worldData.gt.unknown.filter(i => !matchedGT.has(i)).forEach(i => addIcon(i, i.Type, missingColor));
                    }
                    if (vis('missing_k')) {
                        const missingKnown = worldData.gt.known.filter(i => !matchedGT.has(i));
                        missingKnown.forEach(i => {
                            addIcon(i, i.Type, penaltyColor);
                            const { cx, cy } = map(i.x, i.y, xShift);
                            const ringR = Math.max(10, 14 * scale);
                            svg += `<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="${penaltyColor}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7" />`;
                        });
                    }
                } else {
                    worldData.gt.known.forEach(i => addIcon(i, i.Type, matchKnown));
                    worldData.gt.unknown.forEach(i => addIcon(i, i.Type, matchUnknown));
                }
                if (vis('obstacle')) worldData.gt.obstacles.forEach(o => addIcon(o, 'X', obstacleColor));
            } else {
                if (evaluationResult) {
                    const matchedByKnown = new Set(evaluationResult.matches.filter(m => knownGT.has(m.gt)).map(m => m.sol));
                    const matchedByUnknown = new Set(evaluationResult.matches.filter(m => !knownGT.has(m.gt)).map(m => m.sol));
                    const matchedAll = new Set([...matchedByKnown, ...matchedByUnknown]);
                    const sol = worldData.solution;
                    if (vis('maintained')) sol.filter(i => matchedByKnown.has(i)).forEach(i => addIcon(i, i.Type, matchKnown));
                    if (vis('discovered')) sol.filter(i => matchedByUnknown.has(i)).forEach(i => addIcon(i, i.Type, matchUnknown));
                    if (vis('penalty')) sol.filter(i => !matchedAll.has(i)).forEach(i => addIcon(i, i.Type, penaltyColor));
                } else {
                    worldData.solution.forEach(i => addIcon(i, i.Type, objColor));
                }
                if (vis('obstacle')) worldData.gt.obstacles.forEach(o => addIcon(o, 'X', obstacleColor));
            }
        }
    };

    if (!isSplit) {
        drawWorldSVG(0, data, currentView !== 'sol');
    } else {
        const rightShift = mapW / 2;
        svg += `<line x1="${mapOffset + rightShift}" y1="0" x2="${mapOffset + rightShift}" y2="${mapH}" stroke="${borderProm}" stroke-width="1" />`;
        svg += `<text x="${mapOffset + rightShift / 2}" y="30" fill="${textColor}" font-size="16" font-weight="bold" text-anchor="middle">GROUND TRUTH</text>`;
        svg += `<text x="${mapOffset + rightShift + rightShift / 2}" y="30" fill="${textColor}" font-size="16" font-weight="bold" text-anchor="middle">SOLUTION</text>`;
        drawWorldSVG(0, data, true);
        drawWorldSVG(rightShift, data, false);
        if (evaluationResult) {
            const knownGTSet = new Set(data.gt.known);
            evaluationResult.matches.forEach(m => {
                const isMaintained = knownGTSet.has(m.gt);
                if (isMaintained && (!vis('maintained') || !vis('matched_maintained'))) return;
                if (!isMaintained && (!vis('discovered') || !vis('matched_discovered'))) return;
                const color = isMaintained ? matchKnown : matchUnknown;
                const gl = map(m.gt.x, m.gt.y, 0), sl = map(m.sol.x, m.sol.y, rightShift);
                svg += `<line x1="${gl.cx}" y1="${gl.cy}" x2="${sl.cx}" y2="${sl.cy}" stroke="${color}" stroke-width="1" stroke-dasharray="5,5" opacity="0.6" />`;
            });
        }
    }

    // --- Info Panel (right) ---
    const rPanelX = mapOffset + mapW;
    const px = rPanelX + 18, lineH = 22;
    py = 32;

    const svgText = (x, y, text, { fill = panelText, size = 12, weight = 'normal', anchor = 'start' } = {}) =>
        svg += `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${text}</text>`;
    const svgRule = (y) =>
        svg += `<line x1="${rPanelX + 10}" y1="${y}" x2="${rPanelX + PANEL_W - 10}" y2="${y}" stroke="${borderProm}" stroke-width="1" />`;
    const svgRow = (label, value, valueColor = panelText) => {
        svgText(px, py, label, { fill: panelSecondary, size: 11 });
        svgText(rPanelX + PANEL_W - 12, py, value, { fill: valueColor, size: 11, anchor: 'end' });
        py += lineH;
    };

    svgText(px, py, 'DD2419 Map', { size: 15, weight: 'bold' }); py += 8;
    svgRule(py); py += 16;

    if (currentTask) {
        const p = currentTask.params;
        const viewNames = { truth: 'Ground Truth', known: 'Known Items', placement: 'Placement Guide', evaluation: 'Side-by-Side', solution: 'Solution' };
        svgRow('View', viewNames[currentView] || currentView);
        py += 6; svgRule(py); py += 14;
        svgText(px, py, 'SETTINGS', { fill: accentColor, size: 10, weight: 'bold' }); py += 18;
        svgRow('Known Objects', `${p.nkO}`);
        svgRow('Unknown Objects', `${p.nuO}`);
        svgRow('Known Boxes', `${p.nkB}`);
        svgRow('Unknown Boxes', `${p.nuB}`);
        svgRow('Obstacles', `${p.nObs}`);
        const { translate: tr, angleRad: ar } = currentTask.transform;
        const hasTransform = tr.x !== 0 || tr.y !== 0 || ar !== 0;
        svgRow('Transform', hasTransform ? `${tr.x},${tr.y} / ${(ar * 180 / Math.PI).toFixed(1)}°` : 'None');
    }

    if (currentMode === 'evaluate') {
        const thresh = getThreshold(), minDO = getMinDiscObj(), minDB = getMinDiscBox();
        py += 6; svgRule(py); py += 14;
        svgText(px, py, 'SETTINGS', { fill: accentColor, size: 10, weight: 'bold' }); py += 18;
        svgRow('Threshold', `${thresh} cm`);
        svgRow('Min disc. obj.', `${minDO}`);
        svgRow('Min disc. box', `${minDB}`);
    }
    if (currentMode === 'evaluate' && evaluationResult) {
        const s = evaluationResult.stats;
        const netObj = s.unknownObjMatched - s.penaltyObjs;
        const netBox = s.unknownBoxMatched - s.penaltyBoxes;
        const minDO = getMinDiscObj(), minDB = getMinDiscBox();
        const perfect = s.knownMatched === s.knownTotal && s.unknownMatched === s.unknownTotal && s.penalties === 0;
        const svgMissingMaint = s.knownTotal - s.knownMatched;
        const svgAccepted = !perfect && svgMissingMaint === 0 && netObj >= minDO && netBox >= minDB;
        const verdictText = perfect ? 'Perfect' : (svgAccepted ? 'Accepted' : 'Failed');
        const verdictColor = perfect ? successColor : (svgAccepted ? accentColor : penaltyColor);
        py += 6; svgRule(py); py += 14;
        svgText(px, py, 'RESULTS', { fill: accentColor, size: 10, weight: 'bold' }); py += 18;
        svgRow('Maint. Obj', `${s.knownObjMatched} / ${s.knownObjTotal}`, s.knownObjMatched === s.knownObjTotal ? successColor : penaltyColor);
        svgRow('Maint. Box', `${s.knownBoxMatched} / ${s.knownBoxTotal}`, s.knownBoxMatched === s.knownBoxTotal ? successColor : penaltyColor);
        svgRow('Disc. Obj', `${s.unknownObjMatched} / ${s.unknownObjTotal}`, s.unknownObjMatched === s.unknownObjTotal ? successColor : penaltyColor);
        svgRow('Disc. Box', `${s.unknownBoxMatched} / ${s.unknownBoxTotal}`, s.unknownBoxMatched === s.unknownBoxTotal ? successColor : penaltyColor);
        svgRow('Pen. Obj', `${s.penaltyObjs}`, s.penaltyObjs > 0 ? penaltyColor : panelText);
        svgRow('Pen. Box', `${s.penaltyBoxes}`, s.penaltyBoxes > 0 ? penaltyColor : panelText);
        svgRow('Net Disc. Obj', `${netObj} (need ≥ ${minDO})`, netObj >= minDO ? successColor : penaltyColor);
        svgRow('Net Disc. Box', `${netBox} (need ≥ ${minDB})`, netBox >= minDB ? successColor : penaltyColor);
        svgRow('Avg Error', `${s.avgError.toFixed(1)} cm`);
        py += 4;
        svgText(px, py, verdictText, { fill: verdictColor, size: 12, weight: 'bold' });
        py += lineH;
    }



    // --- Left Results Panel (evaluate mode only) ---
    if (LEFT_PANEL_W > 0 && evaluationResult && evalData) {
        const lp = 12; // left padding
        const lrx = LEFT_PANEL_W - lp; // right edge for right-aligned values
        const lLineH = 18;
        lpy = 28;

        const lpText = (x, y, text, { fill = panelText, size = 11, weight = 'normal', anchor = 'start' } = {}) =>
            svg += `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${text}</text>`;
        const lpRule = (y) =>
            svg += `<line x1="${lp}" y1="${y}" x2="${LEFT_PANEL_W - lp}" y2="${y}" stroke="${borderProm}" stroke-width="1" />`;


        lpText(lp, lpy, 'ITEM RESULTS', { fill: accentColor, size: 10, weight: 'bold' }); lpy += 6;
        lpRule(lpy); lpy += lLineH - 4;

        // Headers
        const hdrFill = panelSecondary;
        lpText(lp, lpy, 'Type', { fill: hdrFill, size: 8, weight: 'bold' });
        lpText(lp + 28, lpy, 'X', { fill: hdrFill, size: 8, weight: 'bold' });
        lpText(lp + 60, lpy, 'Y', { fill: hdrFill, size: 8, weight: 'bold' });
        lpText(lrx, lpy, 'Error (cm)', { fill: hdrFill, size: 8, weight: 'bold', anchor: 'end' });
        lpy += 10;
        lpRule(lpy - 2); lpy += 6;

        const knownGTSetL = new Set(evalData.gt.known);
        const matchedGTSetL = new Set(evaluationResult.matches.map(m => m.gt));
        const matchedSolSetL = new Set(evaluationResult.matches.map(m => m.sol));
        const dist2L = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

        const maintainedM = evaluationResult.matches.filter(m => knownGTSetL.has(m.gt)).sort((a, b) => a.dist - b.dist);
        const discoveredM = evaluationResult.matches.filter(m => !knownGTSetL.has(m.gt)).sort((a, b) => a.dist - b.dist);
        const missingL = [...evalData.gt.known, ...evalData.gt.unknown].filter(i => !matchedGTSetL.has(i));
        const penaltyL = evalData.solution.filter(i => !matchedSolSetL.has(i));

        const lpSection = (title, color, items, makeRow) => {
            if (!items.length) return;
            // Section header
            svg += `<circle cx="${lp + 4}" cy="${lpy - 4}" r="4" fill="${color}" />`;
            lpText(lp + 12, lpy, `${title} (${items.length})`, { fill: panelSecondary, size: 10, weight: 'bold' }); lpy += lLineH - 2;
            lpRule(lpy - lLineH / 2 + 2); lpy += 2;
            items.forEach(item => {
                makeRow(item);
                lpy += lLineH;
            });
            lpy += 4;
        };

        const lpCoord = (val) => val.toFixed(1);

        const drawRow = (item, color, distStr) => {
            const typeL = item.Type === 'B' ? 'Box' : 'Obj';
            lpText(lp, lpy, typeL, { fill: color, size: 9, weight: 'bold' });
            lpText(lp + 28, lpy, lpCoord(item._csvX ?? item.x), { size: 9 });
            lpText(lp + 60, lpy, lpCoord(item._csvY ?? item.y), { size: 9 });
            if (distStr !== null) lpText(lrx, lpy, distStr, { fill: color, size: 9, anchor: 'end' });
        };

        lpSection('Maintained', matchKnown, maintainedM, (m) => drawRow(m.gt, matchKnown, m.dist.toFixed(1)));
        lpSection('Discovered', matchUnknown, discoveredM, (m) => drawRow(m.gt, matchUnknown, m.dist.toFixed(1)));

        const knownGTSetMiss = new Set(evalData.gt.known);
        const missingKnownL = missingL.filter(i => knownGTSetMiss.has(i));
        const missingUnknownL = missingL.filter(i => !knownGTSetMiss.has(i));
        const sortMissing = arr => arr.sort((a, b) => {
            const nearA = penaltyL.length ? Math.min(...penaltyL.map(s => dist2L(a, s))) : Infinity;
            const nearB = penaltyL.length ? Math.min(...penaltyL.map(s => dist2L(b, s))) : Infinity;
            return nearA - nearB;
        });

        lpSection('Missing', missingColor, sortMissing(missingUnknownL), (item) => {
            const near = penaltyL.length ? Math.min(...penaltyL.map(s => dist2L(item, s))) : null;
            drawRow(item, missingColor, near !== null ? near.toFixed(1) : '—');
        });
        lpSection('Known Missing', penaltyColor, sortMissing(missingKnownL), (item) => {
            const near = penaltyL.length ? Math.min(...penaltyL.map(s => dist2L(item, s))) : null;
            drawRow(item, penaltyColor, near !== null ? near.toFixed(1) : '—');
        });

        lpSection('Penalty', penaltyColor, penaltyL.sort((a, b) => {
            const nearA = missingL.length ? Math.min(...missingL.map(g => dist2L(a, g))) : Infinity;
            const nearB = missingL.length ? Math.min(...missingL.map(g => dist2L(b, g))) : Infinity;
            return nearA - nearB;
        }), (item) => {
            const near = missingL.length ? Math.min(...missingL.map(g => dist2L(item, g))) : null;
            drawRow(item, penaltyColor, near !== null ? near.toFixed(1) : '—');
        });
    }

    // --- Legend (bottom) ---
    const legendPadding = 24;
    let lx = mapOffset + legendPadding;
    ly = mapH + 30;
    svgText(lx, ly, 'LEGEND', { fill: accentColor, size: 10, weight: 'bold' });
    ly += 18;
    const startLX = lx;

    const sw = 11, sh = 11;
    const addLegendItem = (label, color, type) => {
        const sx = lx, sy = ly - sh + 2;
        if (type === 'filled') svg += `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="${color}" rx="1" />`;
        if (type === 'outline') svg += `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="none" stroke="${color}" stroke-width="1.5" rx="1" />`;
        if (type === 'line') svg += `<line x1="${sx}" y1="${sy + sh / 2}" x2="${sx + sw}" y2="${sy + sh / 2}" stroke="${color}" stroke-width="2.5" />`;
        if (type === 'cross') { svg += `<line x1="${sx}" y1="${sy}" x2="${sx + sw}" y2="${sy + sh}" stroke="${color}" stroke-width="1.5" />`; svg += `<line x1="${sx + sw}" y1="${sy}" x2="${sx}" y2="${sy + sh}" stroke="${color}" stroke-width="1.5" />`; }
        if (type === 'arrow') { svg += `<line x1="${sx}" y1="${sy + sh / 2}" x2="${sx + sw - 3}" y2="${sy + sh / 2}" stroke="${color}" stroke-width="1.5" />`; svg += `<polygon points="${sx + sw},${sy + sh / 2} ${sx + sw - 5},${sy + sh / 2 - 3} ${sx + sw - 5},${sy + sh / 2 + 3}" fill="${color}" />`; }
        if (type === 'dashed') { svg += `<line x1="${sx}" y1="${sy + sh / 2}" x2="${sx + sw}" y2="${sy + sh / 2}" stroke="${color}" stroke-width="1.5" stroke-dasharray="3,2" />`; }
        svgText(lx + sw + 7, ly, label, { fill: panelText, size: 11 });

        lx += 150; // column width
        if (lx + 140 > mapOffset + mapW - legendPadding) {
            lx = startLX;
            ly += 22;
        }
    };

    addLegendItem('Workspace', wsColor, 'line');
    addLegendItem('Start Pose', startColor, 'arrow');
    if (currentMode === 'generate') {
        addLegendItem('Known Object', objColor, 'filled');
        addLegendItem('Known Box', boxColor, 'filled');
        if (currentView !== 'known') {
            addLegendItem('Unknown Object', objColor, 'outline');
            addLegendItem('Unknown Box', boxColor, 'outline');
            addLegendItem('Obstacle', obstacleColor, 'cross');
        }
        if (currentView === 'placement') addLegendItem('Unused', unusedColor, 'filled');
    } else {
        addLegendItem('Obstacle', obstacleColor, 'cross');
        if (currentView !== 'sol') {
            addLegendItem('Maintained', matchKnown, 'filled');
            addLegendItem('Discovered', matchUnknown, 'filled');
            const svgHasMissingUnknown = evaluationResult && data && (() => { const m = new Set(evaluationResult.matches.map(x => x.gt)); return data.gt.unknown.some(i => !m.has(i)); })();
            if (!evaluationResult || svgHasMissingUnknown) addLegendItem('Missing', missingColor, 'filled');
            const svgHasMissingKnown = evaluationResult && data && (() => { const m = new Set(evaluationResult.matches.map(x => x.gt)); return data.gt.known.some(i => !m.has(i)); })();
            if (svgHasMissingKnown) addLegendItem('Known Missing', penaltyColor, 'filled');
        }
        if (currentView !== 'gt') {
            if (currentView === 'sol') {
                addLegendItem('Maintained', matchKnown, 'filled');
                addLegendItem('Discovered', matchUnknown, 'filled');
            }
            addLegendItem('Penalty', penaltyColor, 'filled');
        }
        if (currentView === 'all') {
            addLegendItem('Maintained match', matchKnown, 'dashed');
            addLegendItem('Discovered match', matchUnknown, 'dashed');
        }
    }

    const finalH = Math.max(mapH, py, lpy, ly + 20);
    svg += `</svg>`;
    return svg.replaceAll('##HEIGHT##', finalH);
}

// --- INITIALIZE ---
function setupFileDropZones() {
    document.querySelectorAll('.file-drop-zone').forEach(zone => {
        const input = zone.querySelector('input[type="file"]');
        const nameEl = zone.querySelector('.file-drop-name');

        zone.addEventListener('click', e => { if (e.target !== input) input.click(); });

        const updateDisplay = () => {
            const name = input.files[0]?.name ?? '';
            nameEl.textContent = name;
            zone.classList.toggle('has-file', !!name);
        };
        input.addEventListener('change', updateDisplay);

        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const file = [...e.dataTransfer.files].find(f => f.name.endsWith('.csv'));
            if (!file) return;
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });
}

function wrapNumberInputs() {
    document.querySelectorAll('input[type="number"]:not(.no-spin)').forEach(input => {
        const wrap = document.createElement('div');
        wrap.className = 'num-spin-wrap';
        input.parentNode.insertBefore(wrap, input);

        const makeBtn = (label, delta) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'num-spin-btn';
            btn.textContent = label;

            const doStep = () => {
                const s = +(input.step || 1);
                const cur = parseFloat(input.value) || 0;
                const min = input.min !== '' ? +input.min : -Infinity;
                const max = input.max !== '' ? +input.max : Infinity;
                const next = Math.max(min, Math.min(max, cur + delta * s));
                if (next === +input.value) return false;
                input.value = next;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            };

            let repeatTimer = null;
            const stopRepeat = () => { clearInterval(repeatTimer); repeatTimer = null; };

            btn.addEventListener('mousedown', e => {
                e.preventDefault(); // keep focus on input
                if (!doStep()) return;
                repeatTimer = setTimeout(() => {
                    repeatTimer = setInterval(() => { if (!doStep()) stopRepeat(); }, 60);
                }, 400);
            });
            document.addEventListener('mouseup', stopRepeat);
            btn.addEventListener('mouseleave', () => { if (repeatTimer) stopRepeat(); });

            return btn;
        };

        wrap.appendChild(makeBtn('−', -1));
        wrap.appendChild(input);
        wrap.appendChild(makeBtn('+', 1));
    });
}

window.onload = () => {
    loadSettings();

    document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => switchMode(b.dataset.mode));
    document.querySelectorAll('.eval-sidebar-tab').forEach(b => b.onclick = () => switchEvalSidebarTab(b.dataset.panel));
    document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.onclick = () => {
        document.querySelectorAll('.tab-btn[data-tab]').forEach(t => t.classList.remove('active'));
        b.classList.add('active'); currentView = b.dataset.tab; if (currentMode === 'generate') lastGenerateView = currentView; mapCanvas.style.cursor = currentView === 'placement' ? 'crosshair' : ''; draw();
    });
    document.getElementById('resampleObsBtn')?.addEventListener('click', async () => {
        if (!currentTask) return;
        const base = currentTask.base;
        const nObs = base.obstacles.length;
        base.obstacles.length = 0;
        const forbidden = [base.startPose, ...base.knownObjs, ...base.unknownObjs, ...base.knownBoxes, ...base.unknownBoxes];
        let attempts = 0;
        while (base.obstacles.length < nObs && attempts < 200) {
            const obs = {
                x: Math.round(OBSTACLE_X_RANGE[0] + Math.random() * (OBSTACLE_X_RANGE[1] - OBSTACLE_X_RANGE[0])),
                y: Math.round(OBSTACLE_Y_RANGE[0] + Math.random() * (OBSTACLE_Y_RANGE[1] - OBSTACLE_Y_RANGE[0]))
            };
            if (![...forbidden, ...base.obstacles].some(f => Math.hypot(f.x - obs.x, f.y - obs.y) < OBSTACLE_DISTANCE_THRESHOLD))
                base.obstacles.push(obs);
            attempts++;
        }
        const tx = parseFloat(document.getElementById('transformX').value) || 0;
        const ty = parseFloat(document.getElementById('transformY').value) || 0;
        const ar = (parseFloat(document.getElementById('transformAngle').value) || 0) * Math.PI / 180;
        currentTask.transform = { translate: { x: tx, y: ty }, angleRad: ar };
        syncTransformedFromBase();
        currentTask.taskId = await buildTaskId(currentTask);
        history.replaceState(null, '', '#' + currentTask.taskId);
        draw();
    });

    let transformLocked = true;
    const lockTransformBtn = document.getElementById('lockTransformBtn');
    lockTransformBtn?.addEventListener('click', () => {
        transformLocked = !transformLocked;
        lockTransformBtn.classList.toggle('locked', transformLocked);
        lockTransformBtn.title = transformLocked
            ? 'Transform is locked — Randomize will not change it'
            : 'Transform is unlocked — Randomize will generate a new transform';
    });

    function randomizeTransform() {
        document.getElementById('transformX').value = Math.round((Math.random() - 0.5) * 1000);
        document.getElementById('transformY').value = Math.round((Math.random() - 0.5) * 400);
        document.getElementById('transformAngle').value = Math.round(Math.random() * 360);
        saveSettings();
        applyTransformInputs();
    }

    document.getElementById('randomizeTransformBtn')?.addEventListener('click', randomizeTransform);
    document.getElementById('resetTransformBtn')?.addEventListener('click', () => {
        document.getElementById('transformX').value = 0;
        document.getElementById('transformY').value = 0;
        document.getElementById('transformAngle').value = 0;
        applyTransformInputs();
    });
    document.getElementById('generateBtn').onclick = () => {
        if (!transformLocked) randomizeTransform();
        generateTask();
    };
    document.getElementById('btnGridToggle')?.addEventListener('click', () => { showGrid = !showGrid; document.getElementById('btnGridToggle').classList.toggle('active', showGrid); draw(); });
    document.getElementById('btnCopyCanvas')?.addEventListener('click', copyCanvasToClipboard);
    document.getElementById('copySeedBtn').onclick = copySeed;
    document.getElementById('displaySeed').onclick = copySeed;

    // QR code modal
    document.getElementById('qrSeedBtn')?.addEventListener('click', () => {
        const url = window.location.href;
        const container = document.getElementById('qrCodeContainer');
        const modal = document.getElementById('qrModal');
        container.innerHTML = '';
        if (typeof QRCode !== 'undefined') {
            new QRCode(container, { text: url, width: 420, height: 420, colorDark: '#000000', colorLight: '#ffffff' });
        } else {
            container.textContent = url;
        }
        modal.classList.remove('hidden');
    });
    document.getElementById('qrModalClose')?.addEventListener('click', () => document.getElementById('qrModal').classList.add('hidden'));
    document.getElementById('qrModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden'); });
    document.getElementById('qrCopyLinkBtn')?.addEventListener('click', () => {
        const url = window.location.href;
        if (!url) return;
        navigator.clipboard.writeText(url).then(() => {
            const btn = document.getElementById('qrCopyLinkBtn');
            btn.classList.add('copied');
            setTimeout(() => btn.classList.remove('copied'), 1800);
        }).catch(() => { });
    });

    // Keyboard shortcuts modal
    document.getElementById('shortcutsBtn')?.addEventListener('click', () => document.getElementById('shortcutsModal').classList.toggle('hidden'));
    document.getElementById('shortcutsModalClose')?.addEventListener('click', () => document.getElementById('shortcutsModal').classList.add('hidden'));
    document.getElementById('shortcutsModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden'); });

    // Keep object/box known+unknown totals within pool size.
    // The changed field has priority: keep its value if achievable, then adjust the other.
    const nkOEl = document.getElementById('knownObjects');
    const nuOEl = document.getElementById('unknownObjects');
    const nkBEl = document.getElementById('knownBoxes');
    const nuBEl = document.getElementById('unknownBoxes');

    function syncPair(changedEl, otherEl, pool) {
        const changedMin = +changedEl.min, otherMin = +otherEl.min;
        // Clamp changed field to its absolute valid range (priority: keep user's value if achievable)
        changedEl.max = pool - otherMin;
        changedEl.value = Math.max(changedMin, Math.min(pool - otherMin, parseInt(changedEl.value) || changedMin));
        // Clamp other field's value to fit the remaining budget, but keep its max at the absolute
        // ceiling so spinner arrows are never locked out when the changed field changes later
        const remaining = pool - +changedEl.value;
        otherEl.max = pool - changedMin;
        if (+otherEl.value > remaining) otherEl.value = Math.max(otherMin, remaining);
    }

    nkOEl.addEventListener('change', () => { syncPair(nkOEl, nuOEl, OBJECTS.length); saveSettings(); applyItemInputs(); });
    nuOEl.addEventListener('change', () => { syncPair(nuOEl, nkOEl, OBJECTS.length); saveSettings(); applyItemInputs(); });
    nkBEl.addEventListener('change', () => { syncPair(nkBEl, nuBEl, BOXES.length); saveSettings(); applyItemInputs(); });
    nuBEl.addEventListener('change', () => { syncPair(nuBEl, nkBEl, BOXES.length); saveSettings(); applyItemInputs(); });
    document.getElementById('obstaclesCount')?.addEventListener('change', () => { saveSettings(); applyItemInputs(); });
    ['transformX', 'transformY', 'transformAngle'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => {
            saveSettings();
            applyTransformInputs();
        });
    });

    document.getElementById('evalThreshold').addEventListener('input', () => {
        if (evaluationResult) {
            runTaskEvaluation(false);
        } else { draw(); }
    });

    ['minDiscObj', 'minDiscBox'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => {
            if (evaluationResult) { displayResults(); draw(); }
        });
    });

    document.getElementById('seedSolutionFile').onchange = (e) => {
        if (!e.target.files[0]) return;
        runTaskEvaluation();
    };


    const canvasContainer = document.querySelector('.canvas-container');
    canvasContainer.addEventListener('dragover', (e) => {
        if (currentMode !== 'evaluate') return;
        const file = [...(e.dataTransfer?.items ?? [])].find(i => i.kind === 'file' && i.type === 'text/csv' || i.name?.endsWith('.csv'));
        if (!file) return;
        e.preventDefault();
        canvasContainer.classList.add('canvas-drop-active');
        if (evalData) document.getElementById('canvasDropOverlay')?.classList.remove('hidden');
    });
    canvasContainer.addEventListener('dragleave', (e) => {
        if (!canvasContainer.contains(e.relatedTarget)) {
            canvasContainer.classList.remove('canvas-drop-active');
            document.getElementById('canvasDropOverlay')?.classList.add('hidden');
        }
    });
    canvasContainer.addEventListener('drop', (e) => {
        canvasContainer.classList.remove('canvas-drop-active');
        document.getElementById('canvasDropOverlay')?.classList.add('hidden');
        if (currentMode !== 'evaluate') return;
        const file = [...e.dataTransfer.files].find(f => f.name.endsWith('.csv'));
        if (!file) return;
        e.preventDefault();
        const dt = new DataTransfer();
        dt.items.add(file);
        const solInput = document.getElementById('seedSolutionFile');
        solInput.files = dt.files;
        solInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    document.getElementById('mapCanvas').onmouseleave = () => {
        hoverItem = null;
        hoverWorldCoords = null;
        hoverInWorkspace = false;
        document.getElementById('mapTooltip').classList.add('hidden');
        draw();
    };
    document.getElementById('mapCanvas').onmousemove = (e) => {
        if (vpDragStart) return; // Don't update hover during drag pan

        const canvas = e.target;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Store mouse positions for canvas coord readout and fixed tooltip positioning
        const containerRect = canvas.parentElement.getBoundingClientRect();
        hoverMouse = { x: e.clientX - containerRect.left, y: e.clientY - containerRect.top };
        hoverViewport = { x: e.clientX, y: e.clientY };

        const data = currentMode === 'generate' ? (currentTask ? (currentView === 'placement' ? currentTask.base : currentTask.transformed) : null) : evalData;
        if (!data) { hoverWorldCoords = null; return; }

        const ws = (currentMode === 'generate' && currentView === 'placement') ? WORKSPACE_DATA : data.workspace;
        const minX = Math.min(...ws.map(p => p.x)), maxX = Math.max(...ws.map(p => p.x)), minY = Math.min(...ws.map(p => p.y)), maxY = Math.max(...ws.map(p => p.y));
        const pad = 120;

        const dataW = maxX - minX + pad * 2;
        const dataH = maxY - minY + pad * 2;
        const isSplit = (currentMode === 'evaluate');
        const viewWidth = isSplit ? canvas.width / 2 : canvas.width;
        const scale = Math.min(viewWidth / dataW, canvas.height / dataH);
        const offX = (viewWidth - dataW * scale) / 2;
        const offY = (canvas.height - dataH * scale) / 2;

        // Scale mouse position to canvas internal coords (canvas may be CSS-scaled)
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const cx = x * scaleX, cy = y * scaleY;

        // Un-apply viewport transform for hit testing
        const pivotXdpr = canvas.width / 2;
        const pivotYdpr = canvas.height / 2;
        const ucx = (cx - pivotXdpr - vpPanX * scaleX) / vpZoom + pivotXdpr;
        const ucy = (cy - pivotYdpr - vpPanY * scaleY) / vpZoom + pivotYdpr;

        // In split view strip the right-panel x-shift so both halves share the same world coords
        const panelCx = isSplit ? ucx % (canvas.width / 2) : ucx;
        const tx = ((panelCx - offX) / scale) + minX - pad;
        const ty = maxY - ((ucy - offY) / scale) + pad;
        hoverWorldCoords = { x: tx, y: ty };
        hoverInWorkspace = (currentMode === 'generate' && currentView === 'placement')
            ? pointInPolygon({ x: tx, y: ty }, WORKSPACE_DATA) : false;

        let all = [];
        if (currentMode === 'generate') {
            const label = (base, type) => i => ({ ...i, _label: `${base} ${type}` });
            if (currentView === 'placement') {
                const usedObjKeys = new Set([...data.knownObjs, ...data.unknownObjs].map(o => `${o.x},${o.y}`));
                const usedBoxKeys = new Set([...data.knownBoxes, ...data.unknownBoxes].map(b => `${b.x},${b.y}`));
                const activeX = data.startPose?.x, activeY = data.startPose?.y, activeA = data.startPose?.angle;
                // Group START_POSES by position so shared locations show one hover item with all angles
                const _spGroups = {};
                START_POSES.forEach(p => { const k = `${p.x},${p.y}`; (_spGroups[k] = _spGroups[k] || []).push(p); });
                all = [
                    ...Object.values(_spGroups).map(poses => {
                        const activePose = poses.find(p => p.x === activeX && p.y === activeY && p.angle === activeA);
                        const display = activePose || poses[0];
                        const multi = poses.length > 1;
                        const label = activePose ? 'Start Pose (active)' : 'Start Pose';
                        return {
                            ...display,
                            _label: label,
                            ...(multi ? { _poseAngles: poses.map(p => ({ angle: p.angle, isActive: p === activePose })) } : {})
                        };
                    }),
                    ...OBJECTS.map(o => ({
                        ...o,
                        _label: usedObjKeys.has(`${o.x},${o.y}`)
                            ? (data.knownObjs.some(k => k.x === o.x && k.y === o.y) ? 'Known Object' : 'Unknown Object')
                            : 'Unused Object'
                    })),
                    ...BOXES.map(b => ({
                        ...b,
                        _label: usedBoxKeys.has(`${b.x},${b.y}`)
                            ? (data.knownBoxes.some(k => k.x === b.x && k.y === b.y) ? 'Known Box' : 'Unknown Box')
                            : 'Unused Box'
                    })),
                    ...data.obstacles.map(i => ({ ...i, _label: 'Obstacle' })),
                ];
            } else {
                all = [
                    { ...data.startPose, _label: 'Start Pose' },
                    ...data.knownObjs.map(label('Known', 'Object')),
                    ...data.knownBoxes.map(label('Known', 'Box')),
                ];
                if (currentView !== 'known') all = [...all,
                ...data.unknownObjs.map(label('Unknown', 'Object')),
                ...data.unknownBoxes.map(label('Unknown', 'Box')),
                ...data.obstacles.map(i => ({ ...i, _label: 'Obstacle' })),
                ];
            }
        } else {
            const knownGTSet = new Set(data.gt.known);
            const matchedByKnown = evaluationResult ? new Set(evaluationResult.matches.filter(m => knownGTSet.has(m.gt)).map(m => m.sol)) : new Set();
            const matchedByUnknown = evaluationResult ? new Set(evaluationResult.matches.filter(m => !knownGTSet.has(m.gt)).map(m => m.sol)) : new Set();
            const matchedGTSet = evaluationResult ? new Set(evaluationResult.matches.map(m => m.gt)) : new Set();
            const gtLabel = i => {
                const t = i.Type === 'B' ? 'Box' : 'Object';
                if (!evaluationResult) return (knownGTSet.has(i) ? 'Maintained' : 'Discovered') + ` ${t}`;
                if (!matchedGTSet.has(i)) return `Missing ${t}`;
                return (knownGTSet.has(i) ? 'Maintained' : 'Discovered') + ` ${t}`;
            };
            const solLabel = i => {
                const t = i.Type === 'B' ? 'Box' : 'Object';
                if (!evaluationResult) return `Solution ${t}`;
                if (matchedByKnown.has(i)) return `Maintained ${t}`;
                if (matchedByUnknown.has(i)) return `Discovered ${t}`;
                return `Penalty ${t}`;
            };
            const mouseIsRight = isSplit && ucx > canvas.width / 2;
            all = [
                { ...data.gt.start, _label: 'Start Pose', _side: 'both' },
                ...[...data.gt.known, ...data.gt.unknown].map(i => ({ ...i, _label: gtLabel(i), _ref: i, _side: 'left' })),
                ...data.gt.obstacles.map(i => ({ ...i, _label: 'Obstacle', _side: 'both' })),
                ...data.solution.map(i => ({ ...i, _label: solLabel(i), _ref: i, _side: 'right' })),
            ];
            // In split view, only snap to items on the side the mouse is over
            if (isSplit) all = all.filter(i => i._side === 'both' || i._side === (mouseIsRight ? 'right' : 'left'));
        }

        // Hit radius in canvas coords, capped to a reasonable world-unit threshold
        const hitRadius = Math.max(15, 30 / scale);
        let near = null, minDist = hitRadius;
        all.forEach(i => { if (!i) return; const d = Math.sqrt((i.x - tx) ** 2 + (i.y - ty) ** 2); if (d < minDist) { minDist = d; near = i; } });

        // Match-line hit detection in canvas space (lines span both panels, transform-aware)
        let nearMatch = null;
        if (!near && isSplit && evaluationResult) {
            const knownGTSetHit = new Set(evalData.gt.known);
            const offX_left = offX;
            const _vx = bx => vpZoom * (bx - pivotXdpr) + pivotXdpr + vpPanX * scaleX;
            const _vy = by => vpZoom * (by - pivotYdpr) + pivotYdpr + vpPanY * scaleY;
            const canvasXL = wx => _vx(offX_left + (wx - minX + pad) * scale);
            const canvasXR = wx => _vx(offX_left + canvas.width / 2 + (wx - minX + pad) * scale);
            const canvasYc = wy => _vy(offY + (maxY - wy + pad) * scale);
            const lineHitPx = 8;
            let minLineDist = lineHitPx;
            evaluationResult.matches.forEach(m => {
                const isMaintained = knownGTSetHit.has(m.gt);
                if (isMaintained && (!vis('maintained') || !vis('matched_maintained'))) return;
                if (!isMaintained && (!vis('discovered') || !vis('matched_discovered'))) return;
                const d = pointToSegmentDist(cx, cy, canvasXL(m.gt.x), canvasYc(m.gt.y), canvasXR(m.sol.x), canvasYc(m.sol.y));
                if (d < minLineDist) { minLineDist = d; nearMatch = { _isMatch: true, _matchRef: m, _label: 'Match' }; }
            });
        }

        hoverItem = near || nearMatch;
        if (currentMode === 'generate' && currentView === 'placement' && !placementObsDrag) {
            mapCanvas.style.cursor = hoverItem?._label === 'Obstacle' ? 'grab' : (hoverItem ? 'pointer' : 'crosshair');
        }
        draw();
    };

    // Default view width
    document.getElementById('mapCanvas').width = 1200;

    initTheme();
    document.getElementById('themeToggle').onclick = toggleTheme;

    setupFileDropZones();
    wrapNumberInputs();
    window.onresize = draw;
    const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    themeMediaQuery.addEventListener('change', draw);
    switchMode('generate');

    // --- VIEWPORT ZOOM/PAN HANDLERS ---
    const mapCanvas = document.getElementById('mapCanvas');

    // Wheel zoom (zoom toward cursor)
    mapCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = e.target.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newZoom = Math.max(0.3, Math.min(10, vpZoom * factor));
        const af = newZoom / vpZoom;
        const pivX = rect.width / 2, pivY = rect.height / 2;
        vpPanX += (mx - pivX - vpPanX) * (1 - af);
        vpPanY += (my - pivY - vpPanY) * (1 - af);
        vpZoom = newZoom;
        draw();
    }, { passive: false });

    // Drag pan (and obstacle drag in placement view)
    mapCanvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        // In placement view, dragging an obstacle moves it instead of panning
        if (currentMode === 'generate' && currentView === 'placement' && currentTask && hoverItem?._label === 'Obstacle') {
            const idx = currentTask.base.obstacles.findIndex(o => o.x === hoverItem.x && o.y === hoverItem.y);
            if (idx >= 0) {
                const world = canvasEventToWorld(e);
                const obs = currentTask.base.obstacles[idx];
                placementObsDrag = { idx, offsetX: obs.x - world.x, offsetY: obs.y - world.y };
                placementDragJustCompleted = false;
                mapCanvas.style.cursor = 'grabbing';
                return;
            }
        }
        vpDragStart = { x: e.clientX, y: e.clientY, panX: vpPanX, panY: vpPanY };
        mapCanvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
        if (placementObsDrag && currentTask) {
            const world = canvasEventToWorld(e);
            const newX = world.x + placementObsDrag.offsetX;
            const newY = world.y + placementObsDrag.offsetY;
            if (pointInPolygon({ x: newX, y: newY }, WORKSPACE_DATA)) {
                const obs = currentTask.base.obstacles[placementObsDrag.idx];
                obs.x = newX;
                obs.y = newY;
            }
            placementDragJustCompleted = true;
            mapCanvas.style.cursor = 'grabbing';
            draw();
            return;
        }
        if (!vpDragStart) return;
        vpPanX = vpDragStart.panX + (e.clientX - vpDragStart.x);
        vpPanY = vpDragStart.panY + (e.clientY - vpDragStart.y);
        draw();
    });
    window.addEventListener('mouseup', async () => {
        if (placementObsDrag && currentTask) {
            if (placementDragJustCompleted) {
                syncTransformedFromBase();
                currentTask.taskId = await buildTaskId(currentTask);
                history.replaceState(null, '', '#' + currentTask.taskId);
                draw();
            }
            placementObsDrag = null;
            mapCanvas.style.cursor = hoverItem?._label === 'Obstacle' ? 'grab' : (hoverItem ? 'pointer' : '');
            return;
        }
        if (vpDragStart) { vpDragStart = null; mapCanvas.style.cursor = ''; }
    });

    // Double-click: reset viewport on empty space
    mapCanvas.addEventListener('dblclick', () => {
        if (!hoverItem) {
            pinnedItem = null;
            resetViewport();
            draw();
        }
    });

    // Single-click: placement guide toggle / add obstacle, or clear pin on empty space
    mapCanvas.addEventListener('click', (_e) => {
        if (placementDragJustCompleted) { placementDragJustCompleted = false; return; }
        if (currentMode === 'generate' && currentView === 'placement' && currentTask) {
            if (hoverItem) {
                handlePlacementClick(hoverItem);
            } else {
                // Empty space → add obstacle at cursor (only inside workspace)
                const clickWorld = canvasEventToWorld(_e);
                if (!pointInPolygon({ x: clickWorld.x, y: clickWorld.y }, WORKSPACE_DATA)) return;
                currentTask.base.obstacles.push({ x: clickWorld.x, y: clickWorld.y });
                syncPlacementInputs();
                syncTransformedFromBase();
                buildTaskId(currentTask).then(id => {
                    currentTask.taskId = id;
                    history.replaceState(null, '', '#' + currentTask.taskId);
                });
                draw();
            }
            return;
        }
        if (!hoverItem && pinnedItem) { pinnedItem = null; draw(); }
    });

    // Touch pinch-to-zoom + single-finger pan
    mapCanvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length === 2) {
            vpTouchState = 'pinch';
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            vpLastPinchDist = Math.sqrt(dx * dx + dy * dy);
            vpLastPinchCx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            vpLastPinchCy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        } else if (e.touches.length === 1) {
            vpTouchState = 'pan';
            vpDragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, panX: vpPanX, panY: vpPanY };
        }
    }, { passive: false });
    mapCanvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (vpTouchState === 'pinch' && e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const newDist = Math.sqrt(dx * dx + dy * dy);
            const newCx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const newCy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const factor = newDist / vpLastPinchDist;
            const newZoom = Math.max(0.3, Math.min(10, vpZoom * factor));
            const rect = e.target.getBoundingClientRect();
            const mx = newCx - rect.left, my = newCy - rect.top;
            const pivX = rect.width / 2, pivY = rect.height / 2;
            vpPanX += (mx - pivX - vpPanX) * (1 - factor) + (newCx - vpLastPinchCx);
            vpPanY += (my - pivY - vpPanY) * (1 - factor) + (newCy - vpLastPinchCy);
            vpZoom = newZoom;
            vpLastPinchDist = newDist; vpLastPinchCx = newCx; vpLastPinchCy = newCy;
            draw();
        } else if (vpTouchState === 'pan' && e.touches.length === 1 && vpDragStart) {
            vpPanX = vpDragStart.panX + (e.touches[0].clientX - vpDragStart.x);
            vpPanY = vpDragStart.panY + (e.touches[0].clientY - vpDragStart.y);
            draw();
        }
    }, { passive: false });
    mapCanvas.addEventListener('touchend', () => { vpTouchState = null; vpDragStart = null; });

    // --- KEYBOARD SHORTCUTS ---
    document.addEventListener('keydown', (e) => {
        if (e.target.matches('input, textarea, select')) return;
        switch (e.key) {
            case 'g': case 'G':
                showGrid = !showGrid;
                document.getElementById('btnGridToggle')?.classList.toggle('active', showGrid);
                draw();
                break;
            case ' ':
                e.preventDefault();
                if (currentMode === 'generate') generateTask();
                break;
            case 'ArrowUp': {
                e.preventDefault();
                if (currentMode === 'generate') {
                    const tabs = [...document.querySelectorAll('.tab-btn[data-tab]')];
                    const idx = tabs.findIndex(t => t.classList.contains('active'));
                    if (idx > 0) tabs[idx - 1].click();
                }
                break;
            }
            case 'ArrowDown': {
                e.preventDefault();
                if (currentMode === 'generate') {
                    const tabs = [...document.querySelectorAll('.tab-btn[data-tab]')];
                    const idx = tabs.findIndex(t => t.classList.contains('active'));
                    if (idx < tabs.length - 1) tabs[idx + 1].click();
                }
                break;
            }
            case 'ArrowLeft':
                e.preventDefault();
                switchMode('generate');
                break;
            case 'ArrowRight':
                e.preventDefault();
                switchMode('evaluate');
                break;
            case 'r': case 'R':
                resetViewport(); draw();
                break;
            case '?':
                document.getElementById('shortcutsModal')?.classList.toggle('hidden');
                break;
            case 'Escape':
                document.getElementById('shortcutsModal')?.classList.add('hidden');
                document.getElementById('qrModal')?.classList.add('hidden');
                break;
        }
    });

    // --- RECENT SEEDS RENDER ---
    renderRecentSeeds();
    renderEvalHistory();

    // --- URL HASH RESTORE ---
    const hash = window.location.hash.slice(1);
    if (/^[A-Za-z0-9\-_]{50,}$/.test(hash)) {
        // New format: base64 taskId
        loadTaskFromId(hash);
    } else {
        draw();
    }
};
