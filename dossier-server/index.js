const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Everything lives inside this plugin's own folder, under storage/.
// This keeps the plugin fully self-contained — no dependency on ST's
// internal user/data directory layout, so it won't break across ST updates.
const STORAGE_ROOT = path.join(__dirname, 'storage');
const INDEX_PATH = path.join(STORAGE_ROOT, 'index.json');

const ALLOWED_CATEGORIES = ['canon', 'headcanon', 'altverse', 'samples'];

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function slugify(input) {
    return String(input)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 60) || 'dossier';
}

function newId() {
    return crypto.randomBytes(8).toString('hex');
}

function loadIndex() {
    ensureDir(STORAGE_ROOT);
    if (!fs.existsSync(INDEX_PATH)) {
        const fresh = { dossiers: {}, characterMap: {} };
        fs.writeFileSync(INDEX_PATH, JSON.stringify(fresh, null, 2));
        return fresh;
    }
    try {
        return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    } catch (e) {
        console.error('[Dossier] Failed to parse index.json, resetting.', e);
        const fresh = { dossiers: {}, characterMap: {} };
        fs.writeFileSync(INDEX_PATH, JSON.stringify(fresh, null, 2));
        return fresh;
    }
}

function saveIndex(idx) {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2));
}

function dossierDir(key) {
    return path.join(STORAGE_ROOT, key);
}

function metaPath(key) {
    return path.join(dossierDir(key), 'meta.json');
}

function loadMeta(key) {
    const p = metaPath(key);
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        console.error(`[Dossier] Failed to parse meta.json for ${key}`, e);
        return null;
    }
}

function saveMeta(key, meta) {
    ensureDir(dossierDir(key));
    fs.writeFileSync(metaPath(key), JSON.stringify(meta, null, 2));
}

function createDossier(displayName, boundCharacter) {
    const idx = loadIndex();
    let key = slugify(displayName || boundCharacter || 'dossier');
    // avoid collisions
    let suffix = 1;
    let candidate = key;
    while (idx.dossiers[candidate]) {
        suffix += 1;
        candidate = `${key}-${suffix}`;
    }
    key = candidate;

    const meta = {
        key,
        displayName: displayName || 'Untitled Dossier',
        boundCharacter: boundCharacter || null,
        createdAt: new Date().toISOString(),
        notes: { canon: [], headcanon: [], altverse: [], samples: [] },
        links: [],
        sounds: [],
        images: [],
    };

    ensureDir(path.join(dossierDir(key), 'sounds'));
    ensureDir(path.join(dossierDir(key), 'images'));
    saveMeta(key, meta);

    idx.dossiers[key] = { displayName: meta.displayName, boundCharacter: meta.boundCharacter };
    if (boundCharacter) idx.characterMap[boundCharacter] = key;
    saveIndex(idx);

    return meta;
}

function getExt(originalName, fallback) {
    const ext = path.extname(originalName || '').replace('.', '');
    return ext || fallback;
}

// SillyTavern mounts a global multer (`.single('avatar')`) on every request
// before plugin routers run. It parses multipart bodies itself, saves the file
// to ST's uploads folder and sets req.file — and it rejects any other field
// name with "Unexpected field". So clients must send the file as `avatar`,
// and we move that already-saved temp file into our own storage here rather
// than running a second multer (which could never see the consumed body).
function storeUpload(req, key, subdir, defaultExt) {
    const id = newId();
    const filename = `${id}.${getExt(req.file.originalname, defaultExt)}`;
    const dir = path.join(dossierDir(key), subdir);
    ensureDir(dir);
    // copy + unlink instead of rename: ST's uploads dir may be on another device
    fs.copyFileSync(req.file.path, path.join(dir, filename));
    fs.rmSync(req.file.path, { force: true });
    return { id, filename };
}

/**
 * @param {import('express').Router} router
 */
async function init(router) {
    ensureDir(STORAGE_ROOT);
    loadIndex();

    // ── resolve or auto-create a dossier for the current character ──
    router.get('/resolve', (req, res) => {
        const character = req.query.character ? String(req.query.character) : null;
        const name = req.query.name ? String(req.query.name) : null;

        if (!character) {
            // No character open — use/create a standing "General" dossier.
            const idx = loadIndex();
            if (idx.dossiers['general']) {
                return res.json({ key: 'general', ...idx.dossiers['general'] });
            }
            const meta = createDossier('General', null);
            return res.json({ key: meta.key, displayName: meta.displayName, boundCharacter: null });
        }

        const idx = loadIndex();
        const existingKey = idx.characterMap[character];
        if (existingKey && idx.dossiers[existingKey]) {
            return res.json({ key: existingKey, ...idx.dossiers[existingKey] });
        }

        const meta = createDossier(name || character, character);
        return res.json({ key: meta.key, displayName: meta.displayName, boundCharacter: meta.boundCharacter });
    });

    // ── list all dossiers (for the switcher dropdown) ──
    router.get('/list', (req, res) => {
        const idx = loadIndex();
        const list = Object.entries(idx.dossiers).map(([key, v]) => ({ key, ...v }));
        res.json(list);
    });

    // ── explicitly create a new (optionally standalone) dossier ──
    router.post('/create', (req, res) => {
        const { displayName, boundCharacter } = req.body || {};
        if (!displayName) return res.status(400).json({ error: 'displayName is required' });
        const meta = createDossier(displayName, boundCharacter || null);
        res.json({ key: meta.key, displayName: meta.displayName, boundCharacter: meta.boundCharacter });
    });

    // ── fetch full dossier data ──
    router.get('/:key', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!meta) return res.status(404).json({ error: 'Dossier not found' });
        res.json(meta);
    });

    // ── rename a dossier ──
    router.patch('/:key', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!meta) return res.status(404).json({ error: 'Dossier not found' });
        const { displayName } = req.body || {};
        if (displayName) meta.displayName = displayName;
        saveMeta(req.params.key, meta);

        const idx = loadIndex();
        if (idx.dossiers[req.params.key]) {
            idx.dossiers[req.params.key].displayName = meta.displayName;
            saveIndex(idx);
        }
        res.json(meta);
    });

    // ── notes ──
    router.post('/:key/notes', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!meta) return res.status(404).json({ error: 'Dossier not found' });
        const { category, title, content } = req.body || {};
        if (!ALLOWED_CATEGORIES.includes(category)) {
            return res.status(400).json({ error: 'Invalid category' });
        }
        const note = {
            id: newId(),
            title: title || 'Untitled note',
            content: content || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        meta.notes[category].unshift(note);
        saveMeta(req.params.key, meta);
        res.json(note);
    });

    router.put('/:key/notes/:category/:noteId', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!meta) return res.status(404).json({ error: 'Dossier not found' });
        const { category, noteId } = req.params;
        if (!ALLOWED_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
        const note = meta.notes[category].find((n) => n.id === noteId);
        if (!note) return res.status(404).json({ error: 'Note not found' });
        const { title, content } = req.body || {};
        if (title !== undefined) note.title = title;
        if (content !== undefined) note.content = content;
        note.updatedAt = new Date().toISOString();
        saveMeta(req.params.key, meta);
        res.json(note);
    });

    router.delete('/:key/notes/:category/:noteId', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!meta) return res.status(404).json({ error: 'Dossier not found' });
        const { category, noteId } = req.params;
        if (!ALLOWED_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
        meta.notes[category] = meta.notes[category].filter((n) => n.id !== noteId);
        saveMeta(req.params.key, meta);
        res.json({ success: true });
    });

    // ── links ──
    router.post('/:key/links', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!meta) return res.status(404).json({ error: 'Dossier not found' });
        const { url, label } = req.body || {};
        if (!url) return res.status(400).json({ error: 'url is required' });
        let derivedLabel = label;
        if (!derivedLabel) {
            try {
                derivedLabel = new URL(url).hostname.replace(/^www\./, '');
            } catch {
                derivedLabel = url;
            }
        }
        const link = { id: newId(), url, label: derivedLabel, createdAt: new Date().toISOString() };
        meta.links.unshift(link);
        saveMeta(req.params.key, meta);
        res.json(link);
    });

    router.patch('/:key/links/:linkId', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!meta) return res.status(404).json({ error: 'Dossier not found' });
        const link = meta.links.find((l) => l.id === req.params.linkId);
        if (!link) return res.status(404).json({ error: 'Link not found' });
        const { label } = req.body || {};
        if (label !== undefined) link.label = label;
        saveMeta(req.params.key, meta);
        res.json(link);
    });

    router.delete('/:key/links/:linkId', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!meta) return res.status(404).json({ error: 'Dossier not found' });
        meta.links = meta.links.filter((l) => l.id !== req.params.linkId);
        saveMeta(req.params.key, meta);
        res.json({ success: true });
    });

    // ── sounds ──
    router.post('/:key/sounds', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!req.file) return res.status(400).json({ error: 'No file uploaded (expected multipart field "avatar")' });
        if (!meta) {
            fs.rmSync(req.file.path, { force: true });
            return res.status(404).json({ error: 'Dossier not found' });
        }

        const { id, filename } = storeUpload(req, req.params.key, 'sounds', 'webm');

        const entry = {
            id,
            filename,
            originalName: req.body.originalName || req.file.originalname || filename,
            duration: req.body.duration ? Number(req.body.duration) : null,
            createdAt: new Date().toISOString(),
        };
        meta.sounds.unshift(entry);
        saveMeta(req.params.key, meta);
        res.json(entry);
    });

    router.get('/:key/sounds/:soundId/file', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!meta) return res.status(404).end();
        const entry = meta.sounds.find((s) => s.id === req.params.soundId);
        if (!entry) return res.status(404).end();
        const filePath = path.join(dossierDir(req.params.key), 'sounds', entry.filename);
        if (!fs.existsSync(filePath)) return res.status(404).end();
        res.sendFile(filePath);
    });

    router.delete('/:key/sounds/:soundId', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!meta) return res.status(404).json({ error: 'Dossier not found' });
        const entry = meta.sounds.find((s) => s.id === req.params.soundId);
        if (entry) {
            const filePath = path.join(dossierDir(req.params.key), 'sounds', entry.filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        meta.sounds = meta.sounds.filter((s) => s.id !== req.params.soundId);
        saveMeta(req.params.key, meta);
        res.json({ success: true });
    });

    // ── images ──
    router.post('/:key/images', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!req.file) return res.status(400).json({ error: 'No file uploaded (expected multipart field "avatar")' });
        if (!meta) {
            fs.rmSync(req.file.path, { force: true });
            return res.status(404).json({ error: 'Dossier not found' });
        }

        const { id, filename } = storeUpload(req, req.params.key, 'images', 'png');

        const entry = {
            id,
            filename,
            originalName: req.body.originalName || req.file.originalname || filename,
            label: req.body.label || (req.body.originalName || '').replace(/\.[^.]+$/, ''),
            createdAt: new Date().toISOString(),
        };
        meta.images.unshift(entry);
        saveMeta(req.params.key, meta);
        res.json(entry);
    });

    router.get('/:key/images/:imageId/file', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!meta) return res.status(404).end();
        const entry = meta.images.find((i) => i.id === req.params.imageId);
        if (!entry) return res.status(404).end();
        const filePath = path.join(dossierDir(req.params.key), 'images', entry.filename);
        if (!fs.existsSync(filePath)) return res.status(404).end();
        res.sendFile(filePath);
    });

    router.delete('/:key/images/:imageId', (req, res) => {
        const meta = loadMeta(req.params.key);
        if (!meta) return res.status(404).json({ error: 'Dossier not found' });
        const entry = meta.images.find((i) => i.id === req.params.imageId);
        if (entry) {
            const filePath = path.join(dossierDir(req.params.key), 'images', entry.filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        meta.images = meta.images.filter((i) => i.id !== req.params.imageId);
        saveMeta(req.params.key, meta);
        res.json({ success: true });
    });

    console.log('[Dossier] Server plugin loaded. Storage at:', STORAGE_ROOT);
}

async function exit() {
    // Nothing to tear down — plain filesystem storage, no open handles.
}

const info = {
    id: 'dossier-server',
    name: 'Dossier Storage Server',
    description: 'Backend storage for the Dossier extension.',
};

module.exports = { init, exit, info };
