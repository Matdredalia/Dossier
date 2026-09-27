// Dossier — a per-character (or standalone) workspace for notes, links,
// reference images, and audio clips, backed by the dossier-server plugin.

import { normalize, parseTerms, searchMeta, sortResults } from './search.js';

const API_BASE = '/api/plugins/dossier-server';
const CATEGORY_LABELS = { canon: 'Canon', headcanon: 'Headcanon', altverse: 'Alt Verse', samples: 'Samples' };

let currentKey = null;
let currentData = null;
let activeTab = 'sound';
let activeSubtab = 'canon';
let editingNote = null; // { category, id } or null when creating new

function getCtx() {
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        return SillyTavern.getContext();
    }
    return null;
}

function authHeaders(json = true) {
    const ctx = getCtx();
    const base = ctx && ctx.getRequestHeaders ? ctx.getRequestHeaders() : {};
    if (!json) {
        // Uploading FormData — strip Content-Type so the browser sets the
        // multipart boundary itself, but keep the CSRF token.
        const { 'Content-Type': _drop, ...rest } = base;
        return rest;
    }
    return base;
}

async function api(path, options = {}) {
    const isForm = options.body instanceof FormData;
    const res = await fetch(API_BASE + path, {
        ...options,
        headers: { ...authHeaders(!isForm), ...(options.headers || {}) },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Dossier API ${path} failed: ${res.status} ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.blob();
}

function reportUploadError(what, err) {
    console.error('[Dossier] Upload failed:', what, err);
    if (typeof toastr !== 'undefined') toastr.error(`Dossier: could not upload ${what}. ${err.message}`);
}

// ─────────────────────────── panel markup ───────────────────────────

function panelTemplate() {
    return `
    <div class="dossier-panel" role="region" aria-label="Dossier extension panel">
        <div class="dossier-topbar" id="dossier-drag-handle">
            <div class="dossier-title-area">
                <span class="dossier-title" id="dossier-title" title="Switch dossier">Loading…</span>
                <button class="btn-icon" id="dossier-switch-btn" aria-label="Switch dossier" aria-haspopup="listbox" title="Switch dossier">▾</button>
                <button class="btn-icon" id="dossier-rename-btn" aria-label="Rename dossier" title="Rename dossier">✎</button>
                <div class="dossier-switcher" id="dossier-switcher"></div>
            </div>
            <div class="dossier-topbar-actions">
                <button class="btn-icon" id="dossier-smaller-btn" aria-label="Smaller text" title="Smaller text">A−</button>
                <button class="btn-icon" id="dossier-bigger-btn" aria-label="Larger text" title="Larger text">A+</button>
                <button class="btn-icon" id="dossier-large-btn" aria-label="Toggle large view" title="Large view">⤢</button>
                <button class="btn-new" id="dossier-new-btn" title="Create new dossier">+ New</button>
                <button class="btn-icon" id="dossier-close-btn" aria-label="Close dossier panel" title="Close">✕</button>
            </div>
        </div>

        <div class="dossier-search" role="search">
            <div class="dossier-search-field">
                <input type="text" id="dossier-search-input" placeholder="Search notes, images, links, audio…" autocomplete="off" spellcheck="false" />
                <button class="btn-icon" id="dossier-search-clear" aria-label="Clear search" title="Clear search">✕</button>
            </div>
            <div class="dossier-scope" role="group" aria-label="Search scope">
                <button type="button" id="dossier-scope-this" aria-pressed="true" title="Search only this dossier">This dossier</button>
                <button type="button" id="dossier-scope-all" aria-pressed="false" title="Search every dossier">All dossiers</button>
            </div>
        </div>

        <div class="tab-bar" role="tablist" aria-label="Dossier sections">
            <button class="tab-btn active" data-tab="sound">Sound</button>
            <button class="tab-btn" data-tab="visual">Visual</button>
            <button class="tab-btn" data-tab="text">Text</button>
            <button class="tab-btn" data-tab="links">Links</button>
        </div>

        <div class="tab-panel active" id="panel-sound">
            <div class="panel-label">Audio &amp; Voice Memos</div>
            <div class="flex-row">
                <button class="btn-primary" id="dossier-add-sound-btn">Add Recording</button>
            </div>
            <div class="sound-upload-area" id="dossier-sound-upload-area">Import Audio File</div>
            <!-- No accept="audio/*": Firefox on Linux expands it into a huge native filter that can hang the GTK/portal file dialog. Type is checked in JS instead. -->
            <input type="file" id="dossier-sound-input" style="display:none" />
            <div class="sound-list" id="dossier-sound-list"></div>
        </div>

        <div class="tab-panel" id="panel-visual">
            <div class="panel-label">Reference Images &amp; Visuals</div>
            <div class="flex-row">
                <button class="btn-primary" id="dossier-add-image-btn">Add Image</button>
                <button class="btn-secondary" id="dossier-fit-btn" title="Switch between cropped squares and whole images">Show whole images</button>
            </div>
            <input type="file" id="dossier-image-input" accept="image/*" multiple style="display:none" />
            <div class="visual-grid" id="dossier-visual-grid"></div>
        </div>

        <div class="tab-panel" id="panel-text">
            <div class="panel-label">Notes &amp; Lore</div>
            <div class="flex-row">
                <button class="btn-primary" id="dossier-add-note-btn">Add Note</button>
                <button class="btn-secondary" id="dossier-import-note-btn" title="Each file becomes a note in the open category tab">Import Text File</button>
            </div>
            <input type="file" id="dossier-note-file-input" multiple style="display:none" />

            <div class="note-editor" id="dossier-note-editor">
                <input type="text" id="dossier-note-title-input" placeholder="Note title…" />
                <textarea id="dossier-note-content-input" placeholder="Write it down before it slips away…"></textarea>
                <div class="note-editor-actions">
                    <button class="btn-secondary" id="dossier-note-cancel-btn">Cancel</button>
                    <button class="btn-primary" id="dossier-note-save-btn">Save</button>
                </div>
            </div>

            <div class="subtab-bar" role="tablist" aria-label="Note categories">
                <button class="subtab-btn active" data-subtab="canon">Canon</button>
                <button class="subtab-btn" data-subtab="headcanon">Headcanon</button>
                <button class="subtab-btn" data-subtab="altverse">Alt Verse</button>
                <button class="subtab-btn" data-subtab="samples">Samples</button>
            </div>

            <div class="subtab-panel active" id="sub-canon"><div class="note-list" data-list="canon"></div></div>
            <div class="subtab-panel" id="sub-headcanon"><div class="note-list" data-list="headcanon"></div></div>
            <div class="subtab-panel" id="sub-altverse"><div class="note-list" data-list="altverse"></div></div>
            <div class="subtab-panel" id="sub-samples"><div class="note-list" data-list="samples"></div></div>
        </div>

        <div class="tab-panel" id="panel-links">
            <div class="panel-label">Reference Links</div>
            <div class="link-add-row">
                <input type="text" id="dossier-link-input" placeholder="Paste URL…" />
                <button class="btn-primary" id="dossier-add-link-btn">Add</button>
            </div>
            <div class="link-list" id="dossier-link-list"></div>
        </div>
        <div class="dossier-search-results" id="dossier-search-results"></div>
        <div class="dossier-resize-grip" id="dossier-resize-grip" title="Drag to resize"></div>
    </div>
    <div class="dossier-lightbox" id="dossier-lightbox">
        <button class="lb-btn lb-close" id="dossier-lb-close" aria-label="Close">✕</button>
        <button class="lb-btn lb-nav lb-prev" id="dossier-lb-prev" aria-label="Previous image">‹</button>
        <figure class="lb-figure">
            <img id="dossier-lightbox-img" src="" alt="" />
            <figcaption class="lb-caption" id="dossier-lb-caption"></figcaption>
        </figure>
        <button class="lb-btn lb-nav lb-next" id="dossier-lb-next" aria-label="Next image">›</button>
    </div>
    `;
}

// ─────────────────────────── injection ───────────────────────────

function injectPanel() {
    if (document.getElementById('dossier-panel-root')) return;
    const root = document.createElement('div');
    root.id = 'dossier-panel-root';
    root.innerHTML = panelTemplate();
    document.body.appendChild(root);
    wireStaticEvents(root);
    initGeometry(root);
    wireSearch(root);
    makeDraggable(root, root.querySelector('#dossier-drag-handle'));
    makeResizable(root, root.querySelector('#dossier-resize-grip'));
}

function injectMenuButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('dossier-menu-button')) return;
    const item = document.createElement('div');
    item.id = 'dossier-menu-button';
    item.className = 'list-group-item flex-container flexGap5';
    item.innerHTML = `<div class="fa-solid fa-folder-open extensionsMenuExtensionButton"></div> Dossier`;
    item.addEventListener('click', togglePanel);
    menu.appendChild(item);
}

function togglePanel() {
    const root = document.getElementById('dossier-panel-root');
    if (!root) return;
    root.classList.toggle('dossier-visible');
    if (root.classList.contains('dossier-visible') && !currentKey) {
        resolveAndLoad();
    }
}

// ─────────────────────────── dragging ───────────────────────────

const UI_KEY = 'dossier_ui';
const MIN_W = 320;
const MIN_H = 360;
const SCALE_MIN = 0.85;
const SCALE_MAX = 1.6;
let ui = { w: null, h: null, left: null, top: null, large: false, scale: 1.1, fit: false, searchAll: false };

const isPhone = () => window.matchMedia('(max-width: 480px)').matches;
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), Math.max(lo, hi));

function loadUi() {
    try {
        const saved = JSON.parse(localStorage.getItem(UI_KEY));
        if (saved && typeof saved === 'object') ui = { ...ui, ...saved };
    } catch { /* storage unavailable: defaults are fine */ }
}

function saveUi() {
    try {
        localStorage.setItem(UI_KEY, JSON.stringify(ui));
    } catch { /* remembering size is a convenience only */ }
}

/** Keep at least part of the panel on screen, e.g. after the window got smaller. */
function clampIntoViewport(root) {
    if (root.style.left === '') return;
    const rect = root.getBoundingClientRect();
    const left = clamp(rect.left, 8 - rect.width + 80, window.innerWidth - 80);
    const top = clamp(rect.top, 0, window.innerHeight - 48);
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    ui.left = left;
    ui.top = top;
}

function applyUi(root) {
    root.style.setProperty('--ds', String(ui.scale));
    if (ui.w) root.style.setProperty('--dossier-w', `${ui.w}px`);
    if (ui.h) root.style.setProperty('--dossier-h', `${ui.h}px`);
    root.classList.toggle('dossier-large', !!ui.large);
    const grid = root.querySelector('#dossier-visual-grid');
    if (grid) grid.classList.toggle('fit', !!ui.fit);
    const fitBtn = root.querySelector('#dossier-fit-btn');
    if (fitBtn) fitBtn.textContent = ui.fit ? 'Crop to squares' : 'Show whole images';
    const largeBtn = root.querySelector('#dossier-large-btn');
    if (largeBtn) {
        largeBtn.textContent = ui.large ? '⤡' : '⤢';
        largeBtn.title = ui.large ? 'Back to normal size' : 'Large view';
    }
}

function initGeometry(root) {
    loadUi();
    applyUi(root);
    if (ui.left !== null && ui.top !== null && !isPhone()) {
        root.style.left = `${ui.left}px`;
        root.style.top = `${ui.top}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
    }
    root.querySelector('#dossier-large-btn').addEventListener('click', () => {
        ui.large = !ui.large;
        applyUi(root);
        saveUi();
    });
    root.querySelector('#dossier-fit-btn').addEventListener('click', () => {
        ui.fit = !ui.fit;
        applyUi(root);
        saveUi();
    });
    const step = (delta) => {
        ui.scale = Math.round(clamp(ui.scale + delta, SCALE_MIN, SCALE_MAX) * 100) / 100;
        applyUi(root);
        saveUi();
    };
    root.querySelector('#dossier-smaller-btn').addEventListener('click', () => step(-0.1));
    root.querySelector('#dossier-bigger-btn').addEventListener('click', () => step(0.1));
    window.addEventListener('resize', () => { if (!ui.large && !isPhone()) clampIntoViewport(root); });
}

/** Drag by the top bar. Pointer events, so it works with a finger as well as a mouse. */
function makeDraggable(root, handle) {
    let drag = null;

    handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, #dossier-title, .dossier-switcher') || ui.large || isPhone()) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const rect = root.getBoundingClientRect();
        drag = { id: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
        try { handle.setPointerCapture(e.pointerId); } catch { /* not fatal: drag still works while the pointer stays over the bar */ }
        e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        root.style.left = `${e.clientX - drag.dx}px`;
        root.style.top = `${e.clientY - drag.dy}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
    });
    const end = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null;
        clampIntoViewport(root);
        saveUi();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
}

/** Resize from the bottom-right corner grip. */
function makeResizable(root, grip) {
    let resize = null;
    const panel = root.querySelector('.dossier-panel');

    grip.addEventListener('pointerdown', (e) => {
        if (ui.large || isPhone()) return;
        const rect = panel.getBoundingClientRect();
        resize = { id: e.pointerId, x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
        try { grip.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
        e.preventDefault();
        e.stopPropagation();
    });
    grip.addEventListener('pointermove', (e) => {
        if (!resize || e.pointerId !== resize.id) return;
        // Grow as far as the window allows; if the panel would run off the right/bottom edge, shift it back on screen.
        const rect = root.getBoundingClientRect();
        ui.w = Math.round(clamp(resize.w + e.clientX - resize.x, MIN_W, window.innerWidth - 16));
        ui.h = Math.round(clamp(resize.h + e.clientY - resize.y, MIN_H, window.innerHeight - 16));
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - 8 - ui.w));
        const top = Math.max(8, Math.min(rect.top, window.innerHeight - 8 - ui.h));
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        ui.left = left;
        ui.top = top;
        root.style.setProperty('--dossier-w', `${ui.w}px`);
        root.style.setProperty('--dossier-h', `${ui.h}px`);
    });
    const end = (e) => {
        if (!resize || e.pointerId !== resize.id) return;
        resize = null;
        saveUi();
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
}

// ─────────────────────────── tab / subtab switching ───────────────────────────

function wireStaticEvents(root) {
    root.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            clearSearch();
            activeTab = btn.dataset.tab;
            root.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
            root.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + activeTab));
        });
    });

    root.querySelectorAll('.subtab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            activeSubtab = btn.dataset.subtab;
            root.querySelectorAll('.subtab-btn').forEach((b) => b.classList.toggle('active', b === btn));
            root.querySelectorAll('.subtab-panel').forEach((p) => p.classList.toggle('active', p.id === 'sub-' + activeSubtab));
        });
    });

    root.querySelector('#dossier-close-btn').addEventListener('click', () => {
        root.classList.remove('dossier-visible');
    });

    root.querySelector('#dossier-new-btn').addEventListener('click', async () => {
        const name = prompt('Name for the new dossier:');
        if (!name) return;
        const result = await api('/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: name }),
        });
        await loadDossier(result.key);
    });

    root.querySelector('#dossier-rename-btn').addEventListener('click', async () => {
        if (!currentKey || !currentData) return;
        const name = prompt('Rename this dossier:', currentData.displayName);
        if (!name) return;
        await api(`/${currentKey}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: name }),
        });
        currentData.displayName = name;
        renderTitle();
    });

    root.querySelector('#dossier-title').addEventListener('click', openSwitcher);
    root.querySelector('#dossier-switch-btn').addEventListener('click', openSwitcher);
    document.addEventListener('pointerdown', (e) => {
        const sw = document.getElementById('dossier-switcher');
        if (sw && sw.classList.contains('open') && !e.target.closest('#dossier-switcher, #dossier-title, #dossier-switch-btn')) closeSwitcher();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSwitcher(); });

    // ── sound ──
    const soundInput = root.querySelector('#dossier-sound-input');
    root.querySelector('#dossier-add-sound-btn').addEventListener('click', () => soundInput.click());
    root.querySelector('#dossier-sound-upload-area').addEventListener('click', () => soundInput.click());
    soundInput.addEventListener('change', async () => {
        try {
            const file = soundInput.files[0];
            if (file && !isAudioFile(file)) {
                if (typeof toastr !== 'undefined') toastr.warning(`Dossier: "${file.name}" doesn't look like an audio file.`);
            } else if (file) {
                await uploadSound(file);
            }
        } catch (e) {
            reportUploadError('audio', e);
        }
        soundInput.value = '';
    });

    // ── images ──
    const imageInput = root.querySelector('#dossier-image-input');
    root.querySelector('#dossier-add-image-btn').addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', async () => {
        for (const file of Array.from(imageInput.files)) {
            try {
                await uploadImage(file);
            } catch (e) {
                reportUploadError(file.name, e);
            }
        }
        imageInput.value = '';
    });

    const lightbox = root.querySelector('#dossier-lightbox');
    lightbox.addEventListener('click', (e) => {
        if (e.target.id === 'dossier-lightbox') closeLightbox();
    });
    root.querySelector('#dossier-lb-close').addEventListener('click', closeLightbox);
    root.querySelector('#dossier-lb-prev').addEventListener('click', () => stepLightbox(-1));
    root.querySelector('#dossier-lb-next').addEventListener('click', () => stepLightbox(1));
    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('open')) return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') stepLightbox(-1);
        else if (e.key === 'ArrowRight') stepLightbox(1);
    });
    // Swipe left/right to browse on a touch screen.
    let swipeX = null;
    lightbox.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') swipeX = e.clientX; });
    lightbox.addEventListener('pointerup', (e) => {
        if (swipeX === null) return;
        const dx = e.clientX - swipeX;
        swipeX = null;
        if (Math.abs(dx) > 60) stepLightbox(dx < 0 ? 1 : -1);
    });

    // ── notes ──
    root.querySelector('#dossier-add-note-btn').addEventListener('click', () => { if (confirmDiscardDraft()) openNoteEditor(null); });
    root.querySelector('#dossier-note-cancel-btn').addEventListener('click', closeNoteEditor);
    root.querySelector('#dossier-note-save-btn').addEventListener('click', saveNoteFromEditor);

    const noteFileInput = root.querySelector('#dossier-note-file-input');
    root.querySelector('#dossier-import-note-btn').addEventListener('click', () => noteFileInput.click());
    noteFileInput.addEventListener('change', async () => {
        await importTextFiles(Array.from(noteFileInput.files));
        noteFileInput.value = '';
    });

    // ── links ──
    const linkInput = root.querySelector('#dossier-link-input');
    root.querySelector('#dossier-add-link-btn').addEventListener('click', () => addLink(linkInput));
    linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addLink(linkInput); });
}

function closeSwitcher() {
    const sw = document.getElementById('dossier-switcher');
    if (sw) sw.classList.remove('open');
}

function openSwitcher() {
    const sw = document.getElementById('dossier-switcher');
    if (sw.classList.contains('open')) return closeSwitcher();
    api('/list').then((list) => {
        list.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
        const many = list.length > 6;
        sw.innerHTML = (many ? '<input type="text" class="dossier-switcher-filter" placeholder="Filter dossiers…" autocomplete="off" spellcheck="false" />' : '')
            + '<div class="dossier-switcher-list">'
            + (list.map((d) =>
                `<div class="dossier-switcher-item${d.key === currentKey ? ' current' : ''}" data-key="${escapeHtml(d.key)}" data-name="${escapeHtml(String(d.displayName).toLowerCase())}">${escapeHtml(d.displayName)}${d.boundCharacter ? '' : ' <span class="dossier-standalone">(standalone)</span>'}${d.key === currentKey ? ' <span class="dossier-standalone">← open</span>' : ''}</div>`
            ).join('') || '<div class="dossier-switcher-item" style="opacity:.6">No dossiers yet</div>')
            + '</div>';
        sw.querySelectorAll('.dossier-switcher-item[data-key]').forEach((el) => {
            el.addEventListener('click', async () => {
                closeSwitcher();
                if (el.dataset.key === currentKey) return;
                if (!confirmDiscardDraft()) return;
                closeNoteEditor();
                clearSearch();
                await loadDossier(el.dataset.key);
            });
        });
        const filter = sw.querySelector('.dossier-switcher-filter');
        if (filter) {
            filter.addEventListener('input', () => {
                const q = normalize(filter.value);
                sw.querySelectorAll('.dossier-switcher-item[data-key]').forEach((el) => {
                    el.style.display = !q || normalize(el.dataset.name).includes(q) ? '' : 'none';
                });
            });
            setTimeout(() => filter.focus(), 0);
        }
        sw.classList.add('open');
    });
}

// ─────────────────────────── data loading ───────────────────────────

async function resolveAndLoad() {
    const ctx = getCtx();
    let character = null;
    let name = null;
    if (ctx && ctx.characters && typeof ctx.this_chid !== 'undefined' && ctx.characters[ctx.this_chid]) {
        const c = ctx.characters[ctx.this_chid];
        character = c.avatar || null;
        name = c.name || null;
    }
    const qs = character ? `?character=${encodeURIComponent(character)}&name=${encodeURIComponent(name || '')}` : '';
    const result = await api('/resolve' + qs);
    await loadDossier(result.key);
}

async function loadDossier(key) {
    currentKey = key;
    currentData = await api(`/${key}`);
    renderAll();
    if (searchIsActive()) runSearch();
}

// ─────────────────────────── rendering ───────────────────────────

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(iso) {
    try {
        return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
}

function formatDuration(sec) {
    if (!sec && sec !== 0) return '';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function renderAll() {
    renderTitle();
    renderSounds();
    renderImages();
    renderNotes();
    renderLinks();
}

function renderTitle() {
    const el = document.getElementById('dossier-title');
    if (el && currentData) {
        el.textContent = currentData.displayName;
        el.title = currentData.displayName;
    }
}

function renderSounds() {
    const list = document.getElementById('dossier-sound-list');
    if (!currentData) return;
    if (currentData.sounds.length === 0) {
        list.innerHTML = '<div class="note-empty">No audio yet.</div>';
        return;
    }
    list.innerHTML = currentData.sounds.map((s) => `
        <div class="sound-entry" data-id="${s.id}">
            <button class="sound-play" aria-label="Play ${escapeHtml(s.originalName)}">▶</button>
            <span class="sound-title">${escapeHtml(s.originalName)}</span>
            <span class="sound-duration">${formatDuration(s.duration)}</span>
            <button class="btn-danger-icon" aria-label="Delete ${escapeHtml(s.originalName)}">🗑</button>
        </div>
    `).join('');

    list.querySelectorAll('.sound-entry').forEach((entry) => {
        const id = entry.dataset.id;
        entry.querySelector('.sound-play').addEventListener('click', () => playSound(id));
        entry.querySelector('.btn-danger-icon').addEventListener('click', () => deleteSound(id));
    });
}

function renderImages() {
    const grid = document.getElementById('dossier-visual-grid');
    if (!currentData) return;
    grid.innerHTML = currentData.images.map((img) => `
        <div class="vis-thumb" data-id="${img.id}" title="${escapeHtml(img.label || img.originalName)}">
            <img loading="lazy" src="${API_BASE}/${currentKey}/images/${img.id}/file" alt="${escapeHtml(img.label || img.originalName)}" />
            <button class="del-overlay" aria-label="Remove ${escapeHtml(img.originalName)}">✕</button>
        </div>
    `).join('');

    grid.querySelectorAll('.vis-thumb').forEach((thumb, index) => {
        const id = thumb.dataset.id;
        thumb.addEventListener('click', (e) => {
            if (e.target.closest('.del-overlay')) return;
            openLightbox(index);
        });
        thumb.querySelector('.del-overlay').addEventListener('click', () => deleteImage(id));
    });
}

let lightboxIndex = -1;

function openLightbox(index) {
    const images = (currentData && currentData.images) || [];
    if (!images.length) return;
    lightboxIndex = ((index % images.length) + images.length) % images.length;
    const img = images[lightboxIndex];
    const box = document.getElementById('dossier-lightbox');
    const label = img.label || img.originalName || '';
    const el = document.getElementById('dossier-lightbox-img');
    el.src = `${API_BASE}/${currentKey}/images/${img.id}/file`;
    el.alt = label;
    document.getElementById('dossier-lb-caption').textContent = images.length > 1
        ? `${label}${label ? '  ·  ' : ''}${lightboxIndex + 1} / ${images.length}`
        : label;
    const many = images.length > 1;
    box.querySelector('.lb-prev').style.display = many ? '' : 'none';
    box.querySelector('.lb-next').style.display = many ? '' : 'none';
    box.classList.add('open');
}
function stepLightbox(delta) {
    if (lightboxIndex >= 0) openLightbox(lightboxIndex + delta);
}
function closeLightbox() {
    document.getElementById('dossier-lightbox').classList.remove('open');
    lightboxIndex = -1;
}

function renderNotes() {
    if (!currentData) return;
    for (const category of Object.keys(CATEGORY_LABELS)) {
        const listEl = document.querySelector(`.note-list[data-list="${category}"]`);
        const notes = currentData.notes[category] || [];
        if (notes.length === 0) {
            listEl.innerHTML = '<div class="note-empty">Nothing here yet.</div>';
            continue;
        }
        listEl.innerHTML = notes.map((n) => `
            <div class="note-entry" data-id="${n.id}" data-category="${category}">
                <div class="note-body">
                    <div class="note-title">${escapeHtml(n.title)}</div>
                    <div class="note-snippet">${escapeHtml((n.content || '').slice(0, 260))}</div>
                    <div class="note-meta">${formatDate(n.updatedAt)}</div>
                </div>
                <button class="btn-danger-icon" aria-label="Delete note">🗑</button>
            </div>
        `).join('');

        listEl.querySelectorAll('.note-entry').forEach((entry) => {
            const id = entry.dataset.id;
            const cat = entry.dataset.category;
            entry.addEventListener('click', (e) => {
                if (e.target.closest('.btn-danger-icon')) return;
                if (!confirmDiscardDraft()) return;
                const note = currentData.notes[cat].find((n) => n.id === id);
                openNoteEditor({ category: cat, id, note });
            });
            entry.querySelector('.btn-danger-icon').addEventListener('click', () => deleteNote(cat, id));
        });
    }
    markSelectedNote();
}

function renderLinks() {
    const list = document.getElementById('dossier-link-list');
    if (!currentData) return;
    if (currentData.links.length === 0) {
        list.innerHTML = '<div class="note-empty">No links saved yet.</div>';
        return;
    }
    list.innerHTML = currentData.links.map((l) => `
        <div class="link-entry" data-id="${l.id}">
            <div class="link-icon-placeholder">🔗</div>
            <div class="link-body">
                <div class="link-label" data-editable>${escapeHtml(l.label)}</div>
                <a class="link-url" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.url)}</a>
            </div>
            <button class="btn-danger-icon" aria-label="Delete link">🗑</button>
        </div>
    `).join('');

    list.querySelectorAll('.link-entry').forEach((entry) => {
        const id = entry.dataset.id;
        entry.querySelector('.btn-danger-icon').addEventListener('click', () => deleteLink(id));
        const labelEl = entry.querySelector('[data-editable]');
        labelEl.addEventListener('dblclick', () => {
            const next = prompt('Rename link:', labelEl.textContent);
            if (next) renameLink(id, next);
        });
    });
}

// ─────────────────────────── note editor ───────────────────────────

// What the editor held when it was opened, to notice unsaved changes before they are overwritten.
let editorBaseline = { title: '', content: '' };

function editorIsDirty() {
    const title = document.getElementById('dossier-note-title-input').value;
    const content = document.getElementById('dossier-note-content-input').value;
    return title !== editorBaseline.title || content !== editorBaseline.content;
}

function confirmDiscardDraft() {
    return !editorIsDirty() || confirm('You have unsaved changes in the note editor. Discard them?');
}

function markSelectedNote() {
    document.querySelectorAll('.note-entry').forEach((el) => {
        el.classList.toggle('selected', !!editingNote && el.dataset.id === editingNote.id);
    });
}

function openNoteEditor(edit) {
    editingNote = edit;
    const box = document.getElementById('dossier-note-editor');
    const titleInput = document.getElementById('dossier-note-title-input');
    const contentInput = document.getElementById('dossier-note-content-input');
    titleInput.value = edit ? edit.note.title : '';
    contentInput.value = edit ? edit.note.content : '';
    editorBaseline = { title: titleInput.value, content: contentInput.value };
    box.classList.add('open');
    markSelectedNote();
    titleInput.focus();
}
function closeNoteEditor() {
    editingNote = null;
    document.getElementById('dossier-note-editor').classList.remove('open');
    // In the wide layout the editor stays visible, so it must not keep showing the last note's text.
    document.getElementById('dossier-note-title-input').value = '';
    document.getElementById('dossier-note-content-input').value = '';
    editorBaseline = { title: '', content: '' };
    markSelectedNote();
}
async function saveNoteFromEditor() {
    const title = document.getElementById('dossier-note-title-input').value.trim();
    const content = document.getElementById('dossier-note-content-input').value.trim();
    if (!title && !content) { closeNoteEditor(); return; }

    if (editingNote) {
        const { category, id } = editingNote;
        const updated = await api(`/${currentKey}/notes/${category}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content }),
        });
        const idx = currentData.notes[category].findIndex((n) => n.id === id);
        if (idx !== -1) currentData.notes[category][idx] = updated;
    } else {
        const note = await api(`/${currentKey}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: activeSubtab, title, content }),
        });
        currentData.notes[activeSubtab].unshift(note);
    }
    closeNoteEditor();
    renderNotes();
}
const TEXT_EXT_RE = /\.(txt|md|markdown|text|rtf|log|csv|json|html?|xml|ya?ml)$/i;
const MAX_TEXT_IMPORT_BYTES = 2 * 1024 * 1024;

// Each file becomes one note in the currently open category sub-tab.
async function importTextFiles(files) {
    const category = activeSubtab;
    let imported = 0;
    for (const file of files) {
        try {
            const looksText = file.type.startsWith('text/') || TEXT_EXT_RE.test(file.name);
            if (!looksText) throw new Error('not a plain-text file (.docx/.pdf need converting to .txt or .md first)');
            if (file.size > MAX_TEXT_IMPORT_BYTES) throw new Error('file is over 2 MB');
            const content = (await file.text()).replace(/^\uFEFF/, '');
            if (content.includes('\u0000')) throw new Error('looks like a binary file');
            const title = file.name.replace(/\.[^.]+$/, '') || file.name;
            const note = await api(`/${currentKey}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category, title, content }),
            });
            currentData.notes[category].unshift(note);
            imported++;
        } catch (e) {
            console.error('[Dossier] Text import failed:', file.name, e);
            if (typeof toastr !== 'undefined') toastr.error(`Dossier: could not import "${file.name}" — ${e.message}`);
        }
    }
    renderNotes();
    if (imported && typeof toastr !== 'undefined') {
        toastr.success(`Dossier: imported ${imported} note${imported === 1 ? '' : 's'} into ${CATEGORY_LABELS[category]}.`);
    }
}

async function deleteNote(category, id) {
    if (editingNote && editingNote.id === id) closeNoteEditor();
    await api(`/${currentKey}/notes/${category}/${id}`, { method: 'DELETE' });
    currentData.notes[category] = currentData.notes[category].filter((n) => n.id !== id);
    renderNotes();
}

// ─────────────────────────── links ───────────────────────────

async function addLink(inputEl) {
    const url = inputEl.value.trim();
    if (!url) return;
    const link = await api(`/${currentKey}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    currentData.links.unshift(link);
    inputEl.value = '';
    renderLinks();
}
async function deleteLink(id) {
    await api(`/${currentKey}/links/${id}`, { method: 'DELETE' });
    currentData.links = currentData.links.filter((l) => l.id !== id);
    renderLinks();
}
async function renameLink(id, label) {
    await api(`/${currentKey}/links/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
    });
    const link = currentData.links.find((l) => l.id === id);
    if (link) link.label = label;
    renderLinks();
}

// ─────────────────────────── sounds ───────────────────────────

const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm|weba|amr|3gp|3ga|mp4|wma|aif|aiff|caf)$/i;

function isAudioFile(file) {
    // Some recorders/phones give an empty or video/* type (e.g. .m4a, .3gp, .webm).
    return file.type.startsWith('audio/') || AUDIO_EXT_RE.test(file.name);
}

function readAudioDuration(file) {
    // Duration is a nice-to-have. Some formats (m4a/amr/opus on certain
    // browsers) never fire loadedmetadata *or* error, so never wait forever.
    return new Promise((resolve) => {
        const audio = document.createElement('audio');
        const url = URL.createObjectURL(file);
        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            audio.removeAttribute('src');
            URL.revokeObjectURL(url);
            resolve(value);
        };
        const timer = setTimeout(() => finish(null), 3000);
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => finish(isFinite(audio.duration) ? audio.duration : null);
        audio.onerror = () => finish(null);
        audio.src = url;
    });
}

async function uploadSound(file) {
    const duration = await readAudioDuration(file);
    const form = new FormData();
    form.append('avatar', file);
    form.append('originalName', file.name);
    if (duration) form.append('duration', String(duration));
    const entry = await api(`/${currentKey}/sounds`, { method: 'POST', body: form });
    currentData.sounds.unshift(entry);
    renderSounds();
}

function playSound(id) {
    const audio = new Audio(`${API_BASE}/${currentKey}/sounds/${id}/file`);
    audio.play().catch((e) => console.error('[Dossier] Could not play audio:', e));
}

async function deleteSound(id) {
    await api(`/${currentKey}/sounds/${id}`, { method: 'DELETE' });
    currentData.sounds = currentData.sounds.filter((s) => s.id !== id);
    renderSounds();
}

// ─────────────────────────── images ───────────────────────────

async function uploadImage(file) {
    const form = new FormData();
    form.append('avatar', file);
    form.append('originalName', file.name);
    const entry = await api(`/${currentKey}/images`, { method: 'POST', body: form });
    currentData.images.unshift(entry);
    renderImages();
}

async function deleteImage(id) {
    await api(`/${currentKey}/images/${id}`, { method: 'DELETE' });
    currentData.images = currentData.images.filter((i) => i.id !== id);
    renderImages();
}

// ─────────────────────────── search ───────────────────────────

const HIT_LABELS = { note: 'Note', image: 'Image', link: 'Link', sound: 'Audio' };
const MIN_QUERY_LETTERS = 2;
let searchSeq = 0;      // discards answers that arrive after a newer query was typed
let searchTimer = null;

const searchInput = () => document.getElementById('dossier-search-input');
const searchIsActive = () => searchInput().value.trim() !== '';

/** Escape, then wrap every search term in <mark>. Skips highlighting if accents make offsets unreliable. */
function highlight(text, terms) {
    const plain = String(text ?? '');
    const flat = normalize(plain);
    if (flat.length !== plain.length) return escapeHtml(plain);
    const spans = [];
    for (const term of terms) {
        for (let at = flat.indexOf(term); at !== -1; at = flat.indexOf(term, at + term.length)) spans.push([at, at + term.length]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [a, b] of spans) {
        const last = merged[merged.length - 1];
        if (last && a <= last[1]) last[1] = Math.max(last[1], b);
        else merged.push([a, b]);
    }
    let out = '';
    let pos = 0;
    for (const [a, b] of merged) {
        out += escapeHtml(plain.slice(pos, a)) + '<mark>' + escapeHtml(plain.slice(a, b)) + '</mark>';
        pos = b;
    }
    return out + escapeHtml(plain.slice(pos));
}

function setSearchMessage(text) {
    document.getElementById('dossier-search-results').innerHTML = `<div class="note-empty">${escapeHtml(text)}</div>`;
}

function renderSearchResults(response, terms, allDossiers) {
    const box = document.getElementById('dossier-search-results');
    const { results, total, truncated, dossiers } = response;
    if (!results.length) {
        setSearchMessage(allDossiers ? 'Nothing found in any dossier.' : 'Nothing found in this dossier.');
        return;
    }
    const scope = allDossiers ? `across ${dossiers} dossier${dossiers === 1 ? '' : 's'}` : 'in this dossier';
    const summary = `${total} result${total === 1 ? '' : 's'} ${scope}${truncated ? ` — showing the first ${results.length}` : ''}`;
    box.innerHTML = `<div class="search-summary">${escapeHtml(summary)}</div>` + results.map((r, i) => {
        const where = [allDossiers || r.dossierKey !== currentKey ? r.dossierName : '', r.category ? CATEGORY_LABELS[r.category] : ''].filter(Boolean).join(' · ');
        return `
        <div class="search-hit" data-index="${i}" tabindex="0" role="button">
            <span class="hit-type hit-${r.type}">${HIT_LABELS[r.type]}</span>
            <div class="hit-body">
                <div class="hit-title">${highlight(r.title, terms)}</div>
                ${r.snippet ? `<div class="hit-snippet">${highlight(r.snippet, terms)}</div>` : ''}
                ${where ? `<div class="hit-meta">${escapeHtml(where)}</div>` : ''}
            </div>
        </div>`;
    }).join('');
    box.querySelectorAll('.search-hit').forEach((el) => {
        const open = () => openHit(results[Number(el.dataset.index)]);
        el.addEventListener('click', open);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    box.scrollTop = 0;
}

function runSearch() {
    const root = document.getElementById('dossier-panel-root');
    const query = searchInput().value;
    root.classList.toggle('dossier-searching', query.trim() !== '');
    clearTimeout(searchTimer);
    const seq = ++searchSeq;
    if (query.trim() === '') return;

    const terms = parseTerms(query);
    if (terms.join('').length < MIN_QUERY_LETTERS) return setSearchMessage(`Type at least ${MIN_QUERY_LETTERS} letters to search.`);

    if (!ui.searchAll) {
        // Current dossier: everything is already loaded, so this is instant.
        if (!currentData) return setSearchMessage('This dossier is still loading…');
        const results = sortResults(searchMeta(currentData, terms, currentData.displayName));
        return renderSearchResults({ results, total: results.length, truncated: false, dossiers: 1 }, terms, false);
    }

    // All dossiers: ask the server, after a short pause so typing doesn't fire a request per keystroke.
    setSearchMessage('Searching every dossier…');
    searchTimer = setTimeout(async () => {
        try {
            const response = await api(`/search?q=${encodeURIComponent(query)}&limit=100`);
            if (seq !== searchSeq) return; // a newer query took over
            renderSearchResults(response, terms, true);
        } catch (e) {
            if (seq !== searchSeq) return;
            console.error('[Dossier] Search failed:', e);
            setSearchMessage(/ 404 /.test(e.message)
                ? 'Searching all dossiers needs the updated Dossier server plugin. Restart SillyTavern to load it.'
                : 'Search failed. Check the browser console for details.');
        }
    }, 250);
}

function clearSearch() {
    const input = searchInput();
    if (!input || (input.value === '' && !document.getElementById('dossier-panel-root').classList.contains('dossier-searching'))) return;
    input.value = '';
    searchSeq++;
    clearTimeout(searchTimer);
    document.getElementById('dossier-panel-root').classList.remove('dossier-searching');
    document.getElementById('dossier-search-results').innerHTML = '';
}

function applyScopeButtons() {
    document.getElementById('dossier-scope-this').setAttribute('aria-pressed', String(!ui.searchAll));
    document.getElementById('dossier-scope-all').setAttribute('aria-pressed', String(ui.searchAll));
}

/** Jump to a result: switch dossier if needed, then the right tab, then open the thing itself. */
async function openHit(hit) {
    const root = document.getElementById('dossier-panel-root');
    if (hit.dossierKey !== currentKey) {
        if (!confirmDiscardDraft()) return;
        closeNoteEditor();
        await loadDossier(hit.dossierKey);
    } else if (hit.type === 'note' && !confirmDiscardDraft()) {
        return;
    }
    clearSearch();
    const tab = { note: 'text', image: 'visual', link: 'links', sound: 'sound' }[hit.type];
    root.querySelector(`.tab-btn[data-tab="${tab}"]`).click();

    if (hit.type === 'note') {
        root.querySelector(`.subtab-btn[data-subtab="${hit.category}"]`).click();
        const note = (currentData.notes[hit.category] || []).find((n) => n.id === hit.id);
        if (note) {
            openNoteEditor({ category: hit.category, id: hit.id, note });
            const entry = root.querySelector(`.note-entry[data-id="${hit.id}"]`);
            if (entry) entry.scrollIntoView({ block: 'nearest' });
        }
    } else if (hit.type === 'image') {
        const index = currentData.images.findIndex((i) => i.id === hit.id);
        if (index !== -1) openLightbox(index);
    }
}

function wireSearch(root) {
    const input = root.querySelector('#dossier-search-input');
    input.addEventListener('input', runSearch);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { clearSearch(); input.blur(); } });
    root.querySelector('#dossier-search-clear').addEventListener('click', () => { clearSearch(); input.focus(); });
    const setScope = (all) => {
        ui.searchAll = all;
        saveUi();
        applyScopeButtons();
        if (searchIsActive()) runSearch();
    };
    root.querySelector('#dossier-scope-this').addEventListener('click', () => setScope(false));
    root.querySelector('#dossier-scope-all').addEventListener('click', () => setScope(true));
    applyScopeButtons();
}

// ─────────────────────────── boot ───────────────────────────

function bindCharacterEvents() {
    const ctx = getCtx();
    if (!ctx || !ctx.eventSource || !ctx.event_types) return;
    const reload = () => {
        const root = document.getElementById('dossier-panel-root');
        if (root && root.classList.contains('dossier-visible')) {
            resolveAndLoad();
        } else {
            // Clear cached key so next open re-resolves against the now-current character.
            currentKey = null;
        }
    };
    ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, reload);
}

jQuery(async () => {
    injectPanel();
    injectMenuButton();
    bindCharacterEvents();
});
