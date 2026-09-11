/* ============================================================
 *  Velostat Pressure Sole Visualizer
 *  Simulated data – ready for ESP32 / Bluetooth integration
 * ============================================================ */
(function () {
  'use strict';

  /* ----------------------------------------------------------
   *  Configuration
   *  Change rows / cols here to match a different Velostat mat.
   * ---------------------------------------------------------- */
  const CONFIG = {
    rows: 8,
    cols: 12,
    foot: 'right',
    viewBox: { width: 200, height: 420 },
    cellGap: 1.0,        // SVG-unit gap between cells
    cellRadius: 1.5,     // rounded corners on each cell rect
    maxPressure: 100,
  };

  /* ----------------------------------------------------------
   *  Right-foot sole path  (bottom view, toes at top)
   *  Coordinate space matches the viewBox (200 × 420).
   *  The medial arch is on the LEFT side of the path.
   * ---------------------------------------------------------- */
  const FOOT_PATH = [
    'M 100,10',
    'C 130,4  160,12 175,35',     // top → little-toe side
    'C 188,55 192,85 190,115',    // lateral forefoot (widest)
    'C 188,145 184,170 178,195',  // lateral mid-forefoot
    'C 172,220 168,245 165,270',  // lateral midfoot
    'C 163,295 162,315 162,340',  // lateral near heel
    'C 160,365 150,390 130,402',  // heel – lateral rounding
    'C 115,412 92,410 78,398',    // heel – bottom crossing
    'C 64,385  58,360  58,335',   // heel – medial side
    'C 58,310  62,285  72,262',   // medial above heel
    'C 82,242  88,222  84,200',   // medial arch (deepest)
    'C 76,175  55,148  38,120',   // medial forefoot (widens)
    'C 22,94   18,68   26,44',    // medial upper forefoot
    'C 34,22   56,8    78,6',     // big-toe area
    'C 88,4    95,6   100,10',    // close at top-centre
    'Z',
  ].join(' ');

  /* ----------------------------------------------------------
   *  State
   * ---------------------------------------------------------- */
  const pressureData = {
    foot: CONFIG.foot,
    rows: CONFIG.rows,
    cols: CONFIG.cols,
    values: [],               // number[row][col]  0-100
  };

  let activeCellMask = [];    // boolean[row][col]
  let cellElements   = [];    // SVGRectElement[row][col]
  let isDragging     = false;
  let brushPressure  = 50;

  /* ----------------------------------------------------------
   *  Colour scale  (dark-blue → blue → green → yellow → red)
   * ---------------------------------------------------------- */
  const COLOR_STOPS = [
    { pos: 0,   h: 220, s: 70, l: 18 },
    { pos: 12,  h: 215, s: 80, l: 30 },
    { pos: 25,  h: 200, s: 82, l: 40 },
    { pos: 40,  h: 150, s: 72, l: 42 },
    { pos: 55,  h: 80,  s: 85, l: 48 },
    { pos: 70,  h: 45,  s: 92, l: 50 },
    { pos: 85,  h: 20,  s: 96, l: 48 },
    { pos: 100, h: 0,   s: 100, l: 50 },
  ];

  function pressureToColor(value) {
    if (value <= 0) return 'rgba(10, 18, 38, 0.35)';

    let lo = COLOR_STOPS[0];
    let hi = COLOR_STOPS[COLOR_STOPS.length - 1];
    for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
      if (value >= COLOR_STOPS[i].pos && value <= COLOR_STOPS[i + 1].pos) {
        lo = COLOR_STOPS[i];
        hi = COLOR_STOPS[i + 1];
        break;
      }
    }
    const range = hi.pos - lo.pos;
    const t = range > 0 ? (value - lo.pos) / range : 0;
    const h = Math.round(lo.h + t * (hi.h - lo.h));
    const s = Math.round(lo.s + t * (hi.s - lo.s));
    const l = Math.round(lo.l + t * (hi.l - lo.l));
    return `hsl(${h}, ${s}%, ${l}%)`;
  }

  /* ----------------------------------------------------------
   *  Initialisation
   * ---------------------------------------------------------- */
  function init() {
    resetPressureValues();
    buildSVG();
    generateMask();
    createCellGrid();
    renderGrid();
    paintLegend();
    updateStats();
    bindEvents();
  }

  function resetPressureValues() {
    pressureData.rows = CONFIG.rows;
    pressureData.cols = CONFIG.cols;
    pressureData.values = [];
    for (let r = 0; r < CONFIG.rows; r++) {
      pressureData.values[r] = new Array(CONFIG.cols).fill(0);
    }
  }

  /* ----------------------------------------------------------
   *  Build SVG structure
   * ---------------------------------------------------------- */
  function buildSVG() {
    const svg = document.getElementById('foot-svg');
    const ns  = 'http://www.w3.org/2000/svg';
    const { width, height } = CONFIG.viewBox;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = '';

    // --- defs: clip-path ---
    const defs = document.createElementNS(ns, 'defs');
    const clip = document.createElementNS(ns, 'clipPath');
    clip.id = 'foot-clip';

    const clipPathEl = document.createElementNS(ns, 'path');
    clipPathEl.id = 'foot-clip-path';
    clipPathEl.setAttribute('d', FOOT_PATH);
    clip.appendChild(clipPathEl);
    defs.appendChild(clip);
    svg.appendChild(defs);

    // --- subtle background fill inside the foot ---
    const bgPath = document.createElementNS(ns, 'path');
    bgPath.setAttribute('d', FOOT_PATH);
    bgPath.setAttribute('fill', 'rgba(14, 22, 42, 0.55)');
    svg.appendChild(bgPath);

    // --- cell container (clipped to foot) ---
    const g = document.createElementNS(ns, 'g');
    g.id = 'cells-group';
    g.setAttribute('clip-path', 'url(#foot-clip)');
    svg.appendChild(g);

    // --- outline drawn on top ---
    const outline = document.createElementNS(ns, 'path');
    outline.setAttribute('d', FOOT_PATH);
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', '#3b6fa0');
    outline.setAttribute('stroke-width', '2.5');
    outline.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(outline);
  }

  /* ----------------------------------------------------------
   *  Generate active-cell mask
   *  Uses SVGGeometryElement.isPointInFill() so the mask
   *  automatically adapts to any matrix size.
   * ---------------------------------------------------------- */
  function generateMask() {
    const path  = document.getElementById('foot-clip-path');
    const cellW = CONFIG.viewBox.width  / CONFIG.cols;
    const cellH = CONFIG.viewBox.height / CONFIG.rows;

    activeCellMask = [];
    for (let r = 0; r < CONFIG.rows; r++) {
      activeCellMask[r] = [];
      for (let c = 0; c < CONFIG.cols; c++) {
        const pt = new DOMPoint((c + 0.5) * cellW, (r + 0.5) * cellH);
        activeCellMask[r][c] = path.isPointInFill(pt);
      }
    }

    // Expose for external inspection / hardware integration
    window.activeCellMask = activeCellMask;
  }

  /* ----------------------------------------------------------
   *  Create the SVG <rect> grid
   * ---------------------------------------------------------- */
  function createCellGrid() {
    const ns    = 'http://www.w3.org/2000/svg';
    const group = document.getElementById('cells-group');
    const cellW = CONFIG.viewBox.width  / CONFIG.cols;
    const cellH = CONFIG.viewBox.height / CONFIG.rows;
    const gap   = CONFIG.cellGap;

    group.innerHTML = '';
    cellElements = [];

    for (let r = 0; r < CONFIG.rows; r++) {
      cellElements[r] = [];
      for (let c = 0; c < CONFIG.cols; c++) {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x',      c * cellW + gap / 2);
        rect.setAttribute('y',      r * cellH + gap / 2);
        rect.setAttribute('width',  cellW - gap);
        rect.setAttribute('height', cellH - gap);
        rect.setAttribute('rx', CONFIG.cellRadius);
        rect.setAttribute('ry', CONFIG.cellRadius);
        rect.dataset.row = r;
        rect.dataset.col = c;

        if (!activeCellMask[r][c]) {
          rect.style.opacity       = '0';
          rect.style.pointerEvents = 'none';
        }

        group.appendChild(rect);
        cellElements[r][c] = rect;
      }
    }
  }

  /* ----------------------------------------------------------
   *  Render / refresh grid colours
   * ---------------------------------------------------------- */
  function renderGrid() {
    for (let r = 0; r < CONFIG.rows; r++) {
      for (let c = 0; c < CONFIG.cols; c++) {
        if (!activeCellMask[r]?.[c]) continue;
        cellElements[r][c].setAttribute(
          'fill',
          pressureToColor(pressureData.values[r][c]),
        );
      }
    }
  }

  /* ----------------------------------------------------------
   *  Statistics
   * ---------------------------------------------------------- */
  function updateStats() {
    let maxVal = 0, maxR = -1, maxC = -1, sum = 0, count = 0;

    for (let r = 0; r < CONFIG.rows; r++) {
      for (let c = 0; c < CONFIG.cols; c++) {
        if (!activeCellMask[r]?.[c]) continue;
        const v = pressureData.values[r][c];
        count++;
        sum += v;
        if (v > maxVal) { maxVal = v; maxR = r; maxC = c; }
      }
    }

    const avg = count > 0 ? sum / count : 0;

    document.getElementById('stat-max').textContent =
      maxVal > 0 ? `${maxVal}%  [row ${maxR}, col ${maxC}]` : '0%';
    document.getElementById('stat-avg').textContent        = `${avg.toFixed(1)}%`;
    document.getElementById('stat-active-cells').textContent = String(count);
  }

  /* ----------------------------------------------------------
   *  Colour legend  (canvas gradient)
   * ---------------------------------------------------------- */
  function paintLegend() {
    const canvas = document.getElementById('legend-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w   = canvas.width;
    const h   = canvas.height;
    for (let x = 0; x < w; x++) {
      ctx.fillStyle = pressureToColor((x / (w - 1)) * 100);
      ctx.fillRect(x, 0, 1, h);
    }
  }

  /* ----------------------------------------------------------
   *  Pointer helpers
   * ---------------------------------------------------------- */
  function svgPoint(event) {
    const svg = document.getElementById('foot-svg');
    const pt  = svg.createSVGPoint();
    const src = event.touches ? event.touches[0] : event;
    pt.x = src.clientX;
    pt.y = src.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function cellAt(event) {
    const pt   = svgPoint(event);
    const cellW = CONFIG.viewBox.width  / CONFIG.cols;
    const cellH = CONFIG.viewBox.height / CONFIG.rows;
    const col  = Math.floor(pt.x / cellW);
    const row  = Math.floor(pt.y / cellH);

    if (
      row >= 0 && row < CONFIG.rows &&
      col >= 0 && col < CONFIG.cols &&
      activeCellMask[row]?.[col]
    ) {
      return { row, col };
    }
    return null;
  }

  function applyBrush(row, col) {
    pressureData.values[row][col] = clamp(brushPressure);
    cellElements[row][col].setAttribute(
      'fill',
      pressureToColor(pressureData.values[row][col]),
    );
    updateStats();
  }

  /* ----------------------------------------------------------
   *  Tooltip
   * ---------------------------------------------------------- */
  function showTooltip(event, row, col) {
    const tip = document.getElementById('tooltip');
    const v   = pressureData.values[row][col];
    tip.textContent = `Cell [${row}, ${col}]  —  ${v}%`;
    tip.style.display = 'block';

    const src  = event.touches ? event.touches[0] : event;
    let left   = src.clientX + 14;
    let top    = src.clientY - 36;

    // Keep on-screen
    if (left + 170 > window.innerWidth) left = src.clientX - 170;
    if (top < 0) top = src.clientY + 20;

    tip.style.left = left + 'px';
    tip.style.top  = top  + 'px';
  }

  function hideTooltip() {
    document.getElementById('tooltip').style.display = 'none';
  }

  /* ----------------------------------------------------------
   *  Event binding
   * ---------------------------------------------------------- */
  function bindEvents() {
    const svg = document.getElementById('foot-svg');

    // --- Mouse ---
    svg.addEventListener('mousedown', (e) => {
      isDragging = true;
      const c = cellAt(e);
      if (c) { applyBrush(c.row, c.col); showTooltip(e, c.row, c.col); }
    });

    svg.addEventListener('mousemove', (e) => {
      const c = cellAt(e);
      if (c) {
        showTooltip(e, c.row, c.col);
        if (isDragging) applyBrush(c.row, c.col);
      } else {
        hideTooltip();
      }
    });

    svg.addEventListener('mouseup',    () => { isDragging = false; });
    svg.addEventListener('mouseleave', () => { isDragging = false; hideTooltip(); });

    // --- Touch ---
    svg.addEventListener('touchstart', (e) => {
      e.preventDefault();
      isDragging = true;
      const c = cellAt(e);
      if (c) { applyBrush(c.row, c.col); showTooltip(e, c.row, c.col); }
    }, { passive: false });

    svg.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const c = cellAt(e);
      if (c) {
        if (isDragging) applyBrush(c.row, c.col);
        showTooltip(e, c.row, c.col);
      }
    }, { passive: false });

    svg.addEventListener('touchend', () => { isDragging = false; hideTooltip(); });

    // --- Pressure slider ---
    const slider = document.getElementById('pressure-slider');
    slider.addEventListener('input', () => {
      brushPressure = parseInt(slider.value, 10);
      document.getElementById('slider-value').textContent = brushPressure + '%';
    });

    // --- Buttons ---
    document.getElementById('btn-heel-strike').addEventListener('click', heelStrike);
    document.getElementById('btn-foot-flat').addEventListener('click',   footFlat);
    document.getElementById('btn-forefoot').addEventListener('click',    forefootLoading);
    document.getElementById('btn-toe-off').addEventListener('click',     toeOff);
    document.getElementById('btn-clear-sole').addEventListener('click',  clearSole);
    document.getElementById('btn-randomize').addEventListener('click',   randomize);
    document.getElementById('btn-clear').addEventListener('click',       resetAll);
  }

  /* ----------------------------------------------------------
   *  Simulation patterns
   * ---------------------------------------------------------- */

  /** Apply a per-cell function and refresh the display. */
  function applyPattern(fn) {
    for (let r = 0; r < CONFIG.rows; r++) {
      for (let c = 0; c < CONFIG.cols; c++) {
        pressureData.values[r][c] = activeCellMask[r]?.[c] ? fn(r, c) : 0;
      }
    }
    renderGrid();
    updateStats();
  }

  /** High pressure near the heel, fading toward the toes. */
  function heelStrike() {
    applyPattern((r) => {
      const t = r / (CONFIG.rows - 1);           // 0 = toes, 1 = heel
      return clamp(Math.round(t * t * 98) + randInt(-6, 6));
    });
  }

  /** Even distribution with a dip at the arch. */
  function footFlat() {
    applyPattern((r) => {
      const t = r / (CONFIG.rows - 1);
      const arch = 1 - 0.45 * Math.exp(-((t - 0.55) ** 2) / 0.02);
      return clamp(Math.round(58 * arch) + randInt(-8, 8));
    });
  }

  /** Pressure concentrated in the forefoot area. */
  function forefootLoading() {
    applyPattern((r) => {
      const t = r / (CONFIG.rows - 1);
      return clamp(
        Math.round(95 * Math.exp(-((t - 0.28) ** 2) / 0.07)) + randInt(-6, 6),
      );
    });
  }

  /** Heavy pressure on the toes, tapering to nothing at the heel. */
  function toeOff() {
    applyPattern((r) => {
      const t = r / (CONFIG.rows - 1);
      return clamp(Math.round(98 * Math.exp(-(t ** 2) / 0.05)) + randInt(-6, 6));
    });
  }

  /** Zero out the entire sole. */
  function clearSole() {
    applyPattern(() => 0);
  }

  /** Fill every active cell with a random 0-100 value. */
  function randomize() {
    applyPattern(() => randInt(0, 100));
  }

  /** Identical to clearSole — wired to the "Clear / Reset" button. */
  function resetAll() {
    resetPressureValues();
    renderGrid();
    updateStats();
  }

  /* ----------------------------------------------------------
   *  Hardware integration  (ESP32 / BLE / Wi-Fi)
   *
   *  Call  window.updatePressureMatrix(data)  with an object:
   *    { foot: "right", rows: 8, cols: 12,
   *      values: [[0…100, …], …] }
   *
   *  If the incoming size differs, the grid rebuilds itself.
   * ---------------------------------------------------------- */
  function updatePressureMatrix(newMatrix) {
    const sizeChanged =
      newMatrix.rows !== CONFIG.rows || newMatrix.cols !== CONFIG.cols;

    if (sizeChanged) {
      CONFIG.rows = newMatrix.rows;
      CONFIG.cols = newMatrix.cols;
      pressureData.rows = newMatrix.rows;
      pressureData.cols = newMatrix.cols;
      pressureData.foot = newMatrix.foot || CONFIG.foot;

      // Full rebuild for the new dimensions
      resetPressureValues();
      buildSVG();
      generateMask();
      createCellGrid();
    }

    // Copy values (clamped)
    for (let r = 0; r < CONFIG.rows; r++) {
      for (let c = 0; c < CONFIG.cols; c++) {
        pressureData.values[r][c] = clamp(newMatrix.values[r]?.[c] ?? 0);
      }
    }

    renderGrid();
    updateStats();
  }

  // Expose public API
  window.updatePressureMatrix = updatePressureMatrix;
  window.pressureData         = pressureData;

  /* ----------------------------------------------------------
   *  Helpers
   * ---------------------------------------------------------- */
  function clamp(v) {
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /* ----------------------------------------------------------
   *  Boot
   * ---------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', init);
})();
