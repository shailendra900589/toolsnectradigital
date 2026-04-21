/**
 * Image Studio — multi-tab editing, crop, filters, auto-enhance, Magic BG, export.
 * Requires: Cropper.js v1.5.x, window.__IMAGE_STUDIO__.removeBgUrl
 */
(function () {
  'use strict';

  const CFG = window.__IMAGE_STUDIO__ || {};
  const REMOVE_BG_URL = CFG.removeBgUrl || '';

  let cropper = null;
  let cropperReadyTimer = null;
  let pendingBlobUrl = null;
  let dimLabelTimer = null;

  /** @type {{ id: number, name: string, originalFile: File | null, blob: Blob | null }[]} */
  let imageSlots = [];
  let activeSlotIndex = 0;
  let slotIdSeq = 0;

  const filters = {
    bright: 100,
    cont: 100,
    sat: 100,
    gray: 0,
    sepia: 0,
    blur: 0,
    hue: 0,
    invert: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function getActiveSlot() {
    return imageSlots[activeSlotIndex] || null;
  }

  function notifyPhotoRequired() {
    alert(
      'Upload a photo first — use Open or Add in the toolbar, or Upload in the left panel or center of the canvas.'
    );
  }

  function getExportBasename() {
    const s = getActiveSlot();
    if (!s || !s.name) return 'image';
    return String(s.name).replace(/\.[^/.]+$/, '') || 'image';
  }

  function getFilterString() {
    return (
      'brightness(' +
      filters.bright +
      '%) contrast(' +
      filters.cont +
      '%) saturate(' +
      filters.sat +
      '%) grayscale(' +
      filters.gray +
      '%) sepia(' +
      filters.sepia +
      '%) blur(' +
      filters.blur +
      'px) hue-rotate(' +
      filters.hue +
      'deg) invert(' +
      filters.invert +
      '%)'
    );
  }

  function applyFiltersVisual() {
    const f = getFilterString();
    const wrap = $('img-container');
    if (!wrap) return;
    wrap.querySelectorAll('img').forEach(function (img) {
      img.style.filter = f;
    });
  }

  function updateFilterLabels() {
    const map = [
      ['v-bright', filters.bright + '%'],
      ['v-cont', filters.cont + '%'],
      ['v-sat', filters.sat + '%'],
      ['v-gray', filters.gray + '%'],
      ['v-sepia', filters.sepia + '%'],
      ['v-blur', filters.blur + 'px'],
      ['v-hue', filters.hue + '°'],
      ['v-invert', filters.invert + '%'],
    ];
    map.forEach(function (pair) {
      const el = $(pair[0]);
      if (el) el.textContent = pair[1];
    });
  }

  function updateFilters() {
    applyFiltersVisual();
    updateFilterLabels();
  }

  function resetFiltersUi() {
    filters.bright = 100;
    filters.cont = 100;
    filters.sat = 100;
    filters.gray = 0;
    filters.sepia = 0;
    filters.blur = 0;
    filters.hue = 0;
    filters.invert = 0;
    const fb = $('f-bright');
    if (fb) fb.value = 100;
    const fc = $('f-cont');
    if (fc) fc.value = 100;
    const fs = $('f-sat');
    if (fs) fs.value = 100;
    const fg = $('f-gray');
    if (fg) fg.value = 0;
    const fsep = $('f-sepia');
    if (fsep) fsep.value = 0;
    const fbl = $('f-blur');
    if (fbl) fbl.value = 0;
    const fh = $('f-hue');
    if (fh) fh.value = 0;
    const fi = $('f-invert');
    if (fi) fi.value = 0;
    updateFilters();
  }

  const loader = $('app-loader');
  const loaderLabel = loader ? loader.querySelector('div:last-child') : null;

  function hideLoader() {
    if (loader) loader.classList.add('d-none');
    if (loaderLabel) loaderLabel.textContent = 'PROCESSING...';
  }

  function showLoader(text) {
    if (loaderLabel) loaderLabel.textContent = text || 'PROCESSING...';
    if (loader) loader.classList.remove('d-none');
  }

  function csrfToken() {
    const m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }

  function updateDimensionLabel() {
    const el = $('lbl-dims');
    if (!el) return;
    if (!cropper || !cropper.ready) {
      el.textContent = '- x -';
      return;
    }
    try {
      if (!cropper.cropped) {
        cropper.crop();
      }
      const canvas = cropper.getCroppedCanvas({ maxWidth: 8192, maxHeight: 8192 });
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        el.textContent = canvas.width + ' × ' + canvas.height;
        return;
      }
    } catch (e) {
      /* ignore */
    }
    el.textContent = '- x -';
  }

  function scheduleDimensionLabel() {
    if (dimLabelTimer) clearTimeout(dimLabelTimer);
    dimLabelTimer = setTimeout(function () {
      dimLabelTimer = null;
      updateDimensionLabel();
    }, 120);
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error(label || 'Timed out.'));
        }, ms);
      }),
    ]);
  }

  function parseServerError(res) {
    return res.text().then(function (text) {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('application/json') !== -1) {
        try {
          const j = JSON.parse(text);
          if (j && j.error) return String(j.error);
        } catch (e) {
          /* ignore */
        }
      }
      return (text && text.trim().slice(0, 300)) || 'Request failed (' + res.status + ').';
    });
  }

  function safeDestroyCropper() {
    if (!cropper) return;
    try {
      cropper.destroy();
    } catch (e) {
      /* ignore */
    }
    cropper = null;
  }

  function ensureCroppedCanvas(maxW, maxH) {
    if (!cropper || !cropper.ready) {
      return null;
    }
    if (!cropper.cropped) {
      cropper.crop();
    }
    return cropper.getCroppedCanvas({
      maxWidth: maxW,
      maxHeight: maxH,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });
  }

  /** Rasterize current crop + adjustment sliders into a canvas (used for tab commit & auto-enhance). */
  function getFilteredRasterCanvas(maxEdge) {
    const cropped = ensureCroppedCanvas(maxEdge, maxEdge);
    if (!cropped) return null;
    const out = document.createElement('canvas');
    out.width = cropped.width;
    out.height = cropped.height;
    const ctx = out.getContext('2d');
    ctx.filter = getFilterString();
    ctx.drawImage(cropped, 0, 0);
    return out;
  }

  function commitActiveSlot(done) {
    if (!imageSlots.length || activeSlotIndex < 0) {
      if (done) done();
      return;
    }
    if (!cropper || !cropper.ready) {
      if (done) done();
      return;
    }
    const canvas = getFilteredRasterCanvas(8192);
    if (!canvas) {
      if (done) done();
      return;
    }
    canvas.toBlob(function (blob) {
      if (blob && imageSlots[activeSlotIndex]) {
        imageSlots[activeSlotIndex].blob = blob;
      }
      if (done) done();
    }, 'image/png');
  }

  function srgbChannelToLinear(u) {
    if (u <= 0.04045) return u / 12.92;
    return Math.pow((u + 0.055) / 1.055, 2.4);
  }

  function linearChannelToSrgb(u) {
    if (u <= 0.0031308) return 12.92 * u;
    return 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
  }

  /**
   * Portrait-friendly auto enhance: tone curve in linear light (perceptual),
   * luminance-only scaling (hue stable), soft shadows/highlights, mild chroma polish,
   * optional subtle clarity (skipped on huge images to stay fast).
   */
  function autoEnhanceCanvasPixels(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    if (w < 1 || h < 1) return;
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const totalPx = w * h;
    const bins = new Uint32Array(256);
    let stride = 1;
    if (totalPx > 900000) stride = 2;
    if (totalPx > 3600000) stride = 4;
    let i;
    let x;
    let y;
    for (y = 0; y < h; y += stride) {
      const row = y * w * 4;
      for (x = 0; x < w; x += stride) {
        i = row + x * 4;
        const r = srgbChannelToLinear(d[i] / 255);
        const g = srgbChannelToLinear(d[i + 1] / 255);
        const b = srgbChannelToLinear(d[i + 2] / 255);
        const yl = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const yi = Math.min(255, Math.max(0, Math.round(Math.min(1, yl) * 255)));
        bins[yi] += 1;
      }
    }
    const sampled = Math.max(1, Math.ceil((h / stride) * (w / stride)));
    let cum = 0;
    let low = 0;
    for (i = 0; i < 256; i++) {
      cum += bins[i];
      if (cum >= sampled * 0.015) {
        low = i;
        break;
      }
    }
    cum = 0;
    let high = 255;
    for (i = 0; i < 256; i++) {
      cum += bins[i];
      if (cum >= sampled * 0.985) {
        high = i;
        break;
      }
    }
    if (high <= low + 6) {
      high = Math.min(255, low + 6);
    }
    const yLow = low / 255;
    const yHigh = high / 255;
    let range = yHigh - yLow;
    if (range < 0.045) {
      range = 0.045;
    }
    const outMinLin = srgbChannelToLinear(0.042);
    const outMaxLin = srgbChannelToLinear(0.945);
    const midBlend = 0.16;

    function mapLinearLuma(Y) {
      if (Y <= 0) return 0;
      if (Y < yLow) {
        const t = yLow > 1e-6 ? Y / yLow : 0;
        return outMinLin * Math.pow(Math.min(1, t), 0.62);
      }
      if (Y > yHigh) {
        const span = 1 - yHigh;
        const u = span > 1e-6 ? (Y - yHigh) / span : 0;
        const uh = Math.min(1, Math.max(0, u));
        return outMaxLin + (1 - outMaxLin) * (1 - Math.pow(1 - uh, 1.35));
      }
      let t = (Y - yLow) / range;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const smooth = t * t * (3 - 2 * t);
      t = t * (1 - midBlend) + smooth * midBlend;
      return outMinLin + t * (outMaxLin - outMinLin);
    }

    const desatK = 0.035;

    for (i = 0; i < d.length; i += 4) {
      let r = srgbChannelToLinear(d[i] / 255);
      let g = srgbChannelToLinear(d[i + 1] / 255);
      let b = srgbChannelToLinear(d[i + 2] / 255);
      const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const Y2 = mapLinearLuma(Y);
      if (Y < 1e-8) {
        r = outMinLin;
        g = outMinLin;
        b = outMinLin;
      } else {
        let f = Y2 / Y;
        if (f > 2.35) f = 2.35;
        if (f < 0.42) f = 0.42;
        r *= f;
        g *= f;
        b *= f;
      }
      let mx = r > g ? (r > b ? r : b) : g > b ? g : b;
      if (mx > 1) {
        r /= mx;
        g /= mx;
        b /= mx;
      }
      const Yd = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = r * (1 - desatK) + Yd * desatK;
      g = g * (1 - desatK) + Yd * desatK;
      b = b * (1 - desatK) + Yd * desatK;
      mx = r > g ? (r > b ? r : b) : g > b ? g : b;
      if (mx > 1) {
        r /= mx;
        g /= mx;
        b /= mx;
      }
      d[i] = Math.min(255, Math.max(0, Math.round(linearChannelToSrgb(r) * 255)));
      d[i + 1] = Math.min(255, Math.max(0, Math.round(linearChannelToSrgb(g) * 255)));
      d[i + 2] = Math.min(255, Math.max(0, Math.round(linearChannelToSrgb(b) * 255)));
    }

    if (totalPx < 6000000 && w > 4 && h > 4) {
      const src = new Uint8ClampedArray(d.length);
      src.set(d);
      const amount = 0.065;
      const w4 = w * 4;
      for (y = 1; y < h - 1; y++) {
        const row = y * w4;
        for (x = 1; x < w - 1; x++) {
          i = row + x * 4;
          for (let c = 0; c < 3; c++) {
            const center = src[i + c];
            const blur =
              (src[i - 4 + c] + src[i + 4 + c] + src[i - w4 + c] + src[i + w4 + c]) * 0.25;
            let v = center + amount * (center - blur);
            if (v < 0) v = 0;
            else if (v > 255) v = 255;
            d[i + c] = Math.round(v);
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  let tabThumbUrls = [];

  function revokeTabThumbs() {
    tabThumbUrls.forEach(function (u) {
      try {
        URL.revokeObjectURL(u);
      } catch (e) {
        /* ignore */
      }
    });
    tabThumbUrls = [];
  }

  function renderDocTabs() {
    const host = $('doc-tabs');
    if (!host) return;
    revokeTabThumbs();
    host.innerHTML = '';
    imageSlots.forEach(function (slot, idx) {
      const tab = document.createElement('div');
      tab.className = 'doc-tab' + (idx === activeSlotIndex ? ' active' : '');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', idx === activeSlotIndex ? 'true' : 'false');

      const thumbSrc = slot.blob
        ? URL.createObjectURL(slot.blob)
        : slot.originalFile
          ? URL.createObjectURL(slot.originalFile)
          : '';
      if (thumbSrc) tabThumbUrls.push(thumbSrc);

      const img = document.createElement('img');
      img.className = 'doc-tab-thumb';
      img.src = thumbSrc;
      img.alt = '';

      const name = document.createElement('span');
      name.className = 'doc-tab-name';
      name.textContent = slot.name || 'Image ' + (idx + 1);
      name.title = slot.name || '';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'doc-tab-close';
      closeBtn.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
      closeBtn.title = 'Close';
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeSlotAt(idx);
      });

      tab.appendChild(img);
      tab.appendChild(name);
      if (imageSlots.length > 1) tab.appendChild(closeBtn);

      tab.addEventListener('click', function () {
        if (idx !== activeSlotIndex) switchToSlot(idx);
      });

      host.appendChild(tab);
    });
  }

  function showPhotoPlaceholder(visible) {
    const ph = $('photo-placeholder');
    const ic = $('img-container');
    if (ph) ph.classList.toggle('d-none', !visible);
    if (ic) ic.classList.toggle('d-none', visible);
  }

  /** Keeps the empty-state overlay in sync with real editor state (tabs + Cropper). */
  function syncPhotoWorkspaceVisibility() {
    if (!imageSlots.length) {
      showPhotoPlaceholder(true);
      return;
    }
    if (cropper && cropper.ready) {
      showPhotoPlaceholder(false);
    }
  }

  function showEmptyWorkspace() {
    const emptyState = $('empty-state');
    const workspace = $('workspace-shell');
    if (emptyState) emptyState.classList.add('d-none');
    if (workspace) workspace.classList.remove('d-none');
    const mainImage = $('main-image');
    if (mainImage) {
      mainImage.removeAttribute('src');
      mainImage.alt = 'Workspace Image';
    }
    safeDestroyCropper();
    imageSlots = [];
    activeSlotIndex = 0;
    revokeTabThumbs();
    const host = $('doc-tabs');
    if (host) host.innerHTML = '';
    showPhotoPlaceholder(true);
  }

  function closeSlotAt(index) {
    if (index < 0 || index >= imageSlots.length) return;
    if (imageSlots.length <= 1) {
      showEmptyWorkspace();
      return;
    }
    if (index === activeSlotIndex) {
      commitActiveSlot(function () {
        imageSlots.splice(index, 1);
        if (activeSlotIndex >= imageSlots.length) activeSlotIndex = imageSlots.length - 1;
        loadActiveSlotImageFromState();
      });
    } else {
      imageSlots.splice(index, 1);
      if (activeSlotIndex > index) activeSlotIndex -= 1;
      renderDocTabs();
    }
  }

  function switchToSlot(newIdx) {
    if (newIdx === activeSlotIndex || newIdx < 0 || newIdx >= imageSlots.length) return;
    commitActiveSlot(function () {
      activeSlotIndex = newIdx;
      loadActiveSlotImageFromState();
    });
  }

  function loadActiveSlotImageFromState() {
    const slot = getActiveSlot();
    if (!slot) return;
    var src = null;
    if (slot.blob) src = URL.createObjectURL(slot.blob);
    else if (slot.originalFile) src = URL.createObjectURL(slot.originalFile);
    if (!src) return;
    startCropperLoad(src, function () {
      renderDocTabs();
    });
  }

  function startCropperLoad(objectUrl, afterReady) {
    if (cropperReadyTimer) {
      clearTimeout(cropperReadyTimer);
      cropperReadyTimer = null;
    }
    if (pendingBlobUrl && pendingBlobUrl !== objectUrl) {
      try {
        URL.revokeObjectURL(pendingBlobUrl);
      } catch (e) {
        /* ignore */
      }
    }
    pendingBlobUrl = objectUrl;

    showLoader('Loading image…');
    const mainImage = $('main-image');
    if (!mainImage) return;

    showPhotoPlaceholder(false);

    mainImage.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      pendingBlobUrl = null;
      hideLoader();
      showPhotoPlaceholder(true);
      alert('This file could not be displayed as an image. Try PNG, JPEG, or WebP.');
    };

    safeDestroyCropper();

    mainImage.onload = function () {
      try {
        const emptyState = $('empty-state');
    const workspace = $('workspace-shell');
    if (emptyState) emptyState.classList.add('d-none');
    if (workspace) workspace.classList.remove('d-none');

        let readyFired = false;
        function markReady() {
          if (readyFired) return;
          readyFired = true;
          if (cropperReadyTimer) {
            clearTimeout(cropperReadyTimer);
            cropperReadyTimer = null;
          }
          if (pendingBlobUrl) {
            try {
              URL.revokeObjectURL(pendingBlobUrl);
            } catch (e) {
              /* ignore */
            }
            pendingBlobUrl = null;
          }
          hideLoader();
          syncPhotoWorkspaceVisibility();
          const cropBtn = $('btn-crop-mode');
          if (cropBtn) cropBtn.classList.add('active');
          const moveBtn = $('btn-move-mode');
          if (moveBtn) moveBtn.classList.remove('active');
          document.querySelectorAll('.crop-ratio').forEach(function (b) {
            b.classList.remove('active');
          });
          const freeBtn = document.querySelector('.crop-ratio[data-ratio="free"]');
          if (freeBtn) freeBtn.classList.add('active');
          scheduleDimensionLabel();
          updateFilters();
          if (typeof afterReady === 'function') afterReady();
        }

        cropper = new window.Cropper(mainImage, {
          viewMode: 1,
          dragMode: 'crop',
          autoCrop: true,
          autoCropArea: 1,
          restore: false,
          guides: true,
          center: true,
          highlight: false,
          cropBoxMovable: true,
          cropBoxResizable: true,
          toggleDragModeOnDblclick: false,
          responsive: true,
          checkOrientation: true,
          rotatable: true,
          scalable: true,
          ready: function () {
            markReady();
          },
          crop: function () {
            scheduleDimensionLabel();
            applyFiltersVisual();
          },
        });

        cropperReadyTimer = setTimeout(function () {
          if (readyFired) return;
          if (cropper && cropper.ready) {
            console.warn('Image Studio: Cropper ready callback missed; syncing UI.');
            markReady();
          } else {
            hideLoader();
            showPhotoPlaceholder(true);
            alert(
              'The image editor did not finish loading. Try a smaller image, another format, or refresh the page.'
            );
          }
        }, 10000);

        const resetF = $('btn-reset-filters');
        if (resetF) resetF.click();
      } catch (err) {
        console.error(err);
        hideLoader();
        showPhotoPlaceholder(true);
        safeDestroyCropper();
        alert('Could not start the image editor: ' + (err && err.message ? err.message : 'unknown error'));
      }
    };

    mainImage.src = objectUrl;
  }

  function loadNewImageFile(file, options) {
    if (!file) return;
    if (typeof window.Cropper === 'undefined') {
      showBanner(
        'Cropper.js failed to load. Hard-refresh the page (Ctrl+F5). If this persists, check that /static/toolstudio/vendor/cropper.min.js is served.',
        true
      );
      return;
    }

    const url = URL.createObjectURL(file);
    slotIdSeq += 1;
    imageSlots.push({
      id: slotIdSeq,
      name: file.name || 'image.png',
      originalFile: file,
      blob: null,
    });
    activeSlotIndex = imageSlots.length - 1;

    startCropperLoad(url, function () {
      renderDocTabs();
    });
  }

  function replaceActiveImageFile(file) {
    if (!file) return;
    const slot = getActiveSlot();
    if (slot) {
      slot.originalFile = file;
      slot.blob = null;
      slot.name = file.name || 'image.png';
    }
    const url = URL.createObjectURL(file);
    startCropperLoad(url, function () {
      renderDocTabs();
    });
  }

  function addNewImageFile(file) {
    if (!file) return;
    commitActiveSlot(function () {
      slotIdSeq += 1;
      imageSlots.push({
        id: slotIdSeq,
        name: file.name || 'image.png',
        originalFile: file,
        blob: null,
      });
      activeSlotIndex = imageSlots.length - 1;
      const url = URL.createObjectURL(file);
      startCropperLoad(url, function () {
        renderDocTabs();
      });
    });
  }

  function showBanner(msg, isError) {
    let b = $('studio-init-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'studio-init-banner';
      b.style.cssText =
        'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);z-index:10000;max-width:90%;padding:0.75rem 1rem;border-radius:0.5rem;font-size:0.85rem;';
      document.body.appendChild(b);
    }
    b.style.background = isError ? 'rgba(127,29,29,0.95)' : 'rgba(15,23,42,0.95)';
    b.style.color = '#f1f5f9';
    b.style.border = '1px solid rgba(148,163,184,0.3)';
    b.textContent = msg;
  }

  function tbAct(btn, fn) {
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      fn();
      e.currentTarget.blur();
      requestAnimationFrame(scheduleDimensionLabel);
    });
  }

  function setToolbarMode(mode) {
    const cropBtn = $('btn-crop-mode');
    const moveBtn = $('btn-move-mode');
    document.querySelectorAll('#toolbar .tb-btn').forEach(function (b) {
      if (b === cropBtn || b === moveBtn) b.classList.remove('active');
    });
    if (mode === 'move' && moveBtn) {
      moveBtn.classList.add('active');
    } else if (cropBtn) {
      cropBtn.classList.add('active');
    }
  }

  function init() {
    if (typeof window.Cropper === 'undefined') {
      showBanner(
        'Image Studio: Cropper.js not loaded. Check static files / network, then Ctrl+F5.',
        true
      );
      return;
    }

    const fileInput = $('file-input');
    const fileInput2 = $('file-input-2');
    const fileInputAdd = $('file-input-add');
    const fileInputSidebar = $('file-input-sidebar');
    const fileInputCanvas = $('file-input-canvas');

    document.querySelectorAll('.filter-inp').forEach(function (inp) {
      inp.addEventListener('input', function (e) {
        const id = e.target.id;
        if (!id || id.length < 3 || id.indexOf('f-') !== 0) return;
        const key = id.slice(2);
        if (!Object.prototype.hasOwnProperty.call(filters, key)) return;
        const raw = e.target.value;
        if (key === 'blur') {
          const n = parseFloat(raw);
          filters[key] = Number.isFinite(n) ? n : 0;
        } else if (key === 'hue') {
          const n = parseInt(raw, 10);
          filters[key] = Number.isFinite(n) ? n : 0;
        } else {
          const n = parseFloat(raw);
          filters[key] = Number.isFinite(n) ? Math.round(n) : 0;
        }
        updateFilters();
      });
    });

    const btnResetFilters = $('btn-reset-filters');
    if (btnResetFilters) {
      btnResetFilters.addEventListener('click', function () {
        resetFiltersUi();
      });
    }

    const btnAutoEnhance = $('btn-auto-enhance');
    if (btnAutoEnhance) {
      btnAutoEnhance.addEventListener('click', function () {
        if (!cropper || !cropper.ready) {
          notifyPhotoRequired();
          return;
        }
        showLoader('Enhancing…');
        setTimeout(function () {
          try {
            const canvas = getFilteredRasterCanvas(4096);
            if (!canvas) {
              hideLoader();
              return;
            }
            autoEnhanceCanvasPixels(canvas);
            canvas.toBlob(function (blob) {
              if (!blob) {
                hideLoader();
                alert('Could not apply auto enhance.');
                return;
              }
              const slot = getActiveSlot();
              if (slot) {
                slot.blob = blob;
                slot.originalFile = null;
              }
              resetFiltersUi();
              const url = URL.createObjectURL(blob);
              startCropperLoad(url, function () {
                renderDocTabs();
              });
            }, 'image/png');
          } catch (err) {
            console.error(err);
            hideLoader();
            alert(err.message || 'Auto enhance failed.');
          }
        }, 30);
      });
    }

    const exportQuality = $('export-quality');
    if (exportQuality) {
      exportQuality.addEventListener('input', function (e) {
        const vq = $('v-qual');
        if (vq) vq.textContent = Math.round(e.target.value * 100) + '%';
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) {
          e.target.value = '';
          return;
        }
        if (!imageSlots.length) {
          loadNewImageFile(file);
        } else {
          replaceActiveImageFile(file);
        }
        e.target.value = '';
      });
    }
    if (fileInput2) {
      fileInput2.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) {
          e.target.value = '';
          return;
        }
        loadNewImageFile(file);
        e.target.value = '';
      });
    }
    if (fileInputAdd) {
      fileInputAdd.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (!imageSlots.length) {
          loadNewImageFile(file);
        } else {
          addNewImageFile(file);
        }
      });
    }

    function bindSameAsChooseImage(inputEl) {
      if (!inputEl) return;
      inputEl.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) {
          e.target.value = '';
          return;
        }
        loadNewImageFile(file);
        e.target.value = '';
      });
    }
    bindSameAsChooseImage(fileInputSidebar);
    bindSameAsChooseImage(fileInputCanvas);

    syncPhotoWorkspaceVisibility();

    window.__imageStudioSyncClassicView = function () {
      syncPhotoWorkspaceVisibility();
      if (cropper && typeof cropper.resize === 'function') {
        requestAnimationFrame(function () {
          try {
            cropper.resize();
          } catch (e) {
            /* ignore */
          }
        });
      }
    };

    const btnCropMode = $('btn-crop-mode');
    if (btnCropMode) {
      btnCropMode.addEventListener('click', function (e) {
        if (cropper) cropper.setDragMode('crop');
        setToolbarMode('crop');
        e.currentTarget.blur();
      });
    }

    const btnMoveMode = $('btn-move-mode');
    if (btnMoveMode) {
      btnMoveMode.addEventListener('click', function (e) {
        if (cropper) cropper.setDragMode('move');
        setToolbarMode('move');
        e.currentTarget.blur();
      });
    }

    tbAct($('btn-rotate-l'), function () {
      if (cropper && cropper.ready) cropper.rotate(-90);
    });
    tbAct($('btn-rotate-r'), function () {
      if (cropper && cropper.ready) cropper.rotate(90);
    });
    tbAct($('btn-flip-h'), function () {
      if (!cropper || !cropper.ready) return;
      const d = cropper.getImageData();
      const sx = typeof d.scaleX === 'number' ? d.scaleX : 1;
      cropper.scaleX(-sx);
    });
    tbAct($('btn-flip-v'), function () {
      if (!cropper || !cropper.ready) return;
      const d = cropper.getImageData();
      const sy = typeof d.scaleY === 'number' ? d.scaleY : 1;
      cropper.scaleY(-sy);
    });

    const btnReset = $('btn-reset');
    if (btnReset) {
      btnReset.addEventListener('click', function (e) {
        if (cropper) {
          cropper.reset();
          const rf = $('btn-reset-filters');
          if (rf) rf.click();
          setToolbarMode('crop');
          requestAnimationFrame(scheduleDimensionLabel);
        }
        e.currentTarget.blur();
      });
    }

    document.querySelectorAll('.crop-ratio').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        const target = e.target.closest('.crop-ratio');
        if (!target || !cropper) return;
        document.querySelectorAll('.crop-ratio').forEach(function (b) {
          b.classList.remove('active');
        });
        target.classList.add('active');
        const raw = target.getAttribute('data-ratio') || 'free';
        var ar;
        if (raw === 'free') {
          ar = null;
        } else {
          var r = parseFloat(raw);
          ar = Number.isFinite(r) && r > 0 ? r : null;
        }
        try {
          cropper.setAspectRatio(ar);
        } catch (err) {
          console.warn('setAspectRatio', err);
        }
        target.blur();
        requestAnimationFrame(scheduleDimensionLabel);
      });
    });

    const btnRemoveBg = $('btn-remove-bg');
    if (btnRemoveBg && REMOVE_BG_URL) {
      btnRemoveBg.addEventListener('click', function () {
        if (!getActiveSlot() || !cropper || !cropper.ready) {
          notifyPhotoRequired();
          return;
        }
        showLoader('Removing background…');
        var croppedCanvas = null;
        try {
          croppedCanvas = ensureCroppedCanvas(2048, 2048);
          if (!croppedCanvas) {
            throw new Error('Could not read the cropped image. Try resetting the crop.');
          }
        } catch (e1) {
          hideLoader();
          alert(e1.message || 'Crop error');
          return;
        }

        new Promise(function (resolve, reject) {
          croppedCanvas.toBlob(function (b) {
            if (b) resolve(b);
            else reject(new Error('Could not encode image.'));
          }, 'image/png');
        })
          .then(function (blob) {
            var fd = new FormData();
            fd.append('csrfmiddlewaretoken', csrfToken());
            fd.append('image', blob, 'studio-crop.png');
            return withTimeout(
              fetch(REMOVE_BG_URL, {
                method: 'POST',
                body: fd,
                headers: { 'X-CSRFToken': csrfToken() },
                credentials: 'same-origin',
              }),
              300000,
              'Background removal timed out (5 min). Try a smaller crop.'
            );
          })
          .then(function (res) {
            if (!res.ok) {
              return parseServerError(res).then(function (msg) {
                throw new Error(msg);
              });
            }
            return res.blob();
          })
          .then(function (resultBlob) {
            if (!resultBlob || resultBlob.size === 0) {
              throw new Error('Empty response from server.');
            }
            var newUrl = URL.createObjectURL(resultBlob);
            cropper.replace(newUrl, true);
            var slot = getActiveSlot();
            if (slot) {
              slot.blob = resultBlob;
              slot.originalFile = null;
            }
            $('export-format').value = 'image/png';
            requestAnimationFrame(function () {
              scheduleDimensionLabel();
              setTimeout(scheduleDimensionLabel, 150);
              applyFiltersVisual();
              renderDocTabs();
            });
          })
          .catch(function (err) {
            console.error(err);
            alert(err.message || 'Background removal failed.');
          })
          .finally(function () {
            hideLoader();
            var b = $('btn-remove-bg');
            if (b) b.blur();
          });
      });
    }

    const btnExport = $('btn-export');
    if (btnExport) {
      btnExport.addEventListener('click', function () {
        if (!cropper) {
          notifyPhotoRequired();
          return;
        }
        if (!cropper.ready) {
          alert('The editor is still loading. Wait a moment and try again.');
          return;
        }
        showLoader('Exporting…');
        setTimeout(function () {
          try {
            var canvas = getFilteredRasterCanvas(8192);
            if (!canvas) {
              alert('Nothing to export — wait for the image to finish loading, then try again.');
              hideLoader();
              return;
            }
            var format = $('export-format').value;
            var quality = parseFloat($('export-quality').value);
            canvas.toBlob(
              function (blob) {
                try {
                  if (!blob) {
                    alert('Export failed — your browser could not create this file format.');
                    return;
                  }
                  var url = URL.createObjectURL(blob);
                  var a = document.createElement('a');
                  a.href = url;
                  var ext = format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png';
                  var ogName = getExportBasename();
                  a.download = ogName + '_edited.' + ext;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } finally {
                  hideLoader();
                }
              },
              format,
              quality
            );
          } catch (err) {
            console.error(err);
            alert(err.message || 'Export failed.');
            hideLoader();
          }
        }, 50);
      });
    }

    window.__imageStudioGetCroppedBlob = function (cb) {
      try {
        var c = getFilteredRasterCanvas(8192);
        if (!c) {
          cb(null);
          return;
        }
        c.toBlob(function (b) {
          cb(b);
        }, 'image/png');
      } catch (e) {
        cb(null);
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
