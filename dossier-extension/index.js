// Dossier — a per-character (or standalone) workspace for notes, links,
// reference images, and audio clips, backed by the dossier-server plugin.

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
                <span class="dossier-title" id="dossier-title" title="Dossier">Loading…</span>
                <button class="btn-icon" id="dossier-rename-btn" aria-label="Rename dossier" title="Rename dossier">✎</button>
                <div class="dossier-switcher" id="dossier-switcher"></div>
            </div>
            <div class="dossier-topbar-actions">
                <button class="btn-new" id="dossier-new-btn" title="Create new dossier">+ New</button>
                <button class="btn-icon" id="dossier-close-btn" aria-label="Close dossier panel" title="Close">✕</button>
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
            <button class="btn-primary" id="dossier-add-image-btn">Add Image</button>
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
    </div>
    <div class="dossier-lightbox" id="dossier-lightbox"><img id="dossier-lightbox-img" src="" alt="" /></div>
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
    makeDraggable(root, root.querySelector('#dossier-drag-handle'));
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

function makeDraggable(root, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return; // don't drag when clicking a button in the bar
        dragging = true;
        const rect = root.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        root.style.left = `${e.clientX - offsetX}px`;
        root.style.top = `${e.clientY - offsetY}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
}

// ─────────────────────────── tab / subtab switching ───────────────────────────

function wireStaticEvents(root) {
    root.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
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

    root.querySelector('#dossier-lightbox').addEventListener('click', (e) => {
        if (e.target.id === 'dossier-lightbox') closeLightbox();
    });

    // ── notes ──
    root.querySelector('#dossier-add-note-btn').addEventListener('click', () => openNoteEditor(null));
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

function openSwitcher() {
    const sw = document.getElementById('dossier-switcher');
    if (sw.classList.contains('open')) {
        sw.classList.remove('open');
        return;
    }
    api('/list').then((list) => {
        sw.innerHTML = list.map((d) =>
            `<div class="dossier-switcher-item" data-key="${d.key}">${escapeHtml(d.displayName)}${d.boundCharacter ? '' : ' <span style="opacity:.5">(standalone)</span>'}</div>`
        ).join('') || '<div class="dossier-switcher-item" style="opacity:.6">No dossiers yet</div>';
        sw.querySelectorAll('.dossier-switcher-item[data-key]').forEach((el) => {
            el.addEventListener('click', () => {
                loadDossier(el.dataset.key);
                sw.classList.remove('open');
            });
        });
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

    grid.querySelectorAll('.vis-thumb').forEach((thumb) => {
        const id = thumb.dataset.id;
        thumb.addEventListener('click', (e) => {
            if (e.target.closest('.del-overlay')) return;
            openLightbox(`${API_BASE}/${currentKey}/images/${id}/file`);
        });
        thumb.querySelector('.del-overlay').addEventListener('click', () => deleteImage(id));
    });
}

function openLightbox(src) {
    const box = document.getElementById('dossier-lightbox');
    document.getElementById('dossier-lightbox-img').src = src;
    box.classList.add('open');
}
function closeLightbox() {
    document.getElementById('dossier-lightbox').classList.remove('open');
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
                    <div class="note-snippet">${escapeHtml((n.content || '').slice(0, 90))}</div>
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
                const note = currentData.notes[cat].find((n) => n.id === id);
                openNoteEditor({ category: cat, id, note });
            });
            entry.querySelector('.btn-danger-icon').addEventListener('click', () => deleteNote(cat, id));
        });
    }
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

function openNoteEditor(edit) {
    editingNote = edit;
    const box = document.getElementById('dossier-note-editor');
    const titleInput = document.getElementById('dossier-note-title-input');
    const contentInput = document.getElementById('dossier-note-content-input');
    titleInput.value = edit ? edit.note.title : '';
    contentInput.value = edit ? edit.note.content : '';
    box.classList.add('open');
    titleInput.focus();
}
function closeNoteEditor() {
    editingNote = null;
    document.getElementById('dossier-note-editor').classList.remove('open');
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
