/**
 * Image Studio Pro — Fabric.js (Photoshop-style: layers, undo, blend, align, group…)
 * Magic shapes: Pillow via window.__IMAGE_STUDIO__.magicShapeUrl
 */
(function () {
  'use strict';

  const CFG = window.__IMAGE_STUDIO__ || {};
  const MAGIC_URL = CFG.magicShapeUrl || '';
  const COMMAND_URL = CFG.shapeCommandUrl || '';
  const GIF_URL = CFG.toGifUrl || '';

  const FONT_LIST = [
    'Inter',
    'Roboto',
    'Open Sans',
    'Lato',
    'Montserrat',
    'Raleway',
    'Poppins',
    'Nunito',
    'Ubuntu',
    'Work Sans',
    'Source Sans 3',
    'DM Sans',
    'Rubik',
    'Quicksand',
    'Barlow',
    'Mulish',
    'Manrope',
    'Outfit',
    'Figtree',
    'Plus Jakarta Sans',
    'Sora',
    'Lexend',
    'Karla',
    'IBM Plex Sans',
    'Noto Sans',
    'Titillium Web',
    'Exo 2',
    'Oxygen',
    'Cabin',
    'Dosis',
    'Asap',
    'Hind',
    'Signika Negative',
    'Merriweather',
    'Playfair Display',
    'Lora',
    'Libre Baskerville',
    'Source Serif 4',
    'PT Serif',
    'Crimson Pro',
    'EB Garamond',
    'Bitter',
    'Domine',
    'Fraunces',
    'Newsreader',
    'Spectral',
    'Cormorant Garamond',
    'Abril Fatface',
    'Bebas Neue',
    'Oswald',
    'Anton',
    'Fjalla One',
    'Righteous',
    'Russo One',
    'Lobster',
    'Pacifico',
    'Dancing Script',
    'Great Vibes',
    'Satisfy',
    'Caveat',
    'Permanent Marker',
    'Shadows Into Light',
    'Indie Flower',
    'Comfortaa',
    'Josefin Sans',
    'Kanit',
    'Prompt',
    'Chakra Petch',
    'Orbitron',
    'Audiowide',
    'Bungee',
    'Fira Code',
    'JetBrains Mono',
    'Source Code Pro',
    'IBM Plex Mono',
    'Space Mono',
    'Inconsolata',
    'Recursive',
    'Architects Daughter',
    'Patrick Hand',
    'Amatic SC',
    'Cinzel',
    'Poiret One',
    'Monoton',
    'Graduate',
    'Black Ops One',
    'Press Start 2P',
    'VT323',
    'Silkscreen',
    'Noto Sans Devanagari',
    'Tiro Devanagari Hindi',
    'Hind Siliguri',
    'Mukta',
    'Baloo 2',
    'Kalam',
    'Yatra One',
  ];

  const loadedFontLinks = {};

  /** @type {fabric.Canvas | null} */
  let canvas = null;
  /** @type {fabric.Image | null} */
  let bgImageObj = null;

  /** @type {fabric.Object | null} */
  let fabricClipboard = null;

  let historyStack = [];
  let historyIndex = -1;
  let historySilent = false;
  const HISTORY_MAX = 45;

  let saveHistoryTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function csrfToken() {
    const m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }

  let fontsPopulated = false;
  function populateFontSelect() {
    if (fontsPopulated) return;
    const sel = $('pro-font');
    if (!sel) return;
    fontsPopulated = true;
    FONT_LIST.forEach(function (name) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      sel.appendChild(o);
    });
    sel.value = 'Inter';
  }

  function ensureFontLoaded(name) {
    if (!name || loadedFontLinks[name]) return;
    loadedFontLinks[name] = true;
    const id = 'gf-' + name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(name).replace(/%20/g, '+') +
      ':wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }

  function syncCanvasSizeInputs() {
    if (!canvas) return;
    const wi = $('pro-canvas-w');
    const he = $('pro-canvas-h');
    if (wi) wi.value = String(Math.round(canvas.getWidth()));
    if (he) he.value = String(Math.round(canvas.getHeight()));
  }

  function applyCanvasDimensions(w, h) {
    ensureFabric();
    if (!canvas) return;
    w = Math.max(100, Math.min(4096, Math.round(w)));
    h = Math.max(100, Math.min(4096, Math.round(h)));
    canvas.setDimensions({ width: w, height: h });
    canvas.calcOffset();
    canvas.requestRenderAll();
    syncCanvasSizeInputs();
    syncGridOverlay();
    scheduleHistory();
    refreshLayers();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 56, g: 189, b: 248 };
  }

  function starPoints(cx, cy, spikes, outerR, innerR) {
    const step = Math.PI / spikes;
    let rot = -Math.PI / 2;
    const pts = [];
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      pts.push({ x: cx + Math.cos(rot) * r, y: cy + Math.sin(rot) * r });
      rot += step;
    }
    return pts;
  }

  function regularPolygonPoints(cx, cy, n, r) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function patchFabricSerialization() {
    if (fabric.Object.prototype.__studioPatched) return;
    fabric.Object.prototype.__studioPatched = true;
    const _toObject = fabric.Object.prototype.toObject;
    fabric.Object.prototype.toObject = function (propertiesToInclude) {
      return fabric.util.object.extend(_toObject.call(this, propertiesToInclude), {
        isBgImage: this.isBgImage,
      });
    };
  }

  function canvasToHistoryJSON() {
    if (!canvas) return '';
    return JSON.stringify(
      canvas.toJSON(['isBgImage', 'selectable', 'evented', 'globalCompositeOperation'])
    );
  }

  function applyHistoryJSON(jsonStr) {
    if (!canvas || !jsonStr) return;
    historySilent = true;
    canvas.loadFromJSON(jsonStr, function () {
      bgImageObj = null;
      canvas.getObjects().forEach(function (o) {
        if (o.isBgImage) bgImageObj = o;
      });
      canvas.renderAll();
      refreshLayers();
      syncPropsFromSelection();
      historySilent = false;
    });
  }

  function pushHistory() {
    if (historySilent || !canvas) return;
    const snap = canvasToHistoryJSON();
    if (historyIndex >= 0 && historyStack[historyIndex] === snap) return;
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(snap);
    if (historyStack.length > HISTORY_MAX) {
      historyStack.shift();
    } else {
      historyIndex++;
    }
    updateUndoRedoButtons();
  }

  function scheduleHistory() {
    if (historySilent) return;
    if (saveHistoryTimer) clearTimeout(saveHistoryTimer);
    saveHistoryTimer = setTimeout(function () {
      saveHistoryTimer = null;
      pushHistory();
    }, 180);
  }

  function undo() {
    if (!canvas || historyIndex <= 0) return;
    historyIndex--;
    applyHistoryJSON(historyStack[historyIndex]);
    updateUndoRedoButtons();
  }

  function redo() {
    if (!canvas || historyIndex >= historyStack.length - 1) return;
    historyIndex++;
    applyHistoryJSON(historyStack[historyIndex]);
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const u = $('pro-undo');
    const r = $('pro-redo');
    if (u) u.disabled = historyIndex <= 0;
    if (r) r.disabled = historyIndex >= historyStack.length - 1;
  }

  /** Keep background image pinned to the bottom of the stack (Photoshop-style). */
  function ensureBackgroundAtBottom() {
    if (!canvas || !bgImageObj) return;
    try {
      canvas.sendToBack(bgImageObj);
    } catch (e) {
      /* ignore */
    }
  }

  /** Apply stack from top-first list (index 0 = topmost layer). Background stays last. */
  function applyTopFirstStackOrder(topFirst) {
    if (!canvas) return;
    var order = topFirst.slice();
    if (bgImageObj) {
      order = order.filter(function (o) {
        return o !== bgImageObj;
      });
      order.push(bgImageObj);
    }
    var bottomFirst = order.slice().reverse();
    for (var i = 0; i < bottomFirst.length; i++) {
      canvas.moveTo(bottomFirst[i], i);
    }
    ensureBackgroundAtBottom();
    canvas.requestRenderAll();
    scheduleHistory();
    refreshLayers();
  }

  /** Drag-reorder layers (top-first indices). */
  function reorderLayersDragDrop(fromIdx, toIdx) {
    if (!canvas || fromIdx === toIdx) return;
    var order = canvas.getObjects().slice().reverse();
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= order.length || toIdx >= order.length) return;
    var item = order[fromIdx];
    if (item === bgImageObj) return;
    var newOrder = order.slice();
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, item);
    if (bgImageObj) {
      newOrder = newOrder.filter(function (o) {
        return o !== bgImageObj;
      });
      newOrder.push(bgImageObj);
    }
    applyTopFirstStackOrder(newOrder);
  }

  /**
   * @param {'forward'|'backward'|'tofront'|'toback'} op
   */
  function applyLayerOrder(op) {
    if (!canvas) return;
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;
    if (op === 'forward') {
      canvas.bringForward(o);
    } else if (op === 'backward') {
      if (canvas.getObjects().indexOf(o) <= (bgImageObj ? 1 : 0)) return;
      canvas.sendBackwards(o);
    } else if (op === 'tofront') {
      canvas.bringToFront(o);
    } else if (op === 'toback') {
      const targetIdx = bgImageObj ? 1 : 0;
      if (canvas.getObjects().indexOf(o) <= targetIdx) return;
      canvas.moveTo(o, targetIdx);
    }
    ensureBackgroundAtBottom();
    canvas.requestRenderAll();
    scheduleHistory();
    refreshLayers();
  }

  /**
   * Image to apply Fabric filters to: active image (including background image),
   * else first image in a multi-select, else top-most image on the canvas.
   */
  function resolveFabricImageForEffects() {
    if (!canvas) return null;
    const o = canvas.getActiveObject();
    if (o) {
      if (o.type === 'image') return o;
      if (o.type === 'activeSelection' && typeof o.getObjects === 'function') {
        const imgs = o.getObjects().filter(function (x) {
          return x.type === 'image';
        });
        if (imgs.length) return imgs[0];
      }
    }
    const stack = canvas.getObjects();
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].type === 'image') return stack[i];
    }
    return null;
  }

  function buildPresetFilters(key) {
    const F = fabric.Image.filters;
    if (!F || typeof F.Brightness !== 'function') return [];
    const filters = [];
    const push = function (f) {
      if (f) filters.push(f);
    };
    switch (key) {
      case 'reset':
      case 'none':
        return [];
      case 'cinematic':
        push(new F.Brightness({ brightness: -0.04 }));
        push(new F.Contrast({ contrast: 0.2 }));
        push(new F.Saturation({ saturation: 0.14 }));
        break;
      case 'hdr':
        push(new F.Brightness({ brightness: 0.07 }));
        push(new F.Contrast({ contrast: 0.3 }));
        push(new F.Saturation({ saturation: 0.22 }));
        break;
      case 'soft_glow':
        push(new F.Brightness({ brightness: 0.08 }));
        push(new F.Contrast({ contrast: -0.06 }));
        push(new F.Saturation({ saturation: -0.06 }));
        if (F.Blur) push(new F.Blur({ blur: 0.028 }));
        break;
      case 'moody':
        push(new F.Brightness({ brightness: -0.12 }));
        push(new F.Contrast({ contrast: 0.12 }));
        push(new F.Saturation({ saturation: -0.18 }));
        break;
      case 'clean':
        push(new F.Brightness({ brightness: 0.06 }));
        push(new F.Contrast({ contrast: 0.1 }));
        push(new F.Saturation({ saturation: 0.08 }));
        break;
      case 'warm':
        push(new F.Brightness({ brightness: 0.05 }));
        push(new F.Contrast({ contrast: 0.08 }));
        push(new F.Saturation({ saturation: 0.22 }));
        break;
      case 'cool':
        push(new F.Brightness({ brightness: -0.03 }));
        push(new F.Saturation({ saturation: 0.06 }));
        if (F.HueRotation) push(new F.HueRotation({ rotation: -0.14 }));
        break;
      case 'bw':
        if (F.Grayscale) push(new F.Grayscale());
        push(new F.Contrast({ contrast: 0.2 }));
        break;
      case 'vintage':
        push(new F.Brightness({ brightness: 0.05 }));
        push(new F.Contrast({ contrast: -0.08 }));
        push(new F.Saturation({ saturation: -0.14 }));
        if (F.Blur) push(new F.Blur({ blur: 0.018 }));
        break;
      case 'neon':
        push(new F.Brightness({ brightness: 0.04 }));
        push(new F.Contrast({ contrast: 0.24 }));
        push(new F.Saturation({ saturation: 0.48 }));
        break;
      case 'matte':
        push(new F.Brightness({ brightness: -0.07 }));
        push(new F.Contrast({ contrast: 0.1 }));
        push(new F.Saturation({ saturation: -0.18 }));
        if (F.Blur) push(new F.Blur({ blur: 0.03 }));
        break;
      default:
        return [];
    }
    return filters;
  }

  function applyFiltersToActiveImage(filters, done) {
    ensureFabric();
    if (!canvas) {
      window.alert('Switch to Pro canvas first.');
      if (typeof done === 'function') done(false);
      return;
    }
    const img = resolveFabricImageForEffects();
    if (!img) {
      window.alert(
        'No image found. Use “Send photo to Pro”, import an image in Pro, or add a background image — then click the layer or apply again.'
      );
      if (typeof done === 'function') done(false);
      return;
    }
    img.filters = filters || [];
    if (typeof img.objectCaching !== 'undefined') {
      img.objectCaching = false;
    }
    img.dirty = true;
    /* Fabric 5: applyFilters() is synchronous — it does not invoke a callback */
    if (typeof img.applyFilters === 'function') {
      try {
        img.applyFilters();
      } catch (e) {
        console.error('applyFilters', e);
        window.alert('Could not apply filters. Try a smaller image or refresh the page.');
        if (typeof done === 'function') done(false);
        return;
      }
    }
    canvas.requestRenderAll();
    scheduleHistory();
    if (typeof done === 'function') done(true);
  }

  function syncFxSliderLabels() {
    const map = [
      ['pro-fx-brightness', 'v-fx-bright'],
      ['pro-fx-contrast', 'v-fx-contrast'],
      ['pro-fx-saturation', 'v-fx-sat'],
      ['pro-fx-blur', 'v-fx-blur'],
    ];
    map.forEach(function (pair) {
      const inp = $(pair[0]);
      const lab = $(pair[1]);
      if (inp && lab) lab.textContent = parseFloat(inp.value || 0).toFixed(2);
    });
  }

  function wireImageEffectsUi() {
    [
      ['pro-fx-brightness', 'v-fx-bright'],
      ['pro-fx-contrast', 'v-fx-contrast'],
      ['pro-fx-saturation', 'v-fx-sat'],
      ['pro-fx-blur', 'v-fx-blur'],
    ].forEach(function (pair) {
      const inp = $(pair[0]);
      const lab = $(pair[1]);
      if (!inp || !lab) return;
      inp.addEventListener('input', function () {
        lab.textContent = parseFloat(inp.value || 0).toFixed(2);
      });
    });

    $('pro-effect-apply-preset') &&
      $('pro-effect-apply-preset').addEventListener('click', function () {
        ensureFabric();
        if (typeof fabric === 'undefined' || !fabric.Image || !fabric.Image.filters) {
          window.alert('Image editor library did not load. Refresh the page.');
          return;
        }
        const sel = $('pro-effect-preset');
        const key = sel && sel.value;
        if (!key) {
          window.alert('Choose a preset first.');
          return;
        }
        if (key === 'reset') {
          applyFiltersToActiveImage([]);
          return;
        }
        applyFiltersToActiveImage(buildPresetFilters(key));
      });

    $('pro-effect-apply-sliders') &&
      $('pro-effect-apply-sliders').addEventListener('click', function () {
        ensureFabric();
        const F = fabric.Image.filters;
        if (!F || typeof F.Brightness !== 'function') {
          window.alert('Image filters are not available. Refresh the page.');
          return;
        }
        const b = parseFloat(($('pro-fx-brightness') && $('pro-fx-brightness').value) || 0);
        const c = parseFloat(($('pro-fx-contrast') && $('pro-fx-contrast').value) || 0);
        const s = parseFloat(($('pro-fx-saturation') && $('pro-fx-saturation').value) || 0);
        const bl = parseFloat(($('pro-fx-blur') && $('pro-fx-blur').value) || 0);
        const filters = [];
        if (Math.abs(b) > 0.0001) filters.push(new F.Brightness({ brightness: b }));
        if (Math.abs(c) > 0.0001) filters.push(new F.Contrast({ contrast: c }));
        if (Math.abs(s) > 0.0001) filters.push(new F.Saturation({ saturation: s }));
        if (bl > 0.0001 && F.Blur) filters.push(new F.Blur({ blur: bl }));
        applyFiltersToActiveImage(filters);
      });

    $('pro-effect-reset-sliders') &&
      $('pro-effect-reset-sliders').addEventListener('click', function () {
        ['pro-fx-brightness', 'pro-fx-contrast', 'pro-fx-saturation', 'pro-fx-blur'].forEach(function (id) {
          const el = $(id);
          if (el) el.value = '0';
        });
        syncFxSliderLabels();
      });

    syncFxSliderLabels();
  }

  function layerLabel(obj, i) {
    if (obj.name) return String(obj.name);
    if (obj.isBgImage) return 'Background image';
    if (obj.type === 'i-text') return 'Text ' + (i + 1);
    if (obj.type === 'image') return 'Image ' + (i + 1);
    if (obj.type === 'group') return 'Group ' + (i + 1);
    if (obj.type === 'path') return 'Drawing ' + (i + 1);
    if (obj.type === 'rect') return 'Rectangle';
    if (obj.type === 'ellipse' || obj.type === 'circle') return 'Ellipse';
    if (obj.type === 'triangle') return 'Triangle';
    if (obj.type === 'line') return 'Line';
    if (obj.type === 'polygon') return 'Polygon';
    return obj.type || 'Layer';
  }

  function refreshLayers() {
    const host = $('pro-layers');
    if (!host || !canvas) return;
    if (!host.dataset.dndBound) {
      host.dataset.dndBound = '1';
      host.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
    }
    host.innerHTML = '';
    const objs = canvas.getObjects().slice().reverse();
    const active = canvas.getActiveObject();
    objs.forEach(function (obj, revIdx) {
      const idxBottom = canvas.getObjects().length - 1 - revIdx;
      const row = document.createElement('div');
      row.className = 'pro-layer-row';
      row.dataset.revIdx = String(revIdx);
      if (active === obj || (active && active.type === 'activeSelection' && active.getObjects().indexOf(obj) >= 0)) {
        row.classList.add('active');
      }
      const grip = document.createElement('span');
      grip.className = 'pro-layer-grip';
      grip.innerHTML = '<i class="bi bi-grip-vertical"></i>';
      grip.title = obj === bgImageObj ? 'Background stays at bottom' : 'Drag to reorder';
      if (obj !== bgImageObj) {
        grip.setAttribute('draggable', 'true');
        grip.addEventListener('dragstart', function (e) {
          e.stopPropagation();
          row.style.opacity = '0.65';
          try {
            e.dataTransfer.setData('text/plain', String(revIdx));
            e.dataTransfer.effectAllowed = 'move';
          } catch (err) {
            /* ignore */
          }
        });
        grip.addEventListener('dragend', function () {
          row.style.opacity = '';
          host.querySelectorAll('.pro-layer-drag-over').forEach(function (el) {
            el.classList.remove('pro-layer-drag-over');
          });
        });
      } else {
        grip.classList.add('opacity-25');
      }
      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'btn btn-sm btn-link p-0 text-secondary flex-shrink-0';
      eye.innerHTML = obj.visible === false ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
      eye.title = 'Hide / show layer';
      eye.addEventListener('click', function (e) {
        e.stopPropagation();
        obj.visible = !obj.visible;
        canvas.requestRenderAll();
        pushHistory();
        eye.innerHTML = obj.visible === false ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
      });
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = layerLabel(obj, idxBottom);
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-sm btn-link p-0 text-danger flex-shrink-0';
      delBtn.innerHTML = '<i class="bi bi-trash"></i>';
      delBtn.title = 'Delete this layer';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (obj === bgImageObj) return;
        canvas.remove(obj);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        scheduleHistory();
        refreshLayers();
      });
      row.addEventListener('click', function () {
        canvas.setActiveObject(obj);
        canvas.requestRenderAll();
        refreshLayers();
        syncPropsFromSelection();
      });
      row.addEventListener('dragover', function (e) {
        if (obj === bgImageObj) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          row.classList.add('pro-layer-drag-over');
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('pro-layer-drag-over');
      });
      row.addEventListener('dragleave', function (e) {
        if (!row.contains(e.relatedTarget)) row.classList.remove('pro-layer-drag-over');
      });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        row.classList.remove('pro-layer-drag-over');
        const fromStr = e.dataTransfer.getData('text/plain');
        const fromIdx = parseInt(fromStr, 10);
        let toIdx = revIdx;
        const topOrder = canvas.getObjects().slice().reverse();
        if (obj === bgImageObj && topOrder.length > 1) {
          toIdx = Math.max(0, topOrder.length - 2);
        }
        if (Number.isNaN(fromIdx) || Number.isNaN(toIdx)) return;
        reorderLayersDragDrop(fromIdx, toIdx);
      });
      row.appendChild(grip);
      row.appendChild(eye);
      row.appendChild(name);
      row.appendChild(delBtn);
      host.appendChild(row);
    });
    if (!objs.length) {
      host.innerHTML = '<div class="p-2 text-muted small">No layers yet</div>';
    }
  }

  function syncPropsFromSelection() {
    const o = canvas && canvas.getActiveObject();
    const op = $('pro-opacity');
    const vo = $('v-opacity');
    const bl = $('pro-blend');
    const la = $('pro-lock-aspect');
    if (!o || o === bgImageObj) {
      if (op) op.value = 100;
      if (vo) vo.textContent = '100%';
      if (bl) bl.value = 'source-over';
      if (la) {
        la.checked = false;
        la.disabled = true;
      }
      syncImageCropPanel();
      syncShapeStrokeCornerShadowFromSelection();
      return;
    }
    const opacity = typeof o.opacity === 'number' ? o.opacity : 1;
    if (op) op.value = Math.round(opacity * 100);
    if (vo) vo.textContent = Math.round(opacity * 100) + '%';
    if (bl) bl.value = o.globalCompositeOperation || 'source-over';
    const multi = o.type === 'activeSelection';
    if (la) {
      la.disabled = multi;
      if (!multi) la.checked = !!o.lockUniScaling;
    }
    syncImageCropPanel();
    syncShapeColorsFromSelection();
    syncShapeStrokeCornerShadowFromSelection();
  }

  function getShapeStrokeTarget() {
    const o = canvas && canvas.getActiveObject();
    if (!o || o === bgImageObj) return null;
    if (o.type === 'i-text' || o.type === 'image') return null;
    if (o.type === 'activeSelection') {
      const objs = o.getObjects().filter(function (x) {
        return x !== bgImageObj && x.type !== 'i-text' && x.type !== 'image';
      });
      return objs[0] || null;
    }
    return o;
  }

  function getObjectShadowTarget() {
    const o = canvas && canvas.getActiveObject();
    if (!o || o === bgImageObj) return null;
    if (o.type === 'i-text') return null;
    if (o.type === 'activeSelection') {
      const objs = o.getObjects().filter(function (x) {
        return x !== bgImageObj && x.type !== 'i-text';
      });
      return objs[0] || null;
    }
    return o;
  }

  function syncShapeStrokeCornerShadowFromSelection() {
    const strokeT = getShapeStrokeTarget();
    const swEl = $('pro-shape-stroke-w');
    const vsw = $('v-pro-shape-stroke-w');
    const cornerEl = $('pro-shape-corner');
    const vcorner = $('v-pro-shape-corner');
    const wrap = $('pro-obj-shadow-wrap');
    const blurEl = $('pro-obj-shadow-blur');
    const vblur = $('v-pro-obj-shadow-blur');
    const shCol = $('pro-obj-shadow-color');

    if (swEl) {
      if (!strokeT) {
        swEl.disabled = true;
      } else {
        swEl.disabled = false;
        const w = strokeT.strokeWidth != null ? strokeT.strokeWidth : 0;
        swEl.value = String(Math.min(48, Math.max(0, Math.round(w))));
        if (vsw) vsw.textContent = swEl.value;
      }
    }

    if (cornerEl) {
      const ok = strokeT && strokeT.type === 'rect';
      cornerEl.disabled = !ok;
      if (ok) {
        const rx = strokeT.rx || 0;
        cornerEl.value = String(Math.min(80, Math.max(0, Math.round(rx))));
        if (vcorner) vcorner.textContent = cornerEl.value;
      }
    }

    const shT = getObjectShadowTarget();
    if (blurEl && shCol) {
      if (!shT) {
        blurEl.disabled = true;
        shCol.disabled = true;
        if (wrap) wrap.style.opacity = '0.45';
      } else {
        blurEl.disabled = false;
        shCol.disabled = false;
        if (wrap) wrap.style.opacity = '1';
        if (shT.shadow) {
          blurEl.value = String(Math.round(shT.shadow.blur != null ? shT.shadow.blur : 0));
          if (vblur) vblur.textContent = blurEl.value;
          try {
            if (shT.shadow.color) shCol.value = fabricColorToHex(shT.shadow.color);
          } catch (e) {
            /* ignore */
          }
        } else {
          blurEl.value = '0';
          if (vblur) vblur.textContent = '0';
        }
      }
    }
  }

  function applyShapeStrokeWidthToSelection(val) {
    if (!canvas) return;
    const n = Math.max(0, Math.min(48, parseInt(val, 10) || 0));
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;
    function applyOne(obj) {
      if (!obj || obj === bgImageObj) return;
      if (obj.type === 'image' || obj.type === 'i-text') return;
      obj.set('strokeWidth', n);
      obj.dirty = true;
      obj.setCoords();
    }
    if (o.type === 'activeSelection') {
      o.getObjects().forEach(applyOne);
      o.setCoords();
    } else {
      applyOne(o);
    }
    canvas.requestRenderAll();
  }

  function applyRectCornerToSelection(val) {
    if (!canvas) return;
    const r = Math.max(0, Math.min(80, parseInt(val, 10) || 0));
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;
    function applyOne(obj) {
      if (!obj || obj.type !== 'rect') return;
      obj.set({ rx: r, ry: r });
      obj.dirty = true;
      obj.setCoords();
    }
    if (o.type === 'activeSelection') {
      o.getObjects().forEach(applyOne);
      o.setCoords();
    } else {
      applyOne(o);
    }
    canvas.requestRenderAll();
  }

  function buildObjectShadowFromUi() {
    const blur = parseFloat(($('pro-obj-shadow-blur') && $('pro-obj-shadow-blur').value) || '0');
    const col = ($('pro-obj-shadow-color') && $('pro-obj-shadow-color').value) || '#000000';
    if (blur <= 0) return null;
    const rgb = hexToRgb(col);
    const off = Math.min(14, Math.max(2, Math.round(blur * 0.4)));
    return new fabric.Shadow({
      color: 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.38)',
      blur: blur,
      offsetX: off,
      offsetY: off,
    });
  }

  function applyObjectShadowFromUi() {
    if (!canvas) return;
    const sh = buildObjectShadowFromUi();
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;
    function applyOne(obj) {
      if (!obj || obj.type === 'i-text') return;
      obj.set('shadow', sh);
      obj.dirty = true;
      obj.setCoords();
    }
    if (o.type === 'activeSelection') {
      o.getObjects().forEach(applyOne);
      o.setCoords();
    } else {
      applyOne(o);
    }
    canvas.requestRenderAll();
  }

  function alignObjectCenterBoth() {
    if (!canvas) return;
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;
    if (o.type === 'activeSelection') o.setCoords();
    o.setCoords();
    const br = o.getBoundingRect(true);
    const dx = (canvas.width - br.width) / 2 - br.left;
    const dy = (canvas.height - br.height) / 2 - br.top;
    o.set({ left: o.left + dx, top: o.top + dy });
    o.setCoords();
    canvas.requestRenderAll();
    scheduleHistory();
  }

  function syncShapeColorsFromSelection() {
    const strokeInp = $('pro-stroke-color');
    const fillInp = $('pro-fill-color');
    if (!strokeInp || !fillInp || !canvas) return;
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;

    let target = null;
    if (o.type === 'activeSelection') {
      const objs = o.getObjects().filter(function (x) {
        return x !== bgImageObj && x.type !== 'i-text' && x.type !== 'image';
      });
      if (objs.length) target = objs[0];
    } else if (o.type !== 'i-text' && o.type !== 'image') {
      target = o;
    }
    if (!target) return;

    try {
      if (target.stroke != null && target.stroke !== '') {
        strokeInp.value = fabricColorToHex(target.stroke);
      }
    } catch (e) {
      /* ignore */
    }
    try {
      const f = target.fill;
      if (f != null && typeof f !== 'object' && f !== '' && f !== 'transparent') {
        fillInp.value = fabricColorToHex(f);
      }
    } catch (e2) {
      /* ignore */
    }
  }

  function applyStrokeColorToSelection(hex) {
    if (!canvas) return;
    if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = hex;
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;
    function applyOne(obj) {
      if (!obj || obj === bgImageObj) return;
      if (obj.type === 'image' || obj.type === 'i-text') return;
      obj.set('stroke', hex);
      obj.dirty = true;
      obj.setCoords();
    }
    if (o.type === 'activeSelection') {
      o.getObjects().forEach(applyOne);
      o.setCoords();
    } else {
      applyOne(o);
    }
    canvas.requestRenderAll();
  }

  function applyFillColorToSelection(hex) {
    if (!canvas) return;
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;
    function applyOne(obj) {
      if (!obj || obj === bgImageObj) return;
      if (obj.type === 'image' || obj.type === 'i-text') return;
      if (obj.type === 'line') return;
      obj.set('fill', hex);
      obj.dirty = true;
      obj.setCoords();
    }
    if (o.type === 'activeSelection') {
      o.getObjects().forEach(applyOne);
      o.setCoords();
    } else {
      applyOne(o);
    }
    canvas.requestRenderAll();
  }

  function getImageNaturalSize(img) {
    const el = img && img._element;
    if (!el) return { nw: 1, nh: 1 };
    return {
      nw: Math.max(1, el.naturalWidth || el.width || 1),
      nh: Math.max(1, el.naturalHeight || el.height || 1),
    };
  }

  function syncImageCropPanel() {
    const wrap = $('pro-img-crop-wrap');
    const o = canvas && canvas.getActiveObject();
    const ids = ['pro-img-crop-x', 'pro-img-crop-y', 'pro-img-crop-w', 'pro-img-crop-h'];
    const bad = !o || o.type !== 'image' || o === bgImageObj || o.type === 'activeSelection' || !o._element;
    if (wrap) wrap.style.opacity = bad ? '0.45' : '1';
    ids.forEach(function (id) {
      const el = $(id);
      if (el) el.disabled = bad;
    });
    const rst = $('pro-img-crop-reset');
    if (rst) rst.disabled = bad;
    if (bad) return;
    const { nw, nh } = getImageNaturalSize(o);
    let cx = Math.max(0, Math.min(nw - 1, Math.round(o.cropX || 0)));
    let cy = Math.max(0, Math.min(nh - 1, Math.round(o.cropY || 0)));
    let cw = Math.max(1, Math.min(nw - cx, Math.round(o.width != null ? o.width : nw - cx)));
    let ch = Math.max(1, Math.min(nh - cy, Math.round(o.height != null ? o.height : nh - cy)));
    const ix = $('pro-img-crop-x');
    const iy = $('pro-img-crop-y');
    const iw = $('pro-img-crop-w');
    const ih = $('pro-img-crop-h');
    if (ix) {
      ix.min = '0';
      ix.max = String(Math.max(0, nw - 1));
      ix.value = String(cx);
    }
    if ($('v-pro-img-crop-x')) $('v-pro-img-crop-x').textContent = String(cx);
    if (iy) {
      iy.min = '0';
      iy.max = String(Math.max(0, nh - 1));
      iy.value = String(cy);
    }
    if ($('v-pro-img-crop-y')) $('v-pro-img-crop-y').textContent = String(cy);
    if (iw) {
      iw.min = '1';
      iw.max = String(Math.max(1, nw - cx));
      iw.value = String(cw);
    }
    if ($('v-pro-img-crop-w')) $('v-pro-img-crop-w').textContent = String(cw);
    if (ih) {
      ih.min = '1';
      ih.max = String(Math.max(1, nh - cy));
      ih.value = String(ch);
    }
    if ($('v-pro-img-crop-h')) $('v-pro-img-crop-h').textContent = String(ch);
  }

  function applyImageCropFromUi() {
    const o = canvas && canvas.getActiveObject();
    if (!o || o.type !== 'image' || o === bgImageObj || !o._element) return;
    const { nw, nh } = getImageNaturalSize(o);
    let cx = parseInt(($('pro-img-crop-x') && $('pro-img-crop-x').value) || '0', 10) || 0;
    let cy = parseInt(($('pro-img-crop-y') && $('pro-img-crop-y').value) || '0', 10) || 0;
    let cw = parseInt(($('pro-img-crop-w') && $('pro-img-crop-w').value) || '1', 10) || 1;
    let ch = parseInt(($('pro-img-crop-h') && $('pro-img-crop-h').value) || '1', 10) || 1;
    cx = Math.max(0, Math.min(nw - 1, cx));
    cy = Math.max(0, Math.min(nh - 1, cy));
    cw = Math.max(1, Math.min(nw - cx, cw));
    ch = Math.max(1, Math.min(nh - cy, ch));
    o.set({ cropX: cx, cropY: cy, width: cw, height: ch });
    o.dirty = true;
    o.setCoords();
    canvas.requestRenderAll();
    syncImageCropPanel();
  }

  function ensureFabric() {
    if (canvas || typeof fabric === 'undefined') return;
    patchFabricSerialization();

    const wrap = $('fabric-wrap');
    const w = Math.min(960, Math.max(520, (wrap && wrap.clientWidth) || 960));
    const h = Math.round((w * 2) / 3);
    const el = $('fabric-canvas');
    if (!el) return;

    canvas = new fabric.Canvas('fabric-canvas', {
      width: w,
      height: h,
      backgroundColor: ($('pro-bg-color') && $('pro-bg-color').value) || '#0f172a',
      preserveObjectStacking: true,
    });

    const stroke = ($('pro-stroke-color') && $('pro-stroke-color').value) || '#38bdf8';
    const bw = parseInt(($('pro-brush-width') && $('pro-brush-width').value) || '4', 10);
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.color = stroke;
    canvas.freeDrawingBrush.width = bw;

    canvas.on('selection:created', function () {
      syncTextControls();
      syncPropsFromSelection();
      refreshLayers();
    });
    canvas.on('selection:updated', function () {
      syncTextControls();
      syncPropsFromSelection();
      refreshLayers();
    });
    canvas.on('selection:cleared', function () {
      syncTextControls();
      refreshLayers();
      syncPropsFromSelection();
    });

    canvas.on('text:editing:exited', function () {
      syncTextControls();
    });

    canvas.on('object:modified', function () {
      if (!historySilent) scheduleHistory();
    });
    canvas.on('object:added', function () {
      if (!historySilent) scheduleHistory();
      refreshLayers();
    });
    canvas.on('object:removed', function () {
      if (!historySilent) scheduleHistory();
      refreshLayers();
    });

    canvas.on('path:created', function () {
      refreshLayers();
    });

    canvas.on('object:moving', function (opt) {
      const o = opt.target;
      if (!o || o === bgImageObj) return;
      if ($('pro-snap') && $('pro-snap').checked) {
        const g = 8;
        o.set({
          left: Math.round(o.left / g) * g,
          top: Math.round(o.top / g) * g,
        });
      }
      if ($('pro-snap-center') && $('pro-snap-center').checked) {
        o.setCoords();
        const br = o.getBoundingRect(true);
        const cx = br.left + br.width / 2;
        const cy = br.top + br.height / 2;
        const th = 12;
        const ccx = canvas.width / 2;
        const ccy = canvas.height / 2;
        let dx = 0;
        let dy = 0;
        if (Math.abs(cx - ccx) < th) dx = ccx - cx;
        if (Math.abs(cy - ccy) < th) dy = ccy - cy;
        if (dx !== 0 || dy !== 0) {
          o.set({ left: o.left + dx, top: o.top + dy });
        }
      }
    });

    historyStack = [canvasToHistoryJSON()];
    historyIndex = 0;
    updateUndoRedoButtons();
    refreshLayers();
    populateFontSelect();
    syncCanvasSizeInputs();
    syncGridOverlay();

    window.addEventListener(
      'resize',
      debounce(function () {
        if (!canvas || !$('workspace-pro') || $('workspace-pro').classList.contains('d-none')) return;
        const wrap2 = $('fabric-wrap');
        const nw = Math.min(960, Math.max(520, (wrap2 && wrap2.clientWidth) || 960));
        const nh = Math.round((nw * 2) / 3);
        canvas.setDimensions({ width: nw, height: nh });
        canvas.calcOffset();
        canvas.requestRenderAll();
        syncGridOverlay();
      }, 200)
    );

    document.addEventListener('keydown', function (e) {
      if (!canvas || ($('workspace-pro') && $('workspace-pro').classList.contains('d-none'))) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'y')) {
          /* allow default for inputs if needed */
        } else {
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        copySelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      /* Layer order: Ctrl/Cmd+] forward, Ctrl/Cmd+[ backward; +Shift = to front / to back */
      if ((e.ctrlKey || e.metaKey) && (e.key === ']' || e.key === 'BracketRight')) {
        e.preventDefault();
        applyLayerOrder(e.shiftKey ? 'tofront' : 'forward');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '[' || e.key === 'BracketLeft')) {
        e.preventDefault();
        applyLayerOrder(e.shiftKey ? 'toback' : 'backward');
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const ao = canvas.getActiveObject();
        if (ao && ao.type === 'i-text' && ao.isEditing) return;
        if (!ao || ao === bgImageObj || canvas.isDrawingMode) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        else if (e.key === 'ArrowRight') dx = step;
        else if (e.key === 'ArrowUp') dy = -step;
        else if (e.key === 'ArrowDown') dy = step;
        nudgeSelection(dx, dy);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        const o = canvas.getActiveObject();
        if (o && !canvas.isDrawingMode) {
          if (o === bgImageObj) return;
          if (o.type === 'activeSelection') {
            o.getObjects().forEach(function (x) {
              if (x !== bgImageObj) canvas.remove(x);
            });
          } else {
            canvas.remove(o);
          }
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          scheduleHistory();
        }
      }
    });
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function fabricColorToHex(c) {
    if (c == null || c === '') return '#f1f5f9';
    try {
      if (typeof fabric !== 'undefined' && fabric.Color) {
        return '#' + new fabric.Color(c).toHex();
      }
    } catch (e) {
      /* ignore */
    }
    if (typeof c === 'string' && c[0] === '#') {
      const s = c.trim();
      return s.length >= 7 ? s.slice(0, 7) : s;
    }
    return '#f1f5f9';
  }

  function syncTextControls() {
    const o = canvas && canvas.getActiveObject();
    const isText = o && o.type === 'i-text';
    document.querySelectorAll('.pro-text-style, .pro-text-align').forEach(function (b) {
      b.classList.remove('active');
    });
    if (!isText) return;
    if ($('pro-font-size')) {
      $('pro-font-size').value = Math.round(o.fontSize || 32);
      const el = $('v-pro-fs');
      if (el) el.textContent = String(Math.round(o.fontSize || 32));
    }
    if ($('pro-font') && o.fontFamily) $('pro-font').value = o.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    const tf = $('pro-text-fill');
    if (tf) tf.value = fabricColorToHex(o.fill);
    const ts = $('pro-text-stroke');
    if (ts) ts.value = o.stroke ? fabricColorToHex(o.stroke) : '#000000';
    const tsw = $('pro-text-stroke-w');
    if (tsw) {
      tsw.value = String(o.strokeWidth != null ? o.strokeWidth : 0);
      const vw = $('v-pro-text-stroke-w');
      if (vw) vw.textContent = String(o.strokeWidth != null ? o.strokeWidth : 0);
    }
    const th = $('pro-text-hilite');
    if (th) th.value = o.textBackgroundColor ? fabricColorToHex(o.textBackgroundColor) : '#334155';
    const bBold = $('pro-text-bold');
    if (bBold) bBold.classList.toggle('active', o.fontWeight === 'bold' || o.fontWeight === 700);
    const bIt = $('pro-text-italic');
    if (bIt) bIt.classList.toggle('active', o.fontStyle === 'italic');
    const bUl = $('pro-text-underline');
    if (bUl) bUl.classList.toggle('active', !!o.underline);
    document.querySelectorAll('.pro-text-align').forEach(function (btn) {
      const a = btn.getAttribute('data-align');
      if (a && o.textAlign === a) btn.classList.add('active');
    });
    const bStrike = $('pro-text-strike');
    if (bStrike) bStrike.classList.toggle('active', !!o.linethrough);
    const lhEl = $('pro-text-lineheight');
    const vLh = $('v-pro-text-lh');
    if (lhEl) {
      const lh = o.lineHeight != null ? o.lineHeight : 1.16;
      lhEl.value = String(Math.round(lh * 100) / 100);
      if (vLh) vLh.textContent = String(Math.round(lh * 100) / 100);
    }
    const csEl = $('pro-text-charspacing');
    const vCs = $('v-pro-text-cs');
    if (csEl) {
      const cs = o.charSpacing != null ? o.charSpacing : 0;
      csEl.value = String(Math.round(cs));
      if (vCs) vCs.textContent = String(Math.round(cs));
    }
    const sb = $('pro-text-shadow-blur');
    const vsb = $('v-pro-text-shadow-blur');
    const scol = $('pro-text-shadow-color');
    if (o.shadow) {
      const sh = o.shadow;
      const blur = sh.blur != null ? sh.blur : 0;
      if (sb) sb.value = String(Math.round(blur));
      if (vsb) vsb.textContent = String(Math.round(blur));
      if (scol && sh.color) {
        try {
          scol.value = fabricColorToHex(sh.color);
        } catch (e) {
          /* ignore */
        }
      }
    } else {
      if (sb) sb.value = '0';
      if (vsb) vsb.textContent = '0';
    }
  }

  function addShapeBehindSelectedText() {
    if (!canvas) return;
    const o = canvas.getActiveObject();
    if (!o || o.type !== 'i-text') {
      window.alert('Select a text box on the canvas first.');
      return;
    }
    o.setCoords();
    const br = o.getBoundingRect(true);
    const pad = 14;
    const fill = ($('pro-fill-color') && $('pro-fill-color').value) || '#334155';
    const rect = new fabric.Rect({
      left: br.left - pad,
      top: br.top - pad,
      width: br.width + pad * 2,
      height: br.height + pad * 2,
      fill: fill,
      rx: 12,
      ry: 12,
      stroke: '',
      strokeWidth: 0,
      opacity: 0.95,
    });
    const ti = canvas.getObjects().indexOf(o);
    canvas.add(rect);
    canvas.moveTo(rect, ti);
    ensureBackgroundAtBottom();
    canvas.setActiveObject(o);
    canvas.requestRenderAll();
    scheduleHistory();
    refreshLayers();
  }

  function setDrawMode(on) {
    if (!canvas) return;
    canvas.isDrawingMode = !!on;
    canvas.selection = !on;
    canvas.defaultCursor = on ? 'crosshair' : 'default';
    document.querySelectorAll('.pro-tool').forEach(function (b) {
      b.classList.remove('active');
    });
    if (on && $('pro-draw')) $('pro-draw').classList.add('active');
    else if (!on && $('pro-select')) $('pro-select').classList.add('active');
    canvas.requestRenderAll();
  }

  function strokeFill() {
    const sc = ($('pro-stroke-color') && $('pro-stroke-color').value) || '#38bdf8';
    const fc = ($('pro-fill-color') && $('pro-fill-color').value) || '#1e293b';
    return { stroke: sc, fill: fc };
  }

  function setCanvasZoom(pct) {
    if (!canvas) return;
    const z = Math.max(0.25, Math.min(2, pct / 100));
    canvas.setZoom(z);
    canvas.calcOffset();
    canvas.requestRenderAll();
    const vz = $('v-zoom');
    if (vz) vz.textContent = Math.round(z * 100) + '%';
    syncGridOverlay();
  }

  /** DOM overlay only — never drawn into export; hidden when zoom ≠ 100% (misaligns otherwise). */
  function syncGridOverlay() {
    const ch = $('pro-grid');
    if (!canvas || !canvas.wrapperEl) {
      const ex = $('pro-grid-overlay');
      if (ex) ex.style.display = 'none';
      return;
    }
    let ov = $('pro-grid-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'pro-grid-overlay';
      ov.setAttribute('aria-hidden', 'true');
      ov.style.cssText =
        'pointer-events:none;position:absolute;inset:0;z-index:4;border-radius:2px;';
      ov.style.backgroundImage =
        'linear-gradient(rgba(148,163,184,0.2) 1px, transparent 1px),linear-gradient(90deg, rgba(148,163,184,0.2) 1px, transparent 1px)';
      ov.style.backgroundSize = '24px 24px';
      canvas.wrapperEl.style.position = 'relative';
      canvas.wrapperEl.appendChild(ov);
    }
    if (!ch || !ch.checked) {
      ov.style.display = 'none';
      return;
    }
    const z = canvas.getZoom();
    if (Math.abs(z - 1) > 0.02) {
      ov.style.display = 'none';
      return;
    }
    ov.style.display = 'block';
  }

  function alignObject(mode) {
    if (!canvas) return;
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;
    if (o.type === 'activeSelection') {
      o.setCoords();
    }
    o.setCoords();
    const br = o.getBoundingRect(true);
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = -br.left;
    else if (mode === 'hcenter') dx = (canvas.width - br.width) / 2 - br.left;
    else if (mode === 'right') dx = canvas.width - br.left - br.width;
    else if (mode === 'top') dy = -br.top;
    else if (mode === 'vcenter') dy = (canvas.height - br.height) / 2 - br.top;
    else if (mode === 'bottom') dy = canvas.height - br.top - br.height;
    o.set({ left: o.left + dx, top: o.top + dy });
    o.setCoords();
    canvas.requestRenderAll();
    scheduleHistory();
  }

  function getSelectionTargets() {
    if (!canvas) return [];
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return [];
    if (o.type === 'activeSelection') {
      return o.getObjects().filter(function (x) {
        return x !== bgImageObj;
      });
    }
    return [o];
  }

  function alignSelectionEdges(mode) {
    if (!canvas) return;
    const objs = getSelectionTargets();
    if (objs.length < 2) {
      window.alert('Select at least 2 objects (Shift+click or drag a box on the canvas).');
      return;
    }
    const rects = objs.map(function (obj) {
      obj.setCoords();
      return { obj: obj, br: obj.getBoundingRect(true) };
    });
    const minL = Math.min.apply(
      null,
      rects.map(function (r) {
        return r.br.left;
      })
    );
    const maxR = Math.max.apply(
      null,
      rects.map(function (r) {
        return r.br.left + r.br.width;
      })
    );
    const minT = Math.min.apply(
      null,
      rects.map(function (r) {
        return r.br.top;
      })
    );
    const maxB = Math.max.apply(
      null,
      rects.map(function (r) {
        return r.br.top + r.br.height;
      })
    );
    const midX = (minL + maxR) / 2;
    const midY = (minT + maxB) / 2;

    rects.forEach(function (r) {
      const br = r.br;
      let dx = 0;
      let dy = 0;
      if (mode === 'left') dx = minL - br.left;
      else if (mode === 'right') dx = maxR - br.left - br.width;
      else if (mode === 'hcenter') dx = midX - (br.left + br.width / 2);
      else if (mode === 'top') dy = minT - br.top;
      else if (mode === 'bottom') dy = maxB - br.top - br.height;
      else if (mode === 'vcenter') dy = midY - (br.top + br.height / 2);
      r.obj.set({ left: r.obj.left + dx, top: r.obj.top + dy });
      r.obj.setCoords();
    });

    const act = canvas.getActiveObject();
    if (act && act.type === 'activeSelection') act.setCoords();
    canvas.requestRenderAll();
    scheduleHistory();
    refreshLayers();
  }

  function distributeSelection(axis) {
    if (!canvas) return;
    const objs = getSelectionTargets();
    if (objs.length < 2) {
      window.alert('Select at least 2 objects.');
      return;
    }
    const rects = objs.map(function (obj) {
      obj.setCoords();
      return { obj: obj, br: obj.getBoundingRect(true) };
    });
    const isH = axis === 'h';
    if (isH) {
      rects.sort(function (a, b) {
        return a.br.left - b.br.left;
      });
      const minL = rects[0].br.left;
      const maxR = Math.max.apply(
        null,
        rects.map(function (r) {
          return r.br.left + r.br.width;
        })
      );
      let sumW = 0;
      rects.forEach(function (r) {
        sumW += r.br.width;
      });
      const n = rects.length;
      const gap = (maxR - minL - sumW) / (n - 1);
      let x = minL;
      rects.forEach(function (r) {
        const dx = x - r.br.left;
        r.obj.set({ left: r.obj.left + dx });
        r.obj.setCoords();
        const nbr = r.obj.getBoundingRect(true);
        x = nbr.left + nbr.width + gap;
      });
    } else {
      rects.sort(function (a, b) {
        return a.br.top - b.br.top;
      });
      const minT = rects[0].br.top;
      const maxB = Math.max.apply(
        null,
        rects.map(function (r) {
          return r.br.top + r.br.height;
        })
      );
      let sumH = 0;
      rects.forEach(function (r) {
        sumH += r.br.height;
      });
      const n = rects.length;
      const gap = (maxB - minT - sumH) / (n - 1);
      let y = minT;
      rects.forEach(function (r) {
        const dy = y - r.br.top;
        r.obj.set({ top: r.obj.top + dy });
        r.obj.setCoords();
        const nbr = r.obj.getBoundingRect(true);
        y = nbr.top + nbr.height + gap;
      });
    }

    const act = canvas.getActiveObject();
    if (act && act.type === 'activeSelection') act.setCoords();
    canvas.requestRenderAll();
    scheduleHistory();
    refreshLayers();
  }

  function nudgeSelection(dx, dy) {
    if (!canvas || (dx === 0 && dy === 0)) return;
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj || canvas.isDrawingMode) return;
    if (o.type === 'activeSelection') {
      o.getObjects().forEach(function (x) {
        if (x === bgImageObj) return;
        x.set({ left: (x.left || 0) + dx, top: (x.top || 0) + dy });
        x.setCoords();
      });
      o.setCoords();
    } else {
      o.set({ left: (o.left || 0) + dx, top: (o.top || 0) + dy });
      o.setCoords();
    }
    canvas.requestRenderAll();
    scheduleHistory();
  }

  function groupSelection() {
    if (!canvas) return;
    const act = canvas.getActiveObject();
    if (act && act.type === 'activeSelection' && typeof act.toGroup === 'function') {
      try {
        const g = act.toGroup();
        canvas.setActiveObject(g);
        canvas.requestRenderAll();
        scheduleHistory();
        refreshLayers();
        return;
      } catch (e) {
        /* fallback below */
      }
    }
    const objs = canvas.getActiveObjects().filter(function (x) {
      return x !== bgImageObj;
    });
    if (objs.length < 2) return;
    canvas.discardActiveObject();
    objs.forEach(function (x) {
      canvas.remove(x);
    });
    const group = new fabric.Group(objs, { cornerColor: '#38bdf8' });
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
    scheduleHistory();
    refreshLayers();
  }

  function ungroupSelection() {
    if (!canvas) return;
    const g = canvas.getActiveObject();
    if (!g || g.type !== 'group') return;
    if (typeof g.toActiveSelection === 'function') {
      try {
        g.toActiveSelection();
        canvas.requestRenderAll();
        scheduleHistory();
        refreshLayers();
        return;
      } catch (e) {
        /* fallback */
      }
    }
    try {
      const items = g._objects.slice();
      if (typeof g._restoreObjectsState === 'function') g._restoreObjectsState();
      canvas.remove(g);
      items.forEach(function (obj) {
        canvas.add(obj);
      });
    } catch (e2) {
      console.warn('Ungroup', e2);
    }
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    scheduleHistory();
    refreshLayers();
  }

  function duplicateSelection() {
    if (!canvas) return;
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;
    o.clone(function (cloned) {
      cloned.set({ left: (cloned.left || 0) + 24, top: (cloned.top || 0) + 24 });
      canvas.add(cloned);
      canvas.setActiveObject(cloned);
      canvas.requestRenderAll();
      scheduleHistory();
      refreshLayers();
    });
  }

  function copySelection() {
    if (!canvas) return;
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;
    o.clone(function (cloned) {
      fabricClipboard = cloned;
    });
  }

  function pasteClipboard() {
    if (!canvas || !fabricClipboard) return;
    fabricClipboard.clone(function (cloned) {
      cloned.set({
        left: (cloned.left || 0) + 28,
        top: (cloned.top || 0) + 28,
        evented: true,
        selectable: true,
      });
      canvas.discardActiveObject();
      if (cloned.type === 'activeSelection') {
        cloned.canvas = canvas;
        cloned.forEachObject(function (x) {
          canvas.add(x);
        });
        cloned.setCoords();
        canvas.setActiveObject(cloned);
      } else {
        canvas.add(cloned);
        canvas.setActiveObject(cloned);
      }
      canvas.requestRenderAll();
      scheduleHistory();
      refreshLayers();
    });
  }

  function flipSelection(horizontal) {
    if (!canvas) return;
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;
    if (o.type === 'activeSelection') {
      o.getObjects().forEach(function (x) {
        if (horizontal) x.set('flipX', !x.flipX);
        else x.set('flipY', !x.flipY);
        x.setCoords();
      });
      o.setCoords();
    } else {
      if (horizontal) o.set('flipX', !o.flipX);
      else o.set('flipY', !o.flipY);
      o.setCoords();
    }
    canvas.requestRenderAll();
    scheduleHistory();
  }

  function rotateSelection(deltaDeg) {
    if (!canvas) return;
    const o = canvas.getActiveObject();
    if (!o || o === bgImageObj) return;
    if (o.type === 'activeSelection') {
      o.getObjects().forEach(function (x) {
        x.set('angle', (x.angle || 0) + deltaDeg);
        x.setCoords();
      });
      o.setCoords();
    } else {
      o.set('angle', (o.angle || 0) + deltaDeg);
      o.setCoords();
    }
    canvas.requestRenderAll();
    scheduleHistory();
  }

  function buildTextShadowFromUi() {
    const blur = parseFloat(($('pro-text-shadow-blur') && $('pro-text-shadow-blur').value) || '0');
    const col = ($('pro-text-shadow-color') && $('pro-text-shadow-color').value) || '#000000';
    if (blur <= 0) return null;
    const rgb = hexToRgb(col);
    const off = Math.min(14, Math.max(2, Math.round(blur * 0.4)));
    return new fabric.Shadow({
      color: 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.42)',
      blur: blur,
      offsetX: off,
      offsetY: off,
    });
  }

  function addShape(kind) {
    ensureFabric();
    if (!canvas) return;
    setDrawMode(false);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const { stroke, fill } = strokeFill();
    const sw = 3;
    let obj;

    if (kind === 'rect') {
      obj = new fabric.Rect({
        left: cx - 80,
        top: cy - 50,
        width: 160,
        height: 100,
        fill: fill,
        stroke: stroke,
        strokeWidth: sw,
      });
    } else if (kind === 'rrect') {
      obj = new fabric.Rect({
        left: cx - 90,
        top: cy - 55,
        width: 180,
        height: 110,
        rx: 20,
        ry: 20,
        fill: fill,
        stroke: stroke,
        strokeWidth: sw,
      });
    } else if (kind === 'circle') {
      obj = new fabric.Ellipse({
        left: cx,
        top: cy,
        originX: 'center',
        originY: 'center',
        rx: 70,
        ry: 70,
        fill: fill,
        stroke: stroke,
        strokeWidth: sw,
      });
    } else if (kind === 'tri') {
      obj = new fabric.Triangle({
        left: cx,
        top: cy,
        originX: 'center',
        originY: 'center',
        width: 120,
        height: 104,
        fill: fill,
        stroke: stroke,
        strokeWidth: sw,
      });
    } else if (kind === 'line') {
      obj = new fabric.Line([cx - 120, cy, cx + 120, cy], {
        stroke: stroke,
        strokeWidth: sw + 1,
      });
    } else if (kind === 'star') {
      const pts = starPoints(0, 0, 5, 55, 22);
      obj = new fabric.Polygon(pts, {
        left: cx,
        top: cy,
        originX: 'center',
        originY: 'center',
        fill: fill,
        stroke: stroke,
        strokeWidth: sw,
      });
    } else if (kind === 'pentagon') {
      const pts = regularPolygonPoints(0, 0, 5, 72);
      obj = new fabric.Polygon(pts, {
        left: cx,
        top: cy,
        originX: 'center',
        originY: 'center',
        fill: fill,
        stroke: stroke,
        strokeWidth: sw,
      });
    } else if (kind === 'hexagon') {
      const pts = regularPolygonPoints(0, 0, 6, 72);
      obj = new fabric.Polygon(pts, {
        left: cx,
        top: cy,
        originX: 'center',
        originY: 'center',
        fill: fill,
        stroke: stroke,
        strokeWidth: sw,
      });
    } else if (kind === 'arrow') {
      const x = cx;
      const y = cy;
      const pathStr =
        'M ' +
        (x - 70) +
        ' ' +
        (y - 8) +
        ' L ' +
        (x + 25) +
        ' ' +
        (y - 8) +
        ' L ' +
        (x + 25) +
        ' ' +
        (y - 28) +
        ' L ' +
        (x + 70) +
        ' ' +
        y +
        ' L ' +
        (x + 25) +
        ' ' +
        (y + 28) +
        ' L ' +
        (x + 25) +
        ' ' +
        (y + 8) +
        ' L ' +
        (x - 70) +
        ' ' +
        (y + 8) +
        ' Z';
      obj = new fabric.Path(pathStr, {
        fill: fill,
        stroke: stroke,
        strokeWidth: sw,
        strokeLineJoin: 'round',
      });
    }

    if (obj) {
      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
      scheduleHistory();
      refreshLayers();
    }
  }

  function initModeBar() {
    const classic = $('mode-classic');
    const pro = $('mode-pro');
    const wClassic = $('workspace-classic');
    const wPro = $('workspace-pro');

    function goClassic() {
      if (classic) classic.classList.add('active');
      if (pro) pro.classList.remove('active');
      if (wClassic) wClassic.classList.remove('d-none');
      if (wPro) wPro.classList.add('d-none');
      if (typeof window.__imageStudioSyncClassicView === 'function') {
        window.__imageStudioSyncClassicView();
      }
    }

    function goPro() {
      if (pro) pro.classList.add('active');
      if (classic) classic.classList.remove('active');
      if (wClassic) wClassic.classList.add('d-none');
      if (wPro) wPro.classList.remove('d-none');
      ensureFabric();
      if (canvas) {
        canvas.calcOffset();
        canvas.requestRenderAll();
        refreshLayers();
        syncCanvasSizeInputs();
        syncGridOverlay();
      }
    }

    if (classic) classic.addEventListener('click', goClassic);
    if (pro) pro.addEventListener('click', goPro);

    const btnImp = $('btn-import-to-pro');
    if (btnImp) {
      btnImp.addEventListener('click', function () {
        if (typeof window.__imageStudioGetCroppedBlob !== 'function') {
          alert('Load a photo in Photo mode first.');
          return;
        }
        window.__imageStudioGetCroppedBlob(function (blob) {
          if (!blob) {
            alert('Could not read the current photo. Finish loading or adjust the crop.');
            return;
          }
          goPro();
          ensureFabric();
          const url = URL.createObjectURL(blob);
          fabric.Image.fromURL(url, function (img) {
            img.scaleToWidth(Math.min(canvas.width * 0.88, img.width));
            canvas.centerObject(img);
            canvas.add(img);
            canvas.setActiveObject(img);
            canvas.requestRenderAll();
            scheduleHistory();
            refreshLayers();
            try {
              URL.revokeObjectURL(url);
            } catch (e) {
              /* ignore */
            }
          });
        });
      });
    }
  }

  function initProToolbar() {
    $('pro-undo') &&
      $('pro-undo').addEventListener('click', function () {
        undo();
      });
    $('pro-redo') &&
      $('pro-redo').addEventListener('click', function () {
        redo();
      });

    $('pro-zoom') &&
      $('pro-zoom').addEventListener('input', function (e) {
        setCanvasZoom(parseInt(e.target.value, 10));
      });

    $('pro-zoom-fit') &&
      $('pro-zoom-fit').addEventListener('click', function () {
        if ($('pro-zoom')) $('pro-zoom').value = 100;
        setCanvasZoom(100);
      });

    $('pro-opacity') &&
      $('pro-opacity').addEventListener('input', function (e) {
        if (!canvas) return;
        const o = canvas.getActiveObject();
        if (!o || o === bgImageObj) return;
        const v = parseInt(e.target.value, 10) / 100;
        o.set('opacity', v);
        const vo = $('v-opacity');
        if (vo) vo.textContent = Math.round(v * 100) + '%';
        canvas.requestRenderAll();
      });

    $('pro-opacity') &&
      $('pro-opacity').addEventListener('change', function () {
        scheduleHistory();
      });

    $('pro-blend') &&
      $('pro-blend').addEventListener('change', function (e) {
        if (!canvas) return;
        const o = canvas.getActiveObject();
        if (!o || o === bgImageObj) return;
        o.set('globalCompositeOperation', e.target.value);
        canvas.requestRenderAll();
        scheduleHistory();
      });

    document.querySelectorAll('[data-align]:not(.pro-text-align)').forEach(function (btn) {
      btn.addEventListener('click', function () {
        alignObject(btn.getAttribute('data-align'));
      });
    });

    $('pro-align-center-both') &&
      $('pro-align-center-both').addEventListener('click', function () {
        ensureFabric();
        alignObjectCenterBoth();
      });

    $('pro-group') &&
      $('pro-group').addEventListener('click', function () {
        groupSelection();
      });
    $('pro-ungroup') &&
      $('pro-ungroup').addEventListener('click', function () {
        ungroupSelection();
      });

    $('pro-layer-up') &&
      $('pro-layer-up').addEventListener('click', function () {
        applyLayerOrder('forward');
      });

    $('pro-layer-down') &&
      $('pro-layer-down').addEventListener('click', function () {
        applyLayerOrder('backward');
      });

    $('pro-layer-tofront') &&
      $('pro-layer-tofront').addEventListener('click', function () {
        applyLayerOrder('tofront');
      });

    $('pro-layer-toback') &&
      $('pro-layer-toback').addEventListener('click', function () {
        applyLayerOrder('toback');
      });

    wireImageEffectsUi();

    $('pro-dup') &&
      $('pro-dup').addEventListener('click', function () {
        duplicateSelection();
      });

    $('pro-eyedropper') &&
      $('pro-eyedropper').addEventListener('click', function () {
        if (window.EyeDropper) {
          new window.EyeDropper()
            .open()
            .then(function (res) {
              const hex = res.sRGBHex;
              const inp = $('pro-stroke-color');
              if (inp) inp.value = hex;
              if (canvas && canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = hex;
            })
            .catch(function () {});
        } else {
          alert('EyeDropper needs Chrome/Edge 95+. Use stroke color picker instead.');
        }
      });

    $('pro-copy') &&
      $('pro-copy').addEventListener('click', function () {
        ensureFabric();
        copySelection();
      });
    $('pro-paste') &&
      $('pro-paste').addEventListener('click', function () {
        ensureFabric();
        pasteClipboard();
      });
    $('pro-flip-h') &&
      $('pro-flip-h').addEventListener('click', function () {
        ensureFabric();
        flipSelection(true);
      });
    $('pro-flip-v') &&
      $('pro-flip-v').addEventListener('click', function () {
        ensureFabric();
        flipSelection(false);
      });
    $('pro-rot-ccw') &&
      $('pro-rot-ccw').addEventListener('click', function () {
        ensureFabric();
        rotateSelection(-90);
      });
    $('pro-rot-cw') &&
      $('pro-rot-cw').addEventListener('click', function () {
        ensureFabric();
        rotateSelection(90);
      });
    $('pro-grid') &&
      $('pro-grid').addEventListener('change', function () {
        syncGridOverlay();
      });

    document.querySelectorAll('.pro-sel-align').forEach(function (btn) {
      btn.addEventListener('click', function () {
        ensureFabric();
        alignSelectionEdges(btn.getAttribute('data-salign'));
      });
    });
    document.querySelectorAll('.pro-sel-dist').forEach(function (btn) {
      btn.addEventListener('click', function () {
        ensureFabric();
        distributeSelection(btn.getAttribute('data-dist'));
      });
    });

    $('pro-lock-aspect') &&
      $('pro-lock-aspect').addEventListener('change', function (e) {
        if (!canvas) return;
        const o = canvas.getActiveObject();
        if (!o || o === bgImageObj || o.type === 'activeSelection') return;
        o.set('lockUniScaling', !!e.target.checked);
        canvas.requestRenderAll();
        scheduleHistory();
      });
  }

  function initProUi() {
    initModeBar();
    initProToolbar();

    const debouncedCropHist = debounce(function () {
      scheduleHistory();
    }, 320);
    const debouncedShapeColorHist = debounce(function () {
      scheduleHistory();
    }, 280);
    const debouncedShapeExtraHist = debounce(function () {
      scheduleHistory();
    }, 280);
    ['pro-img-crop-x', 'pro-img-crop-y', 'pro-img-crop-w', 'pro-img-crop-h'].forEach(function (cropId) {
      const el = $(cropId);
      if (!el) return;
      el.addEventListener('input', function () {
        applyImageCropFromUi();
        debouncedCropHist();
      });
    });
    $('pro-img-crop-reset') &&
      $('pro-img-crop-reset').addEventListener('click', function () {
        ensureFabric();
        if (!canvas) return;
        const o = canvas.getActiveObject();
        if (!o || o.type !== 'image' || o === bgImageObj) return;
        const sz = getImageNaturalSize(o);
        o.set({ cropX: 0, cropY: 0, width: sz.nw, height: sz.nh });
        o.dirty = true;
        o.setCoords();
        canvas.requestRenderAll();
        syncImageCropPanel();
        scheduleHistory();
      });

    $('pro-canvas-preset') &&
      $('pro-canvas-preset').addEventListener('change', function (e) {
        const v = e.target.value;
        if (!v) return;
        const parts = v.toLowerCase().split('x');
        if (parts.length === 2) {
          const wi = $('pro-canvas-w');
          const he = $('pro-canvas-h');
          if (wi) wi.value = parts[0].trim();
          if (he) he.value = parts[1].trim();
        }
      });

    $('pro-canvas-apply') &&
      $('pro-canvas-apply').addEventListener('click', function () {
        const wi = parseInt(($('pro-canvas-w') && $('pro-canvas-w').value) || '960', 10);
        const he = parseInt(($('pro-canvas-h') && $('pro-canvas-h').value) || '640', 10);
        if (
          !confirm(
            'Set canvas to ' + wi + ' × ' + he + ' px? Existing objects are not scaled — only the artboard changes.'
          )
        ) {
          return;
        }
        applyCanvasDimensions(wi, he);
      });

    $('pro-shape-command-btn') &&
      $('pro-shape-command-btn').addEventListener('click', function () {
        const cmd = (($('pro-shape-command') && $('pro-shape-command').value) || '').trim();
        if (!cmd) {
          alert('Type what you want (e.g. red star, blue gradient, abstract).');
          return;
        }
        if (!COMMAND_URL) {
          alert('Text-to-shape is not configured.');
          return;
        }
        ensureFabric();
        if (!canvas) return;
        const btn = $('pro-shape-command-btn');
        if (btn) btn.disabled = true;
        fetch(COMMAND_URL, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken(),
          },
          body: JSON.stringify({
            command: cmd,
            width: Math.min(1200, canvas.getWidth()),
            height: Math.min(1200, canvas.getHeight()),
            seed: Math.floor(Math.random() * 1e9),
          }),
        })
          .then(function (r) {
            if (!r.ok) return r.text().then(function (t) {
              throw new Error(t || 'Request failed');
            });
            return r.blob();
          })
          .then(function (blob) {
            const u = URL.createObjectURL(blob);
            fabric.Image.fromURL(u, function (img) {
              const shortCmd = cmd.length > 52 ? cmd.slice(0, 49) + '…' : cmd;
              img.name = 'Text→shape: ' + shortCmd;
              img.scaleToWidth(Math.min(canvas.getWidth() * 0.88, 560));
              canvas.centerObject(img);
              canvas.add(img);
              canvas.setActiveObject(img);
              canvas.requestRenderAll();
              scheduleHistory();
              refreshLayers();
              try {
                URL.revokeObjectURL(u);
              } catch (e) {
                /* ignore */
              }
            });
          })
          .catch(function (err) {
            console.error(err);
            alert(err.message || 'Could not generate.');
          })
          .finally(function () {
            if (btn) btn.disabled = false;
          });
      });

    $('pro-select') &&
      $('pro-select').addEventListener('click', function () {
        setDrawMode(false);
      });
    $('pro-draw') &&
      $('pro-draw').addEventListener('click', function () {
        ensureFabric();
        setDrawMode(true);
      });

    ['pro-rect', 'pro-circle', 'pro-tri', 'pro-line', 'pro-star', 'pro-pentagon', 'pro-hexagon', 'pro-arrow', 'pro-rrect'].forEach(function (id, i) {
      const kinds = ['rect', 'circle', 'tri', 'line', 'star', 'pentagon', 'hexagon', 'arrow', 'rrect'];
      const el = $(id);
      if (el)
        el.addEventListener('click', function () {
          addShape(kinds[i]);
        });
    });

    $('pro-brush-width') &&
      $('pro-brush-width').addEventListener('input', function (e) {
        ensureFabric();
        if (!canvas) return;
        const n = parseInt(e.target.value, 10) || 4;
        canvas.freeDrawingBrush.width = n;
        const vb = $('v-brush');
        if (vb) vb.textContent = String(n);
      });

    $('pro-stroke-color') &&
      $('pro-stroke-color').addEventListener('input', function (e) {
        ensureFabric();
        applyStrokeColorToSelection(e.target.value);
        debouncedShapeColorHist();
      });
    $('pro-stroke-color') &&
      $('pro-stroke-color').addEventListener('change', function () {
        scheduleHistory();
      });

    $('pro-fill-color') &&
      $('pro-fill-color').addEventListener('input', function (e) {
        ensureFabric();
        applyFillColorToSelection(e.target.value);
        debouncedShapeColorHist();
      });
    $('pro-fill-color') &&
      $('pro-fill-color').addEventListener('change', function () {
        scheduleHistory();
      });

    $('pro-shape-stroke-w') &&
      $('pro-shape-stroke-w').addEventListener('input', function (e) {
        ensureFabric();
        const v = $('v-pro-shape-stroke-w');
        if (v) v.textContent = e.target.value;
        applyShapeStrokeWidthToSelection(e.target.value);
        debouncedShapeExtraHist();
      });

    $('pro-shape-corner') &&
      $('pro-shape-corner').addEventListener('input', function (e) {
        ensureFabric();
        const vc = $('v-pro-shape-corner');
        if (vc) vc.textContent = e.target.value;
        applyRectCornerToSelection(e.target.value);
        debouncedShapeExtraHist();
      });

    $('pro-obj-shadow-blur') &&
      $('pro-obj-shadow-blur').addEventListener('input', function (e) {
        ensureFabric();
        const vb = $('v-pro-obj-shadow-blur');
        if (vb) vb.textContent = e.target.value;
        applyObjectShadowFromUi();
        debouncedShapeExtraHist();
      });
    $('pro-obj-shadow-color') &&
      $('pro-obj-shadow-color').addEventListener('input', function () {
        ensureFabric();
        applyObjectShadowFromUi();
        debouncedShapeExtraHist();
      });

    $('pro-bg-color') &&
      $('pro-bg-color').addEventListener('input', function (e) {
        ensureFabric();
        if (!canvas) return;
        canvas.setBackgroundColor(e.target.value, function () {
          canvas.requestRenderAll();
        });
        scheduleHistory();
      });

    $('pro-bg-image') &&
      $('pro-bg-image').addEventListener('change', function (e) {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        ensureFabric();
        if (!canvas) return;
        const url = URL.createObjectURL(f);
        fabric.Image.fromURL(url, function (img) {
          if (bgImageObj) {
            canvas.remove(bgImageObj);
            bgImageObj = null;
          }
          const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
          img.set({
            scaleX: scale,
            scaleY: scale,
            left: canvas.width / 2,
            top: canvas.height / 2,
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false,
            isBgImage: true,
          });
          bgImageObj = img;
          canvas.add(img);
          canvas.sendToBack(img);
          canvas.requestRenderAll();
          try {
            URL.revokeObjectURL(url);
          } catch (err) {
            /* ignore */
          }
          scheduleHistory();
          refreshLayers();
        });
      });

    $('pro-bg-clear') &&
      $('pro-bg-clear').addEventListener('click', function () {
        if (!canvas) return;
        if (bgImageObj) {
          canvas.remove(bgImageObj);
          bgImageObj = null;
        }
        canvas.requestRenderAll();
        scheduleHistory();
        refreshLayers();
      });

    $('pro-add-text') &&
      $('pro-add-text').addEventListener('click', function () {
        ensureFabric();
        if (!canvas) return;
        setDrawMode(false);
        const font = ($('pro-font') && $('pro-font').value) || 'Inter';
        ensureFontLoaded(font);
        const fs = parseInt(($('pro-font-size') && $('pro-font-size').value) || '32', 10);
        const fillHex = ($('pro-text-fill') && $('pro-text-fill').value) || '#f1f5f9';
        const rgb = hexToRgb(fillHex);
        const strokeHex = ($('pro-text-stroke') && $('pro-text-stroke').value) || '#000000';
        const sRgb = hexToRgb(strokeHex);
        const sw = parseFloat(($('pro-text-stroke-w') && $('pro-text-stroke-w').value) || '0');
        const lh = parseFloat(($('pro-text-lineheight') && $('pro-text-lineheight').value) || '1.2');
        const cs = parseInt(($('pro-text-charspacing') && $('pro-text-charspacing').value) || '0', 10) || 0;
        const t = new fabric.IText('Edit this text', {
          left: canvas.width / 2 - 120,
          top: canvas.height / 2 - 20,
          fontFamily: font + ', sans-serif',
          fill: 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')',
          fontSize: fs,
          stroke: sw > 0 ? 'rgb(' + sRgb.r + ',' + sRgb.g + ',' + sRgb.b + ')' : '',
          strokeWidth: sw > 0 ? sw : 0,
          textBackgroundColor: '',
          lineHeight: lh,
          charSpacing: cs,
        });
        const shNew = buildTextShadowFromUi();
        if (shNew) t.set('shadow', shNew);
        canvas.add(t);
        canvas.setActiveObject(t);
        canvas.requestRenderAll();
        scheduleHistory();
        refreshLayers();
      });

    $('pro-font') &&
      $('pro-font').addEventListener('change', function () {
        const fam = $('pro-font').value || 'Inter';
        ensureFontLoaded(fam);
        const o = canvas && canvas.getActiveObject();
        if (o && o.type === 'i-text') {
          o.set('fontFamily', fam + ', sans-serif');
          canvas.requestRenderAll();
          scheduleHistory();
        }
      });

    $('pro-font-size') &&
      $('pro-font-size').addEventListener('input', function (e) {
        const n = parseInt(e.target.value, 10) || 32;
        const el = $('v-pro-fs');
        if (el) el.textContent = String(n);
        const o = canvas && canvas.getActiveObject();
        if (o && o.type === 'i-text') {
          o.set('fontSize', n);
          canvas.requestRenderAll();
        }
      });
    $('pro-font-size') &&
      $('pro-font-size').addEventListener('change', function () {
        const o = canvas && canvas.getActiveObject();
        if (o && o.type === 'i-text') scheduleHistory();
      });

    const debouncedTextHistory = debounce(function () {
      scheduleHistory();
    }, 380);

    function applyToActiveIText(fn) {
      const o = canvas && canvas.getActiveObject();
      if (!o || o.type !== 'i-text') return;
      fn(o);
      canvas.requestRenderAll();
      debouncedTextHistory();
    }

    $('pro-text-fill') &&
      $('pro-text-fill').addEventListener('input', function (e) {
        applyToActiveIText(function (o) {
          o.set('fill', e.target.value);
        });
      });
    $('pro-text-stroke') &&
      $('pro-text-stroke').addEventListener('input', function (e) {
        applyToActiveIText(function (o) {
          const w = parseFloat(($('pro-text-stroke-w') && $('pro-text-stroke-w').value) || '0');
          o.set({ stroke: w > 0 ? e.target.value : '', strokeWidth: w > 0 ? w : 0 });
        });
      });
    $('pro-text-stroke-w') &&
      $('pro-text-stroke-w').addEventListener('input', function (e) {
        const w = parseFloat(e.target.value) || 0;
        const vw = $('v-pro-text-stroke-w');
        if (vw) vw.textContent = String(w);
        applyToActiveIText(function (o) {
          const col = ($('pro-text-stroke') && $('pro-text-stroke').value) || '#000000';
          o.set({ stroke: w > 0 ? col : '', strokeWidth: w > 0 ? w : 0 });
        });
      });
    $('pro-text-stroke-w') &&
      $('pro-text-stroke-w').addEventListener('change', function () {
        const o = canvas && canvas.getActiveObject();
        if (o && o.type === 'i-text') scheduleHistory();
      });

    $('pro-text-hilite') &&
      $('pro-text-hilite').addEventListener('input', function (e) {
        applyToActiveIText(function (o) {
          o.set('textBackgroundColor', e.target.value);
        });
      });
    $('pro-text-hilite-clear') &&
      $('pro-text-hilite-clear').addEventListener('click', function () {
        const o = canvas && canvas.getActiveObject();
        if (!o || o.type !== 'i-text') return;
        o.set('textBackgroundColor', '');
        canvas.requestRenderAll();
        scheduleHistory();
        syncTextControls();
      });

    $('pro-text-lineheight') &&
      $('pro-text-lineheight').addEventListener('input', function (e) {
        const n = parseFloat(e.target.value) || 1.2;
        const vLh = $('v-pro-text-lh');
        if (vLh) vLh.textContent = String(n);
        applyToActiveIText(function (o) {
          o.set('lineHeight', n);
        });
      });
    $('pro-text-lineheight') &&
      $('pro-text-lineheight').addEventListener('change', function () {
        const o = canvas && canvas.getActiveObject();
        if (o && o.type === 'i-text') scheduleHistory();
      });

    $('pro-text-charspacing') &&
      $('pro-text-charspacing').addEventListener('input', function (e) {
        const n = parseInt(e.target.value, 10) || 0;
        const vCs = $('v-pro-text-cs');
        if (vCs) vCs.textContent = String(n);
        applyToActiveIText(function (o) {
          o.set('charSpacing', n);
        });
      });
    $('pro-text-charspacing') &&
      $('pro-text-charspacing').addEventListener('change', function () {
        const o = canvas && canvas.getActiveObject();
        if (o && o.type === 'i-text') scheduleHistory();
      });

    $('pro-text-shadow-color') &&
      $('pro-text-shadow-color').addEventListener('input', function () {
        applyToActiveIText(function (o) {
          o.set('shadow', buildTextShadowFromUi());
        });
      });
    $('pro-text-shadow-blur') &&
      $('pro-text-shadow-blur').addEventListener('input', function (e) {
        const n = parseInt(e.target.value, 10) || 0;
        const vsb = $('v-pro-text-shadow-blur');
        if (vsb) vsb.textContent = String(n);
        applyToActiveIText(function (o) {
          o.set('shadow', buildTextShadowFromUi());
        });
      });
    $('pro-text-shadow-blur') &&
      $('pro-text-shadow-blur').addEventListener('change', function () {
        const o = canvas && canvas.getActiveObject();
        if (o && o.type === 'i-text') scheduleHistory();
      });

    document.querySelectorAll('.pro-text-style').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const o = canvas && canvas.getActiveObject();
        if (!o || o.type !== 'i-text') return;
        const st = btn.getAttribute('data-style');
        if (st === 'bold') {
          const on = o.fontWeight === 'bold' || o.fontWeight === 700;
          o.set('fontWeight', on ? 'normal' : 'bold');
        } else if (st === 'italic') {
          o.set('fontStyle', o.fontStyle === 'italic' ? 'normal' : 'italic');
        } else if (st === 'underline') {
          o.set('underline', !o.underline);
        } else if (st === 'linethrough') {
          o.set('linethrough', !o.linethrough);
        }
        canvas.requestRenderAll();
        scheduleHistory();
        syncTextControls();
      });
    });

    document.querySelectorAll('.pro-text-align').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const o = canvas && canvas.getActiveObject();
        if (!o || o.type !== 'i-text') return;
        const a = btn.getAttribute('data-align');
        if (a) o.set('textAlign', a);
        canvas.requestRenderAll();
        scheduleHistory();
        syncTextControls();
      });
    });

    $('pro-text-shape-behind') &&
      $('pro-text-shape-behind').addEventListener('click', function () {
        ensureFabric();
        addShapeBehindSelectedText();
      });

    $('pro-import-img') &&
      $('pro-import-img').addEventListener('change', function (e) {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        ensureFabric();
        const url = URL.createObjectURL(f);
        fabric.Image.fromURL(url, function (img) {
          img.scaleToWidth(Math.min(400, canvas.width * 0.6));
          canvas.centerObject(img);
          canvas.add(img);
          canvas.setActiveObject(img);
          canvas.requestRenderAll();
          try {
            URL.revokeObjectURL(url);
          } catch (err) {
            /* ignore */
          }
          scheduleHistory();
          refreshLayers();
        });
      });

    $('pro-import-svg') &&
      $('pro-import-svg').addEventListener('change', function (e) {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        ensureFabric();
        if (!canvas || typeof fabric.loadSVGFromURL !== 'function') {
          window.alert('SVG import needs Fabric.js.');
          return;
        }
        const url = URL.createObjectURL(f);
        fabric.loadSVGFromURL(url, function (objects, options) {
          try {
            URL.revokeObjectURL(url);
          } catch (err) {
            /* ignore */
          }
          if (!objects || !objects.length) {
            window.alert('Could not parse this SVG.');
            return;
          }
          var item =
            objects.length > 1 ? fabric.util.groupSVGElements(objects, options || {}) : objects[0];
          if (item.scaleToWidth) {
            item.scaleToWidth(Math.min(420, canvas.getWidth() * 0.65));
          }
          canvas.centerObject(item);
          canvas.add(item);
          canvas.setActiveObject(item);
          canvas.requestRenderAll();
          scheduleHistory();
          refreshLayers();
        });
      });

    $('pro-magic-btn') &&
      $('pro-magic-btn').addEventListener('click', function () {
        if (!MAGIC_URL) {
          alert('Magic shape API URL is not configured.');
          return;
        }
        ensureFabric();
        if (!canvas) return;
        const style = ($('pro-magic-style') && $('pro-magic-style').value) || 'organic';
        const btn = $('pro-magic-btn');
        if (btn) btn.disabled = true;
        fetch(MAGIC_URL, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken(),
          },
          body: JSON.stringify({
            width: 640,
            height: 640,
            style: style,
            seed: Math.floor(Math.random() * 1e9),
          }),
        })
          .then(function (r) {
            if (!r.ok) return r.text().then(function (t) {
              throw new Error(t || 'Server error');
            });
            return r.blob();
          })
          .then(function (blob) {
            const u = URL.createObjectURL(blob);
            fabric.Image.fromURL(u, function (img) {
              img.scaleToWidth(Math.min(380, canvas.width * 0.45));
              canvas.centerObject(img);
              canvas.add(img);
              canvas.setActiveObject(img);
              canvas.requestRenderAll();
              try {
                URL.revokeObjectURL(u);
              } catch (e) {
                /* ignore */
              }
              scheduleHistory();
              refreshLayers();
            });
          })
          .catch(function (err) {
            console.error(err);
            alert(err.message || 'Magic shape failed.');
          })
          .finally(function () {
            if (btn) btn.disabled = false;
          });
      });

    $('pro-delete') &&
      $('pro-delete').addEventListener('click', function () {
        if (!canvas) return;
        const o = canvas.getActiveObject();
        if (o) {
          if (o === bgImageObj) bgImageObj = null;
          if (o.type === 'activeSelection') {
            o.getObjects().forEach(function (x) {
              if (x !== bgImageObj) canvas.remove(x);
            });
            canvas.discardActiveObject();
          } else {
            canvas.remove(o);
            canvas.discardActiveObject();
          }
          canvas.requestRenderAll();
          scheduleHistory();
          refreshLayers();
        }
      });

    $('pro-clear') &&
      $('pro-clear').addEventListener('click', function () {
        if (!canvas) return;
        if (!confirm('Remove all objects from the Pro canvas?')) return;
        historySilent = true;
        canvas.clear();
        bgImageObj = null;
        const bc = ($('pro-bg-color') && $('pro-bg-color').value) || '#0f172a';
        canvas.setBackgroundColor(bc, function () {
          canvas.requestRenderAll();
          historySilent = false;
          historyStack = [canvasToHistoryJSON()];
          historyIndex = 0;
          updateUndoRedoButtons();
          refreshLayers();
        });
      });

    $('pro-export-quality') &&
      $('pro-export-quality').addEventListener('input', function (e) {
        const el = $('v-pro-qual');
        if (el) el.textContent = Math.round(parseFloat(e.target.value) * 100) + '%';
      });

    $('pro-export-btn') &&
      $('pro-export-btn').addEventListener('click', function () {
        ensureFabric();
        if (!canvas) return;
        const fmt = ($('pro-export-format') && $('pro-export-format').value) || 'image/png';
        const q = parseFloat(($('pro-export-quality') && $('pro-export-quality').value) || '0.92');

        if (fmt === 'application/pdf') {
          if (!window.jspdf || !window.jspdf.jsPDF) {
            alert('PDF library did not load. Refresh the page.');
            return;
          }
          const { jsPDF } = window.jspdf;
          const w = canvas.getWidth();
          const h = canvas.getHeight();
          const pdf = new jsPDF({
            orientation: w >= h ? 'l' : 'p',
            unit: 'px',
            format: [w, h],
            hotfixes: ['px_scaling'],
          });
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h, undefined, 'FAST');
          pdf.save('studio-design.pdf');
          return;
        }

        if (fmt === 'image/gif') {
          if (!GIF_URL) {
            alert('GIF export is not available.');
            return;
          }
          canvas.toBlob(function (blob) {
            if (!blob) return;
            fetch(GIF_URL, {
              method: 'POST',
              body: blob,
              credentials: 'same-origin',
              headers: { 'X-CSRFToken': csrfToken() },
            })
              .then(function (r) {
                if (!r.ok) throw new Error('GIF conversion failed');
                return r.blob();
              })
              .then(function (gifBlob) {
                downloadBlob(gifBlob, 'studio-design.gif');
              })
              .catch(function (e) {
                alert(e.message || 'GIF export failed.');
              });
          }, 'image/png');
          return;
        }

        if (fmt === 'image/bmp') {
          var bmpUrl;
          try {
            bmpUrl = canvas.toDataURL('image/bmp');
          } catch (e1) {
            bmpUrl = '';
          }
          if (!bmpUrl || bmpUrl.indexOf('image/bmp') === -1) {
            alert('BMP is not supported in this browser. Choose PNG or JPEG.');
            return;
          }
          var a = document.createElement('a');
          a.href = bmpUrl;
          a.download = 'studio-design.bmp';
          a.click();
          return;
        }

        var f = 'png';
        var ext = 'png';
        if (fmt.indexOf('jpeg') >= 0) {
          f = 'jpeg';
          ext = 'jpg';
        } else if (fmt.indexOf('webp') >= 0) {
          f = 'webp';
          ext = 'webp';
        }
        var opts = { format: f, multiplier: 1 };
        if (f !== 'png') opts.quality = q;
        var dataUrl = canvas.toDataURL(opts);
        var a2 = document.createElement('a');
        a2.href = dataUrl;
        a2.download = 'studio-design.' + ext;
        document.body.appendChild(a2);
        a2.click();
        document.body.removeChild(a2);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProUi);
  } else {
    initProUi();
  }
})();
