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
let hoverMouse = { x: 0, y: 0 }; // Mouse position relative to canvas element (CSS px)
const layerVisible = {}; // false = hidden, undefined/true = visible
const vis = (key) => layerVisible[key] !== false;

function getThreshold() { return Math.max(0, parseInt(document.getElementById('evalThreshold')?.value) || 20); }

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

function copySeed() {
    const seed = document.getElementById('displaySeed').textContent;
    if (seed === '-') return;
    navigator.clipboard.writeText(seed).then(() => {
        const btn = document.getElementById('copySeedBtn');
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 2000);
    }).catch(err => {
        console.error("Failed to copy seed: ", err);
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
    currentMode = mode;
    panelHoverItem = null;
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
        if (currentView === 'all') currentView = 'truth';
        document.getElementById('downloads').classList.toggle('hidden', !currentTask);
        ['btnDLWorkspace', 'btnDLMap', 'btnDLGT'].forEach(id => document.getElementById(id).style.display = 'inline-block');
        tabSeedBadge.classList.toggle('hidden', !currentTask);
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === currentView));
    } else {
        tabsEl.classList.add('hidden');
        currentView = 'all';
        document.getElementById('downloads').classList.add('hidden');
        ['btnDLWorkspace', 'btnDLMap', 'btnDLGT'].forEach(id => document.getElementById(id).style.display = 'none');
        tabSeedBadge.classList.add('hidden');
        // Reset single-file seed UI
        document.getElementById('seedExtracted')?.classList.add('hidden');
        document.getElementById('seedManualEntry')?.classList.add('hidden');
        switchEvalSidebarTab('input');
    }
    draw();
}

function generateTask() {
    const seedInputEl = document.getElementById('seedInput');
    const seedVal = seedInputEl.value.trim();

    // UI Parameters
    const params = {
        nkO: parseInt(document.getElementById('knownObjects').value),
        nuO: parseInt(document.getElementById('unknownObjects').value),
        nkB: parseInt(document.getElementById('knownBoxes').value),
        nuB: parseInt(document.getElementById('unknownBoxes').value),
        nObs: parseInt(document.getElementById('obstaclesCount').value),
        doTrans: document.getElementById('transformWorkspace').checked ? 1 : 0
    };

    const parsedSeedVal = parseInt(seedVal);
    const isAuto = !seedVal || parsedSeedVal === 0;
    const randomSeed = isAuto ? Math.floor(Math.random() * 1000000) : parsedSeedVal;
    const fullSeed = `${params.nkO}_${params.nuO}_${params.nkB}_${params.nuB}_${params.nObs}_${params.doTrans}_${randomSeed}`;

    setSeed(randomSeed);
    document.getElementById('displaySeed').textContent = fullSeed;
    document.getElementById('tabSeedBadge').classList.remove('hidden');

    // Clear input so next click generates a fresh random map
    seedInputEl.value = "";

    currentTask = recreateTask(params.nkO, params.nuO, params.nkB, params.nuB, params.nObs, !!params.doTrans);
    document.getElementById('downloads').classList.remove('hidden');
    updateSaveTooltips();
    draw();
}

function updateSaveTooltips() {
    const seed = currentTask ? csvSeedStr() : null;
    document.querySelectorAll('.sbt-file[data-suffix]').forEach(el => {
        el.textContent = seed ? seed + el.dataset.suffix : '*' + el.dataset.suffix;
    });
}

/** Recreates task data given parameters and an active PRNG */
function recreateTask(nkO, nuO, nkB, nuB, nObs, doTrans) {
    const startPose = sample(START_POSES, 1)[0];
    const allObjs = sample(OBJECTS, nkO + nuO);
    const knownObjs = allObjs.slice(0, nkO);
    const unknownObjs = allObjs.slice(nkO);

    const allBoxes = sample(BOXES, nkB + nuB);
    const knownBoxes = allBoxes.slice(0, nkB);
    const unknownBoxes = allBoxes.slice(nkB);

    const obstacles = [];
    const forbidden = [startPose, ...allObjs, ...allBoxes];
    let attempts = 0;
    while (obstacles.length < nObs && attempts < 100) {
        const obs = { x: randomInt(OBSTACLE_X_RANGE[0], OBSTACLE_X_RANGE[1]), y: randomInt(OBSTACLE_Y_RANGE[0], OBSTACLE_Y_RANGE[1]) };
        const tooClose = forbidden.some(f => Math.sqrt((f.x - obs.x) ** 2 + (f.y - obs.y) ** 2) < OBSTACLE_DISTANCE_THRESHOLD) ||
            obstacles.some(o => Math.sqrt((o.x - obs.x) ** 2 + (o.y - obs.y) ** 2) < OBSTACLE_DISTANCE_THRESHOLD);
        if (!tooClose) obstacles.push(obs);
        attempts++;
    }

    const translate = doTrans ? { x: randomInt(-500, 500), y: randomInt(-500, 500) } : { x: 0, y: 0 };
    const angleRad = doTrans ? (getRand() * 2 * Math.PI) : 0;

    const transform = (i) => applyTransform(i, translate, angleRad);
    const transformPoint = (p) => { const r = rotatePoint(p.x, p.y, angleRad); return { x: r.x + translate.x, y: r.y + translate.y }; };
    return {
        seed: currentSeed,
        params: { nkO, nuO, nkB, nuB, nObs, doTrans },
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

async function runEvaluation() {
    const files = {
        ws: document.getElementById('workspaceFile').files[0],
        map: document.getElementById('mapFile').files[0],
        comp: document.getElementById('completeFile').files[0],
        sol: document.getElementById('solutionFile').files[0]
    };
    if (!files.ws || !files.map || !files.comp || !files.sol) { alert("Upload all 4 files!"); return; }

    const read = (f) => new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsText(f); });
    const data = {
        ws: parseCSV(await read(files.ws)), map: parseCSV(await read(files.map)),
        comp: parseCSV(await read(files.comp)), sol: parseCSV(await read(files.sol))
    };

    const knownKeys = new Set(data.map.map(i => `${i.Type},${i.x},${i.y}`));
    const allItems = data.comp.filter(i => i.Type === 'O' || i.Type === 'B');
    const ws = data.ws;
    const { r90, r90p } = makeRot90(ws);
    const withCsv = item => { const r = r90(item); r._csvX = item.x; r._csvY = item.y; return r; };
    const gt = {
        known: allItems.filter(i => knownKeys.has(`${i.Type},${i.x},${i.y}`)).map(withCsv),
        unknown: allItems.filter(i => !knownKeys.has(`${i.Type},${i.x},${i.y}`)).map(withCsv),
        obstacles: data.comp.filter(i => i.Type === 'P').map(r90p),
        start: r90(data.comp.find(i => i.Type === 'S'))
    };
    performEvaluation(ws.map(r90p), gt, data.sol.filter(i => i.Type === 'O' || i.Type === 'B').map(withCsv));
}

async function runSeedEvaluation() {
    const seedValue = document.getElementById('evalSeedInput').value.trim();
    const solFile = document.getElementById('seedSolutionFile').files[0];
    if (!solFile) { alert("Please upload a solution map file."); return; }
    if (!seedValue) { alert("Could not extract seed from filename. Please enter the seed manually."); return; }

    const match = seedValue.match(/(\d+)_(\d+)_(\d+)_(\d+)_(\d+)_(\d+)_(\d+)/);
    let nkO, nuO, nkB, nuB, nObs, doTrans, randomSeed;

    if (match) {
        nkO = parseInt(match[1]); nuO = parseInt(match[2]);
        nkB = parseInt(match[3]); nuB = parseInt(match[4]);
        nObs = parseInt(match[5]); doTrans = parseInt(match[6]) === 1;
        randomSeed = parseInt(match[7]);
    } else {
        // Fallback for simple numeric seeds (uses current UI params)
        if (isNaN(seedValue)) { alert("Invalid seed format! Expected: ko2uo4..._123"); return; }
        nkO = parseInt(document.getElementById('knownObjects').value);
        nuO = parseInt(document.getElementById('unknownObjects').value);
        nkB = parseInt(document.getElementById('knownBoxes').value);
        nuB = parseInt(document.getElementById('unknownBoxes').value);
        nObs = parseInt(document.getElementById('obstaclesCount').value);
        doTrans = document.getElementById('transformWorkspace').checked;
        randomSeed = parseInt(seedValue);
    }

    const read = (f) => new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsText(f); });
    const solData = parseCSV(await read(solFile)).filter(i => i.Type === 'O' || i.Type === 'B');

    setSeed(randomSeed);
    const task = recreateTask(nkO, nuO, nkB, nuB, nObs, doTrans);
    const { translate, angleRad } = task.transform;
    const b = task.base;
    // Inverse-transform solution positions back to the base (unrotated) frame
    const invTransform = item => {
        const dx = item.x - translate.x, dy = item.y - translate.y;
        const rp = rotatePoint(dx, dy, -angleRad);
        return { ...item, x: rp.x, y: rp.y, ...(item.angle != null ? { angle: item.angle - angleRad * 180 / Math.PI } : {}) };
    };
    // 90° CCW rotation so longest side is always Y-axis
    const { r90, r90p } = makeRot90(b.workspace);
    // GT "CSV coords" = base coords after the global workspace transform (= what's in {seed}_gt.csv)
    const toGTCsv = item => {
        const rp = rotatePoint(item.x, item.y, angleRad);
        return { x: rp.x + translate.x, y: rp.y + translate.y };
    };
    const withGTCsv = (raw, Type) => {
        const item = r90({ ...raw, Type });
        const csv = toGTCsv(raw);
        item._csvX = csv.x; item._csvY = csv.y;
        return item;
    };
    const gt = {
        known: [...b.knownObjs.map(o => withGTCsv(o, 'O')), ...b.knownBoxes.map(bx => withGTCsv(bx, 'B'))],
        unknown: [...b.unknownObjs.map(o => withGTCsv(o, 'O')), ...b.unknownBoxes.map(bx => withGTCsv(bx, 'B'))],
        obstacles: b.obstacles.map(r90p),
        start: r90(b.startPose)
    };
    // Solution "CSV coords" = raw values from the uploaded file (before invTransform and r90)
    const solItems = solData.map(item => {
        const result = r90(invTransform(item));
        result._csvX = item.x; result._csvY = item.y;
        return result;
    });
    performEvaluation(b.workspace.map(r90p), gt, solItems);
}

function performEvaluation(workspace, gt, solution) {
    const solItems = solution;
    const thresh = getThreshold();
    const matchType = (type, gtL) => {
        const solL = solItems.filter(i => i.Type === type);
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

    evalData = { workspace, gt, solution: solItems };
    evaluationResult = {
        matches,
        stats: {
            knownMatched: matches.filter(m => gt.known.includes(m.gt)).length, knownTotal: gt.known.length,
            unknownMatched: matches.filter(m => gt.unknown.includes(m.gt)).length, unknownTotal: gt.unknown.length,
            penalties: solItems.length - matches.length,
            avgError: matches.length ? matches.reduce((s, m) => s + m.dist, 0) / matches.length : 0
        }
    };

    displayResults();
    switchEvalSidebarTab('results');
    draw();
}

function displayResults() {
    const resDiv = document.getElementById('evaluationResults');
    const s = evaluationResult.stats;
    resDiv.classList.remove('hidden');

    const allFound = s.knownMatched === s.knownTotal && s.unknownMatched === s.unknownTotal;
    const perfect = allFound && s.penalties === 0;

    const mntClass = s.knownMatched === s.knownTotal ? 'stat-success' : (s.knownMatched > 0 ? 'stat-warning' : 'stat-danger');
    const dscClass = s.unknownMatched === s.unknownTotal ? 'stat-success' : (s.unknownMatched > 0 ? 'stat-warning' : 'stat-danger');
    const penClass = s.penalties === 0 ? 'stat-success' : 'stat-danger';

    let verdictClass, verdictIcon, verdictText;
    if (perfect) {
        verdictClass = 'verdict-perfect'; verdictIcon = '✓'; verdictText = 'PERFECT SCORE';
    } else if (!allFound) {
        verdictClass = 'verdict-incomplete'; verdictIcon = '✗'; verdictText = 'INCOMPLETE TASK';
    } else {
        verdictClass = 'verdict-penalty'; verdictIcon = '!'; verdictText = 'ALL FOUND — WITH PENALTIES';
    }

    resDiv.innerHTML = `
        <div class="eval-stats-grid">
            <div class="stat-card ${mntClass}">
                <div class="stat-label">Maintained</div>
                <div class="stat-fraction"><span class="stat-value">${s.knownMatched}</span><span class="stat-total">/${s.knownTotal}</span></div>
            </div>
            <div class="stat-card ${dscClass}">
                <div class="stat-label">Discovered</div>
                <div class="stat-fraction"><span class="stat-value">${s.unknownMatched}</span><span class="stat-total">/${s.unknownTotal}</span></div>
            </div>
            <div class="stat-card ${penClass}">
                <div class="stat-label">Penalties</div>
                <div class="stat-fraction"><span class="stat-value">${s.penalties}</span></div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Avg Error</div>
                <div class="stat-fraction"><span class="stat-value">${s.avgError.toFixed(1)}</span><span class="stat-total"> cm</span></div>
            </div>
        </div>
        <div class="verdict-box ${verdictClass}">${verdictIcon} ${verdictText}</div>
    `;
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
    const missingItems = [...evalData.gt.known, ...evalData.gt.unknown].filter(i => !matchedGTSet.has(i));
    const penaltyItems = evalData.solution.filter(i => !matchedSolSet.has(i));

    // Compute nearest dist for missing/penalty for sorting
    const dist2 = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    const nearestForMissing = (item) => {
        const ds = penaltyItems.map(s => dist2(item, s));
        return ds.length ? Math.min(...ds) : null;
    };
    const nearestForPenalty = (item) => {
        const ds = missingItems.map(g => dist2(item, g));
        return ds.length ? Math.min(...ds) : null;
    };

    missingItems.sort((a, b) => (nearestForMissing(a) ?? Infinity) - (nearestForMissing(b) ?? Infinity));
    penaltyItems.sort((a, b) => (nearestForPenalty(a) ?? Infinity) - (nearestForPenalty(b) ?? Infinity));

    let html = '';

    const makeSection = (title, color, items, makeRow) => {
        if (!items.length) return;
        html += `<div class="eval-detail-section">`;
        html += `<div class="eval-detail-section-header"><div class="eval-detail-section-dot" style="background:${color}"></div>${title} (${items.length})</div>`;
        items.forEach((item, idx) => { html += makeRow(item, idx); });
        html += `</div>`;
    };

    const csvXY = (item) => `${(item._csvX ?? item.x).toFixed(0)}, ${(item._csvY ?? item.y).toFixed(0)}`;

    const matchRow = (m, color, side) => {
        const item = side === 'gt' ? m.gt : m.sol;
        const typeLabel = item.Type === 'B' ? 'Box' : 'Obj';
        return `<div class="eval-detail-row" data-match-idx="${evaluationResult.matches.indexOf(m)}" data-row-type="match">
            <span class="eval-detail-type">${typeLabel}</span>
            <span class="eval-detail-coords">${csvXY(item)}</span>
            <span class="eval-detail-error" style="color:${color}">${m.dist.toFixed(1)} cm</span>
        </div>`;
    };

    const unmatchedRow = (item, idx, color, rowType, nearestDist) => {
        const typeLabel = item.Type === 'B' ? 'Box' : 'Obj';
        const errStr = nearestDist !== null ? `${nearestDist.toFixed(1)} cm` : '—';
        return `<div class="eval-detail-row" data-item-idx="${idx}" data-row-type="${rowType}">
            <span class="eval-detail-type">${typeLabel}</span>
            <span class="eval-detail-coords">${csvXY(item)}</span>
            <span class="eval-detail-error" style="color:${color}">${errStr}</span>
        </div>`;
    };

    makeSection('Maintained', matchKnownColor, maintainedMatches, (m) => matchRow(m, matchKnownColor, 'gt'));
    makeSection('Discovered', matchUnknownColor, discoveredMatches, (m) => matchRow(m, matchUnknownColor, 'gt'));
    makeSection('Missing', missingColorStr, missingItems, (item, i) => unmatchedRow(item, i, missingColorStr, 'missing', nearestForMissing(item)));
    makeSection('Penalty', penaltyColorStr, penaltyItems, (item, i) => unmatchedRow(item, i, penaltyColorStr, 'penalty', nearestForPenalty(item)));

    if (!html) html = `<div class="eval-detail-empty">No items to show.</div>`;
    container.innerHTML = html;

    // Attach hover listeners
    container.querySelectorAll('.eval-detail-row').forEach(row => {
        const rowType = row.dataset.rowType;
        let item = null;

        if (rowType === 'match') {
            const m = evaluationResult.matches[parseInt(row.dataset.matchIdx)];
            if (m) item = { _isMatch: true, _matchRef: m, _label: 'Match', x: m.gt.x, y: m.gt.y };
        } else if (rowType === 'missing') {
            const i = parseInt(row.dataset.itemIdx);
            const raw = missingItems[i];
            if (raw) item = { ...raw, _ref: raw, _label: `Missing ${raw.Type === 'B' ? 'Box' : 'Object'}`, _side: 'left' };
        } else if (rowType === 'penalty') {
            const i = parseInt(row.dataset.itemIdx);
            const raw = penaltyItems[i];
            if (raw) item = { ...raw, _ref: raw, _label: `Penalty ${raw.Type === 'B' ? 'Box' : 'Object'}`, _side: 'right' };
        }

        row.addEventListener('mouseenter', () => {
            panelHoverItem = item;
            container.querySelectorAll('.eval-detail-row').forEach(r => r.classList.remove('panel-hover-active'));
            row.classList.add('panel-hover-active');
            draw();
        });
        row.addEventListener('mouseleave', () => {
            panelHoverItem = null;
            row.classList.remove('panel-hover-active');
            draw();
        });
    });
}

function switchEvalSidebarTab(panel) {
    document.querySelectorAll('.eval-sidebar-tab').forEach(t => t.classList.toggle('active', t.dataset.panel === panel));
    document.getElementById('evalInputPanel').classList.toggle('hidden', panel !== 'input');
    document.getElementById('evalResultsPanel').classList.toggle('hidden', panel !== 'results');
    if (panel === 'results') buildResultsPanel();
}

// --- CANVAS ---
function draw() {
    const canvas = document.getElementById('mapCanvas');
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;
    const btnSave = document.getElementById('btnDLSVG');
    btnSave.classList.add('hidden');

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
    if (!data) return;
    btnSave.classList.remove('hidden');

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

    const ws = data.workspace;
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

    const drawWorld = (toX, worldData, isGT = true) => {
        // Grid — uniform thin lines every 100 cm, labels every 500 cm
        const fontSize = Math.max(9, Math.min(13, 11 * scale));
        const step = 100, labelStep = 500;
        const gxStart = Math.floor(minX / step) * step;
        const gyStart = Math.floor(minY / step) * step;

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

        // Axis unit labels
        ctx.font = `bold ${fontSize}px Inter`; ctx.fillStyle = axisColor;
        // X label — centered below the grid
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('X (cm)', (toX(minX) + toX(maxX)) / 2, toY(minY) + 16);
        // Y label — centered to the left of the grid, rotated 90°
        const yCenterY = (toY(minY) + toY(maxY)) / 2;
        ctx.save();
        ctx.translate(toX(minX) - 28, yCenterY);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('Y (cm)', 0, 0);
        ctx.restore();

        // Workspace
        if (vis('workspace')) {
            ctx.strokeStyle = wsColor; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(toX(ws[0].x), toY(ws[0].y)); ws.forEach(p => ctx.lineTo(toX(p.x), toY(p.y))); ctx.closePath(); ctx.stroke();
        }

        const drawItem = (i, type, color, h = false, labelText = null) => {
            const cx = toX(i.x), cy = toY(i.y), r = Math.max(5, (10 * scale) / 2);
            ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2;
            if (type === 'O') h ? ctx.strokeRect(cx - r, cy - r, r * 2, r * 2) : ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            else if (type === 'B') {
                ctx.save(); ctx.translate(toX(i.x), toY(i.y)); ctx.rotate(-(i.angle * Math.PI / 180));
                ctx.globalAlpha = 0.6; ctx.strokeRect(-12 * scale, -8 * scale, 24 * scale, 16 * scale);
                if (!h) ctx.fillRect(-12 * scale, -8 * scale, 24 * scale, 16 * scale); ctx.restore();
            } else if (type === 'P') {
                ctx.strokeStyle = obstacleColor; ctx.beginPath(); ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx + 5, cy + 5); ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx - 5, cy + 5); ctx.stroke();
            }
            if (labelText) {
                ctx.fillStyle = color; ctx.font = `${Math.max(8, fontSize * 0.85)}px Inter`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                ctx.fillText(labelText, cx, cy + r + 3);
            }
        };

        const sp = isGT ? (currentMode === 'generate' ? worldData.startPose : worldData.gt.start) : (worldData.gt.start); // Use GT start for solution view too
        if (sp && vis('start')) {
            ctx.save(); ctx.translate(toX(sp.x), toY(sp.y)); ctx.rotate(-(sp.angle * Math.PI / 180));
            ctx.strokeStyle = startColor; ctx.fillStyle = startColor; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(25, 0); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(25, 0); ctx.lineTo(15, -5); ctx.lineTo(15, 5); ctx.fill(); ctx.restore();
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
                        if (isKnown && vis('known_obj')) drawItem(o, 'O', objColor);
                        else if (!isKnown && vis('unknown_obj')) drawItem(o, 'O', objColor, true);
                    } else {
                        if (vis('unused')) drawItem(o, 'O', unusedColor);
                    }
                });
                BOXES.forEach(b => {
                    const key = `${b.x},${b.y}`;
                    if (usedBoxKeys.has(key)) {
                        const isKnown = worldData.knownBoxes.some(k => k.x === b.x && k.y === b.y);
                        if (isKnown && vis('known_box')) drawItem(b, 'B', boxColor);
                        else if (!isKnown && vis('unknown_box')) drawItem(b, 'B', boxColor, true);
                    } else {
                        if (vis('unused')) drawItem(b, 'B', unusedColor);
                    }
                });
                if (vis('obstacle')) worldData.obstacles.forEach(o => drawItem(o, 'P', obstacleColor));
            } else {
                if (vis('known_obj')) worldData.knownObjs.forEach(o => drawItem(o, 'O', objColor));
                if (vis('known_box')) worldData.knownBoxes.forEach(b => drawItem(b, 'B', boxColor));
                if (currentView !== 'known') {
                    if (vis('unknown_obj')) worldData.unknownObjs.forEach(o => drawItem(o, 'O', objColor, currentView === 'truth'));
                    if (vis('unknown_box')) worldData.unknownBoxes.forEach(b => drawItem(b, 'B', boxColor, currentView === 'truth'));
                    if (vis('obstacle')) worldData.obstacles.forEach(o => drawItem(o, 'P', obstacleColor));
                }
            }
        } else { // evaluate mode
            const knownGT = new Set(worldData.gt.known);
            if (isGT) {
                if (evaluationResult) {
                    const matchedGT = new Set(evaluationResult.matches.map(m => m.gt));
                    if (vis('maintained')) worldData.gt.known.filter(i => matchedGT.has(i)).forEach(i => drawItem(i, i.Type, matchKnown));
                    if (vis('discovered')) worldData.gt.unknown.filter(i => matchedGT.has(i)).forEach(i => drawItem(i, i.Type, matchUnknown));
                    if (vis('missing')) [...worldData.gt.known, ...worldData.gt.unknown].filter(i => !matchedGT.has(i)).forEach(i => drawItem(i, i.Type, missingColor));
                } else {
                    worldData.gt.known.forEach(i => drawItem(i, i.Type, matchKnown));
                    worldData.gt.unknown.forEach(i => drawItem(i, i.Type, matchUnknown));
                }
                if (vis('obstacle')) worldData.gt.obstacles.forEach(o => drawItem(o, 'P', obstacleColor));
            } else {
                if (evaluationResult) {
                    const matchedByKnown = new Set(evaluationResult.matches.filter(m => knownGT.has(m.gt)).map(m => m.sol));
                    const matchedByUnknown = new Set(evaluationResult.matches.filter(m => !knownGT.has(m.gt)).map(m => m.sol));
                    const matchedAll = new Set([...matchedByKnown, ...matchedByUnknown]);
                    const sol = worldData.solution;
                    if (vis('maintained')) sol.filter(i => matchedByKnown.has(i)).forEach(i => drawItem(i, i.Type, matchKnown));
                    if (vis('discovered')) sol.filter(i => matchedByUnknown.has(i)).forEach(i => drawItem(i, i.Type, matchUnknown));
                    if (vis('penalty')) sol.filter(i => !matchedAll.has(i)).forEach(i => drawItem(i, i.Type, penaltyColor));
                } else {
                    worldData.solution.forEach(i => drawItem(i, i.Type, objColor));
                }
                if (vis('obstacle')) worldData.gt.obstacles.forEach(o => drawItem(o, 'P', obstacleColor));
            }
        }
    };

    if (!isSplit) {
        drawWorld(getToX(false), data, currentView !== 'sol');
    } else {
        // Divider
        ctx.strokeStyle = borderProminent; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();

        // Labels
        ctx.fillStyle = textColor; ctx.font = 'bold 16px Inter'; ctx.textAlign = 'center';
        ctx.fillText('GROUND TRUTH', W / 4, 30);
        ctx.fillText('SOLUTION', 3 * W / 4, 30);

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
                ctx.strokeStyle = isMaintained ? matchKnown : matchUnknown;
                ctx.setLineDash([5, 5]); ctx.lineWidth = isHovered ? 2.5 : 1; ctx.globalAlpha = isHovered ? 1 : 0.6;
                ctx.beginPath(); ctx.moveTo(toXLeft(m.gt.x), toY(m.gt.y)); ctx.lineTo(toXRight(m.sol.x), toY(m.sol.y)); ctx.stroke();
                ctx.setLineDash([]); ctx.globalAlpha = 1;
            });
        }
    }

    const activeHighlight = hoverItem || panelHoverItem;
    if (activeHighlight) {
        const hoverItem = activeHighlight; // shadow for the block below
        const threshR = getThreshold() * scale;
        ctx.strokeStyle = hoverColor; ctx.lineWidth = 2;
        if (hoverItem._isMatch) {
            const m = hoverItem._matchRef;
            const r = Math.max(5, (10 * scale) / 2);
            const highlightItem = (item, fn) => {
                ctx.fillStyle = hoverColor; ctx.strokeStyle = hoverColor; ctx.lineWidth = 2;
                if (item.Type !== 'B') {
                    ctx.fillRect(fn(item.x) - r, toY(item.y) - r, r * 2, r * 2);
                } else {
                    ctx.save(); ctx.translate(fn(item.x), toY(item.y)); ctx.rotate(-(item.angle * Math.PI / 180));
                    ctx.globalAlpha = 0.8; ctx.fillRect(-12 * scale, -8 * scale, 24 * scale, 16 * scale);
                    ctx.restore(); ctx.globalAlpha = 1;
                }
                ctx.strokeStyle = hoverColor; ctx.beginPath(); ctx.arc(fn(item.x), toY(item.y), threshR, 0, Math.PI * 2); ctx.stroke();
            };
            highlightItem(m.gt, getToX(false));
            highlightItem(m.sol, getToX(true));
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
    updateHoverTooltip();
    updateLegend();
}

function updateHoverTooltip() {
    const el = document.getElementById('mapTooltip');
    if (!hoverItem) { el.classList.add('hidden'); return; }

    if (hoverItem._isMatch) {
        const m = hoverItem._matchRef;
        const type = m.gt.Type === 'B' ? 'Box' : 'Object';
        el.innerHTML =
            `<div class="map-tooltip-label">Match — ${type}</div>` +
            `<div class="map-tooltip-row"><span>error</span><span>${m.dist.toFixed(1)} cm</span></div>` +
            `<div class="map-tooltip-row"><span>GT x,y</span><span>${m.gt.x.toFixed(1)}, ${m.gt.y.toFixed(1)}</span></div>` +
            `<div class="map-tooltip-row"><span>sol x,y</span><span>${m.sol.x.toFixed(1)}, ${m.sol.y.toFixed(1)}</span></div>`;
    } else {
        const label = hoverItem._label || hoverItem.Type || 'Item';
        const hasAngle = hoverItem.angle !== undefined && hoverItem.angle !== null;
        const ref = hoverItem._ref || hoverItem;
        const match = evaluationResult?.matches?.find(m => m.gt === ref || m.sol === ref);

        const nearestDist = !match ? getHoverNearestDist(hoverItem) : null;

        el.innerHTML =
            `<div class="map-tooltip-label">${label}</div>` +
            `<div class="map-tooltip-row"><span>x</span><span>${hoverItem.x.toFixed(1)} cm</span></div>` +
            `<div class="map-tooltip-row"><span>y</span><span>${hoverItem.y.toFixed(1)} cm</span></div>` +
            (hasAngle ? `<div class="map-tooltip-row"><span>angle</span><span>${hoverItem.angle.toFixed(1)}°</span></div>` : '') +
            (match ? `<div class="map-tooltip-row"><span>error</span><span>${match.dist.toFixed(1)} cm</span></div>` : '') +
            (nearestDist !== null ? `<div class="map-tooltip-row"><span>nearest</span><span>${nearestDist.toFixed(1)} cm</span></div>` : '');
    }

    // Position near cursor, flip if near right edge
    const container = el.parentElement;
    const cw = container.clientWidth;
    const cx = hoverMouse.x;
    const cy = hoverMouse.y;
    const flipX = cx > cw * 0.72;
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
    const mis = { n: 'Missing', key: 'missing', c: getC('--viz-missing') };
    const pen = { n: 'Penalty', key: 'penalty', c: getC('--viz-penalty') };
    const lmnt = { n: 'Maintained match', key: 'matched_maintained', c: getC('--viz-match-known'), d: true };
    const ldsc = { n: 'Discovered match', key: 'matched_discovered', c: getC('--viz-match-unknown'), d: true };

    const items = currentMode === 'generate' ? {
        truth: [ws, sp, ko, kb, uo, ub, ob],
        known: [ws, sp, ko, kb],
        placement: [ws, sp, ko, kb, uo, ub, ob, un],
    }[currentView] ?? [] : [ws, sp, ob, mnt, dsc, mis, pen, lmnt, ldsc];
    items.forEach(i => {
        const d = document.createElement('div');
        d.className = 'legend-item' + (vis(i.key) ? '' : ' layer-hidden');
        let p = `<div class="legend-patch" style="background:${i.c}; ${i.h ? 'border:2px solid ' + i.c + '; background:transparent' : ''}"></div>`;
        if (i.x) p = `<div class="legend-patch" style="background:transparent; color:${i.c}; display:flex; align-items:center; justify-content:center; font-weight:bold">×</div>`;
        if (i.l) p = `<div class="legend-patch" style="border-top:2px solid ${i.c}; height:0; margin-top:8px"></div>`;
        if (i.d) p = `<div class="legend-patch" style="border-top:2px dashed ${i.c}; height:0; margin-top:8px"></div>`;
        d.innerHTML = `${p} <span>${i.n}</span>`;
        d.onclick = () => { layerVisible[i.key] = !vis(i.key); updateLegend(); draw(); };
        L.appendChild(d);
    });
}

function downloadAllCSV() {
    ['workspace', 'map', 'map_gt'].forEach(type => downloadCSV(type));
}

function downloadAllSVGs() {
    if (!currentTask) return;
    const seed = csvSeedStr();
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
        const a = document.createElement('a'); a.href = url; a.download = `${seed}_${name}.svg`; a.click();
    });
    currentView = savedView;
    draw();
}

async function downloadZip() {
    if (!currentTask || typeof window.JSZip === 'undefined') return;
    const seed = csvSeedStr();
    const zip = new window.JSZip();

    // CSV files
    const nameMap = { workspace: 'workspace', map: 'map', map_gt: 'gt' };
    ['workspace', 'map', 'map_gt'].forEach(type => {
        const data = currentTask.transformed;
        let csv = type === 'workspace' ? "x,y\n" + data.workspace.map(p => `${p.x},${p.y}`).join("\n") : "Type,x,y,angle\n";
        if (type !== 'workspace') {
            csv += `S,${data.startPose.x},${data.startPose.y},${data.startPose.angle}\n`;
            data.knownObjs.forEach(o => csv += `O,${o.x},${o.y},${o.angle}\n`);
            data.knownBoxes.forEach(b => csv += `B,${b.x},${b.y},${b.angle}\n`);
            if (type === 'map_gt') {
                data.unknownObjs.forEach(o => csv += `O,${o.x},${o.y},${o.angle}\n`);
                data.unknownBoxes.forEach(b => csv += `B,${b.x},${b.y},${b.angle}\n`);
                data.obstacles.forEach(p => csv += `P,${p.x},${p.y},0\n`);
            }
        }
        zip.file(`${seed}_${nameMap[type]}.csv`, csv);
    });

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
        if (svgStr) zip.file(`${seed}_${name}.svg`, svgStr);
    }
    currentView = savedView;
    draw(); // restore canvas

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${seed}.zip`; a.click();
}

function csvSeedStr() {
    const t = currentTask;
    return `${t.params.nkO}_${t.params.nuO}_${t.params.nkB}_${t.params.nuB}_${t.params.nObs}_${t.params.doTrans ? 1 : 0}_${t.seed}`;
}

function downloadCSV(type) {
    if (!currentTask) return;
    const data = currentTask.transformed;
    let csv = type === 'workspace' ? "x,y\n" + data.workspace.map(p => `${p.x},${p.y}`).join("\n") : "Type,x,y,angle\n";
    if (type !== 'workspace') {
        csv += `S,${data.startPose.x},${data.startPose.y},${data.startPose.angle}\n`;
        data.knownObjs.forEach(o => csv += `O,${o.x},${o.y},${o.angle}\n`); data.knownBoxes.forEach(b => csv += `B,${b.x},${b.y},${b.angle}\n`);
        if (type === 'map_gt') {
            data.unknownObjs.forEach(o => csv += `O,${o.x},${o.y},${o.angle}\n`); data.unknownBoxes.forEach(b => csv += `B,${b.x},${b.y},${b.angle}\n`);
            data.obstacles.forEach(p => csv += `P,${p.x},${p.y},0\n`);
        }
    }
    const nameMap = { workspace: 'workspace', map: 'map', map_gt: 'gt' };
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${csvSeedStr()}_${nameMap[type]}.csv`; a.click();
}

function generateSVGContent(viewOverride) {
    const savedView = currentView;
    if (viewOverride) currentView = viewOverride;
    const svgString = _buildSVGString();
    currentView = savedView;
    return svgString;
}

function downloadSVG() {
    const svgString = _buildSVGString();
    if (!svgString) return;
    const typeMap = { truth: 'gt', known: 'known', placement: 'placement', all: 'eval', gt: 'gt', sol: 'solution' };
    const viewType = typeMap[currentView] || currentView;
    const t = currentTask;
    const fullSeed = t ? `${t.params.nkO}_${t.params.nuO}_${t.params.nkB}_${t.params.nuB}_${t.params.nObs}_${t.params.doTrans ? 1 : 0}_${t.seed}` : 'unknown';
    const fileName = `${fullSeed}_${viewType}`;
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${fileName}.svg`; a.click();
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

    const ws = data.workspace;
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
    const svgW = mapOffset + mapW + PANEL_W, svgH = mapH;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`;
    svg += `<style>text { font-family: Inter, sans-serif; }</style>`;
    if (LEFT_PANEL_W > 0) {
        svg += `<rect x="0" y="0" width="${LEFT_PANEL_W}" height="${svgH}" fill="${panelBg}" />`;
        svg += `<line x1="${LEFT_PANEL_W}" y1="0" x2="${LEFT_PANEL_W}" y2="${svgH}" stroke="${borderProm}" stroke-width="1" />`;
    }
    svg += `<rect x="${mapOffset}" y="0" width="${mapW}" height="${svgH}" fill="${bg}" />`;
    svg += `<rect x="${mapOffset + mapW}" y="0" width="${PANEL_W}" height="${svgH}" fill="${panelBg}" />`;
    svg += `<line x1="${mapOffset + mapW}" y1="0" x2="${mapOffset + mapW}" y2="${svgH}" stroke="${borderProm}" stroke-width="1" />`;

    const drawWorldSVG = (xShift, worldData, isGT = true) => {
        const fontSize = Math.max(9, Math.min(13, 11 * scale));
        const step = 100, labelStep = 500;
        const gxStart = Math.floor(minX / step) * step, gyStart = Math.floor(minY / step) * step;

        // Vertical lines for world X, horizontal for world Y
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
        const midCX = (map(minX, 0, xShift).cx + map(maxX, 0, xShift).cx) / 2;
        const bottomCY = map(0, minY, xShift).cy;
        const midCY = (map(0, minY, xShift).cy + map(0, maxY, xShift).cy) / 2;
        const leftCX = map(minX, 0, xShift).cx;
        svg += `<text x="${midCX}" y="${bottomCY + 16}" fill="${axisColor}" font-size="${fontSize}" font-weight="bold" text-anchor="middle" dominant-baseline="hanging">X (cm)</text>`;
        svg += `<text x="0" y="0" fill="${axisColor}" font-size="${fontSize}" font-weight="bold" text-anchor="middle" dominant-baseline="middle" transform="translate(${leftCX - 28},${midCY}) rotate(-90)">Y (cm)</text>`;

        // Workspace
        if (vis('workspace')) {
            const pts = ws.map(p => { const m = map(p.x, p.y, xShift); return `${m.cx},${m.cy}`; }).join(' ');
            svg += `<polygon points="${pts}" fill="none" stroke="${wsColor}" stroke-width="3" />`;
        }

        const addIcon = (i, type, color, h = false) => {
            const { cx, cy } = map(i.x, i.y, xShift);
            const r = Math.max(5, (10 * scale) / 2);
            if (type === 'O') {
                if (!h) svg += `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" fill="${color}" />`;
                else svg += `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" fill="none" stroke="${color}" stroke-width="2" />`;
            } else if (type === 'B') {
                const dispAngle = -i.angle;
                svg += `<rect x="${-12 * scale}" y="${-8 * scale}" width="${24 * scale}" height="${16 * scale}" fill="${color}" fill-opacity="${h ? 0 : 0.6}" stroke="${color}" stroke-width="2" transform="translate(${cx},${cy}) rotate(${dispAngle})" />`;
            } else if (type === 'P') {
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
                svg += `<g transform="translate(${cx},${cy}) rotate(${dispAngle})"><line x1="0" y1="0" x2="25" y2="0" stroke="${startColor}" stroke-width="2" /><polygon points="25,0 15,-5 15,5" fill="${startColor}" /></g>`;
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
                if (vis('obstacle')) worldData.obstacles.forEach(o => addIcon(o, 'P', obstacleColor));
            } else {
                if (vis('known_obj')) worldData.knownObjs.forEach(o => addIcon(o, 'O', objColor));
                if (vis('known_box')) worldData.knownBoxes.forEach(b => addIcon(b, 'B', boxColor));
                if (currentView !== 'known') {
                    if (vis('unknown_obj')) worldData.unknownObjs.forEach(o => addIcon(o, 'O', objColor, currentView === 'truth'));
                    if (vis('unknown_box')) worldData.unknownBoxes.forEach(b => addIcon(b, 'B', boxColor, currentView === 'truth'));
                    if (vis('obstacle')) worldData.obstacles.forEach(o => addIcon(o, 'P', obstacleColor));
                }
            }
        } else { // evaluate mode
            const knownGT = new Set(worldData.gt.known);
            if (isGT) {
                if (evaluationResult) {
                    const matchedGT = new Set(evaluationResult.matches.map(m => m.gt));
                    if (vis('maintained')) worldData.gt.known.filter(i => matchedGT.has(i)).forEach(i => addIcon(i, i.Type, matchKnown));
                    if (vis('discovered')) worldData.gt.unknown.filter(i => matchedGT.has(i)).forEach(i => addIcon(i, i.Type, matchUnknown));
                    if (vis('missing')) [...worldData.gt.known, ...worldData.gt.unknown].filter(i => !matchedGT.has(i)).forEach(i => addIcon(i, i.Type, missingColor));
                } else {
                    worldData.gt.known.forEach(i => addIcon(i, i.Type, matchKnown));
                    worldData.gt.unknown.forEach(i => addIcon(i, i.Type, matchUnknown));
                }
                if (vis('obstacle')) worldData.gt.obstacles.forEach(o => addIcon(o, 'P', obstacleColor));
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
                if (vis('obstacle')) worldData.gt.obstacles.forEach(o => addIcon(o, 'P', obstacleColor));
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
    let py = 32;

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
        svgRow('Seed', `${currentTask.seed}`);
        svgRow('Full Seed', `${p.nkO}_${p.nuO}_${p.nkB}_${p.nuB}_${p.nObs}_${p.doTrans ? 1 : 0}_${currentTask.seed}`);
        py += 6; svgRule(py); py += 14;
        svgText(px, py, 'SETTINGS', { fill: accentColor, size: 10, weight: 'bold' }); py += 18;
        svgRow('Known Objects', `${p.nkO}`);
        svgRow('Unknown Objects', `${p.nuO}`);
        svgRow('Known Boxes', `${p.nkB}`);
        svgRow('Unknown Boxes', `${p.nuB}`);
        svgRow('Obstacles', `${p.nObs}`);
        svgRow('Transform', p.doTrans ? 'Applied' : 'None');
    } else if (currentMode === 'evaluate') {
        const viewNames = { evaluation: 'Side-by-Side', truth: 'Ground Truth', solution: 'Solution' };
        svgRow('View', viewNames[currentView] || currentView);
    }

    if (currentMode === 'evaluate' && evaluationResult) {
        const s = evaluationResult.stats;
        const perfect = s.knownMatched === s.knownTotal && s.unknownMatched === s.unknownTotal && s.penalties === 0;
        py += 6; svgRule(py); py += 14;
        svgText(px, py, 'RESULTS', { fill: accentColor, size: 10, weight: 'bold' }); py += 18;
        svgRow('Maintained', `${s.knownMatched} / ${s.knownTotal}`);
        svgRow('Discovered', `${s.unknownMatched} / ${s.unknownTotal}`);
        svgRow('Penalties', `${s.penalties}`, s.penalties > 0 ? penaltyColor : panelText);
        svgRow('Avg Error', `${s.avgError.toFixed(1)} cm`);
        py += 4;
        const verdict = perfect ? 'PERFECT SCORE!' : (s.knownMatched < s.knownTotal || s.unknownMatched < s.unknownTotal ? 'INCOMPLETE' : 'PENALTIES INCURRED');
        svgText(px, py, verdict, { fill: perfect ? successColor : penaltyColor, size: 11, weight: 'bold' });
        py += lineH;
    }

    py += 6; svgRule(py); py += 14;
    svgText(px, py, 'LEGEND', { fill: accentColor, size: 10, weight: 'bold' }); py += 18;

    const sw = 11, sh = 11;
    const addLegendItem = (label, color, type) => {
        const sx = px, sy = py - sh + 2;
        if (type === 'filled') svg += `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="${color}" rx="1" />`;
        if (type === 'outline') svg += `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="none" stroke="${color}" stroke-width="1.5" rx="1" />`;
        if (type === 'line') svg += `<line x1="${sx}" y1="${sy + sh / 2}" x2="${sx + sw}" y2="${sy + sh / 2}" stroke="${color}" stroke-width="2.5" />`;
        if (type === 'cross') { svg += `<line x1="${sx}" y1="${sy}" x2="${sx + sw}" y2="${sy + sh}" stroke="${color}" stroke-width="1.5" />`; svg += `<line x1="${sx + sw}" y1="${sy}" x2="${sx}" y2="${sy + sh}" stroke="${color}" stroke-width="1.5" />`; }
        if (type === 'arrow') { svg += `<line x1="${sx}" y1="${sy + sh / 2}" x2="${sx + sw - 3}" y2="${sy + sh / 2}" stroke="${color}" stroke-width="1.5" />`; svg += `<polygon points="${sx + sw},${sy + sh / 2} ${sx + sw - 5},${sy + sh / 2 - 3} ${sx + sw - 5},${sy + sh / 2 + 3}" fill="${color}" />`; }
        if (type === 'dashed') { svg += `<line x1="${sx}" y1="${sy + sh / 2}" x2="${sx + sw}" y2="${sy + sh / 2}" stroke="${color}" stroke-width="1.5" stroke-dasharray="3,2" />`; }
        svgText(px + sw + 7, py, label, { fill: panelText, size: 11 });
        py += lineH;
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
            addLegendItem('Missing', penaltyColor, 'filled');
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

    // --- Left Results Panel (evaluate mode only) ---
    if (LEFT_PANEL_W > 0 && evaluationResult && evalData) {
        const lp = 12; // left padding
        const lrx = LEFT_PANEL_W - lp; // right edge for right-aligned values
        const lLineH = 18;
        let lpy = 28;

        const lpText = (x, y, text, { fill = panelText, size = 11, weight = 'normal', anchor = 'start' } = {}) =>
            svg += `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${text}</text>`;
        const lpRule = (y) =>
            svg += `<line x1="${lp}" y1="${y}" x2="${LEFT_PANEL_W - lp}" y2="${y}" stroke="${borderProm}" stroke-width="1" />`;

        lpText(lp, lpy, 'ITEM RESULTS', { fill: accentColor, size: 10, weight: 'bold' }); lpy += 6;
        lpRule(lpy); lpy += lLineH - 2;

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
                if (lpy > svgH - 10) return; // clip if out of space
                makeRow(item);
                lpy += lLineH;
            });
            lpy += 4;
        };

        const lpXY = (item) => `${(item._csvX ?? item.x).toFixed(0)}, ${(item._csvY ?? item.y).toFixed(0)}`;

        lpSection('Maintained', matchKnown, maintainedM, (m) => {
            const typeL = m.gt.Type === 'B' ? 'B' : 'O';
            lpText(lp, lpy, typeL, { fill: matchKnown, size: 9, weight: 'bold' });
            lpText(lp + 14, lpy, lpXY(m.gt), { size: 10 });
            lpText(lrx, lpy, `${m.dist.toFixed(1)} cm`, { fill: matchKnown, size: 10, anchor: 'end' });
        });

        lpSection('Discovered', matchUnknown, discoveredM, (m) => {
            const typeL = m.gt.Type === 'B' ? 'B' : 'O';
            lpText(lp, lpy, typeL, { fill: matchUnknown, size: 9, weight: 'bold' });
            lpText(lp + 14, lpy, lpXY(m.gt), { size: 10 });
            lpText(lrx, lpy, `${m.dist.toFixed(1)} cm`, { fill: matchUnknown, size: 10, anchor: 'end' });
        });

        lpSection('Missing', missingColor, missingL.sort((a, b) => {
            const nearA = penaltyL.length ? Math.min(...penaltyL.map(s => dist2L(a, s))) : Infinity;
            const nearB = penaltyL.length ? Math.min(...penaltyL.map(s => dist2L(b, s))) : Infinity;
            return nearA - nearB;
        }), (item) => {
            const near = penaltyL.length ? Math.min(...penaltyL.map(s => dist2L(item, s))) : null;
            const typeL = item.Type === 'B' ? 'B' : 'O';
            lpText(lp, lpy, typeL, { fill: missingColor, size: 9, weight: 'bold' });
            lpText(lp + 14, lpy, lpXY(item), { size: 10 });
            if (near !== null) lpText(lrx, lpy, `${near.toFixed(1)} cm`, { fill: missingColor, size: 10, anchor: 'end' });
        });

        lpSection('Penalty', penaltyColor, penaltyL.sort((a, b) => {
            const nearA = missingL.length ? Math.min(...missingL.map(g => dist2L(a, g))) : Infinity;
            const nearB = missingL.length ? Math.min(...missingL.map(g => dist2L(b, g))) : Infinity;
            return nearA - nearB;
        }), (item) => {
            const near = missingL.length ? Math.min(...missingL.map(g => dist2L(item, g))) : null;
            const typeL = item.Type === 'B' ? 'B' : 'O';
            lpText(lp, lpy, typeL, { fill: penaltyColor, size: 9, weight: 'bold' });
            lpText(lp + 14, lpy, lpXY(item), { size: 10 });
            if (near !== null) lpText(lrx, lpy, `${near.toFixed(1)} cm`, { fill: penaltyColor, size: 10, anchor: 'end' });
        });
    }

    svg += `</svg>`;
    return svg;
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
    document.querySelectorAll('input[type="number"]').forEach(input => {
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
    document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => switchMode(b.dataset.mode));
    document.querySelectorAll('.eval-sidebar-tab').forEach(b => b.onclick = () => switchEvalSidebarTab(b.dataset.panel));
    document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.onclick = () => {
        document.querySelectorAll('.tab-btn[data-tab]').forEach(t => t.classList.remove('active'));
        b.classList.add('active'); currentView = b.dataset.tab; draw();
    });
    document.getElementById('generateBtn').onclick = () => generateTask();
    document.getElementById('runEvalBtn').onclick = runEvaluation;
    document.getElementById('runSeedEvalBtn').onclick = runSeedEvaluation;
    document.getElementById('runSeedEvalBtn2')?.addEventListener('click', runSeedEvaluation);
    document.getElementById('copySeedBtn').onclick = copySeed;
    document.getElementById('displaySeed').onclick = copySeed;

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

    nkOEl.addEventListener('change', () => syncPair(nkOEl, nuOEl, OBJECTS.length));
    nuOEl.addEventListener('change', () => syncPair(nuOEl, nkOEl, OBJECTS.length));
    nkBEl.addEventListener('change', () => syncPair(nkBEl, nuBEl, BOXES.length));
    nuBEl.addEventListener('change', () => syncPair(nuBEl, nkBEl, BOXES.length));

    document.getElementById('seedInput').addEventListener('change', function () {
        if (parseInt(this.value) === 0) this.value = '';
    });

    document.getElementById('evalThreshold').addEventListener('change', () => {
        if (evaluationResult) {
            const activeMethod = document.querySelector('.eval-method-btn.active')?.dataset.method;
            if (activeMethod === 'seed') runSeedEvaluation();
            else runEvaluation();
        } else { draw(); }
    });

    document.getElementById('seedSolutionFile').onchange = (e) => {
        const name = e.target.files[0]?.name ?? '';
        const m = name.match(/^(\d+_\d+_\d+_\d+_\d+_\d+_\d+)(?:_[^.]+)?\.csv$/i);
        const extracted = document.getElementById('seedExtracted');
        const manual = document.getElementById('seedManualEntry');
        if (!name) {
            extracted.classList.add('hidden');
            manual.classList.add('hidden');
            return;
        }
        if (m) {
            document.getElementById('seedExtractedValue').textContent = m[1];
            // Store seed for runSeedEvaluation to use
            document.getElementById('evalSeedInput') && (document.getElementById('evalSeedInput').value = m[1]);
            extracted.classList.remove('hidden');
            manual.classList.add('hidden');
            runSeedEvaluation();
        } else {
            const seedInput = document.getElementById('evalSeedInput');
            if (seedInput) seedInput.value = '';
            extracted.classList.add('hidden');
            manual.classList.remove('hidden');
        }
    };

    document.querySelectorAll('.eval-method-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.eval-method-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const isSeed = btn.dataset.method === 'seed';
            document.getElementById('evalBySeed').classList.toggle('hidden', !isSeed);
            document.getElementById('evalByFiles').classList.toggle('hidden', isSeed);
            if (isSeed) {
                // Reset seed reveal UI unless a file is already loaded
                const hasFile = !!document.getElementById('seedSolutionFile')?.files[0];
                if (!hasFile) {
                    document.getElementById('seedExtracted')?.classList.add('hidden');
                    document.getElementById('seedManualEntry')?.classList.add('hidden');
                }
            }
        };
    });

    document.getElementById('mapCanvas').onmouseleave = () => {
        hoverItem = null;
        document.getElementById('mapTooltip').classList.add('hidden');
        draw();
    };
    document.getElementById('mapCanvas').onmousemove = (e) => {
        const canvas = e.target;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Store CSS-pixel mouse position relative to canvas-container for tooltip placement
        const containerRect = canvas.parentElement.getBoundingClientRect();
        hoverMouse = { x: e.clientX - containerRect.left, y: e.clientY - containerRect.top };

        const data = currentMode === 'generate' ? (currentTask ? (currentView === 'placement' ? currentTask.base : currentTask.transformed) : null) : evalData;
        if (!data) return;

        const ws = data.workspace;
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
        // In split view strip the right-panel x-shift so both halves share the same world coords
        const panelCx = isSplit ? cx % (canvas.width / 2) : cx;
        const tx = ((panelCx - offX) / scale) + minX - pad;
        const ty = maxY - ((cy - offY) / scale) + pad;

        let all = [];
        if (currentMode === 'generate') {
            const label = (base, type) => i => ({ ...i, _label: `${base} ${type}` });
            if (currentView === 'placement') {
                const usedObjKeys = new Set([...data.knownObjs, ...data.unknownObjs].map(o => `${o.x},${o.y}`));
                const usedBoxKeys = new Set([...data.knownBoxes, ...data.unknownBoxes].map(b => `${b.x},${b.y}`));
                all = [
                    { ...data.startPose, _label: 'Start Pose' },
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
            const mouseIsRight = isSplit && cx > canvas.width / 2;
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

        // Match-line hit detection in canvas space (lines span both panels)
        let nearMatch = null;
        if (!near && isSplit && evaluationResult) {
            const knownGTSetHit = new Set(evalData.gt.known);
            const offX_left = offX;
            const canvasXL = wx => offX_left + (wx - minX + pad) * scale;
            const canvasXR = wx => offX_left + canvas.width / 2 + (wx - minX + pad) * scale;
            const canvasYc = wy => offY + (maxY - wy + pad) * scale;
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

        hoverItem = near || nearMatch; draw();
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
};
