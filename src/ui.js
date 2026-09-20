import {
    STATUS,
    addCharacter,
    deleteCharacter,
    getState,
    importRoster,
    mutateState,
    saveState,
    updateCharacter,
} from './store.js';
import { buildLoreContent, pullLore, pushLore } from './lore.js';
import {
    createArchiveGroup,
    getArchiveSeed,
    getCurrentChatRef,
    getGlobalArchive,
    setNpcGroups,
    unlinkArchiveFromChat,
} from './globalArchive.js';
import {
    debounce,
    downloadJson,
    escapeHtml,
    imageFileToDataUrl,
    toast,
} from './utils.js';

const ROOT_ID = 'npcb-root';
const MODAL_ID = 'npcb-modal-root';
let currentCharacterId = null;
let archiveSearch = '';
let archiveGroupFilter = 'all';
let archiveChatFilter = 'all';

function statusIcon(status) {
    return {
        present: '●', nearby: '◉', away: '○', unknown: '?', missing: '◇', dead: '†', inactive: '–',
    }[status] || '○';
}

function statusLabel(status) {
    return status.charAt(0).toUpperCase() + status.slice(1);
}

function initials(name = '?') {
    return name.trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || '?';
}

function avatarHtml(character, cls = '') {
    if (character.portrait) {
        return `<img class="npcb-avatar ${cls}" src="${escapeHtml(character.portrait)}" alt="${escapeHtml(character.name)}">`;
    }
    return `<div class="npcb-avatar npcb-avatar-fallback ${cls}">${escapeHtml(initials(character.name))}</div>`;
}

function barCharacters(state) {
    return state.order
        .map(id => state.characters[id])
        .filter(Boolean)
        .filter(c => ['present', 'nearby'].includes(c.status) || state.ui.showAwayOnBar);
}

function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement('section');
    root.id = ROOT_ID;
    root.className = 'npcb-shell';
    root.innerHTML = `
        <div class="npcb-topline">
            <button class="npcb-icon-btn npcb-collapse-btn" title="Collapse/expand character bar">⌃</button>
            <button class="npcb-icon-btn npcb-archive-btn" title="Character archive">☷</button>
            <div class="npcb-heading">
                <span class="npcb-title">Characters</span>
                <span class="npcb-count"></span>
            </div>
            <div class="npcb-spacer"></div>
            <button class="npcb-icon-btn npcb-away-toggle" title="Show/hide absent characters">◌</button>
            <button class="npcb-icon-btn npcb-add-btn" title="Add NPC">＋</button>
        </div>
        <div class="npcb-card-scroll"></div>`;

    const sendForm = document.querySelector('#send_form');
    const chat = document.querySelector('#chat');
    if (sendForm?.parentNode) sendForm.parentNode.insertBefore(root, sendForm);
    else if (chat?.parentNode) chat.parentNode.insertBefore(root, chat.nextSibling);
    else document.body.appendChild(root);

    root.querySelector('.npcb-collapse-btn').addEventListener('click', () => {
        root.classList.toggle('npcb-collapsed');
        const button = root.querySelector('.npcb-collapse-btn');
        button.textContent = root.classList.contains('npcb-collapsed') ? '⌄' : '⌃';
    });
    root.querySelector('.npcb-add-btn').addEventListener('click', addNpcFlow);
    root.querySelector('.npcb-archive-btn').addEventListener('click', openArchive);
    root.querySelector('.npcb-away-toggle').addEventListener('click', async () => {
        await mutateState(state => { state.ui.showAwayOnBar = !state.ui.showAwayOnBar; });
        renderBar();
    });
    root.querySelector('.npcb-card-scroll').addEventListener('click', event => {
        const card = event.target.closest('.npcb-card');
        if (card?.dataset.id) openWorkshop(card.dataset.id);
    });
    root.querySelector('.npcb-card-scroll').addEventListener('contextmenu', event => {
        const card = event.target.closest('.npcb-card');
        if (!card?.dataset.id) return;
        event.preventDefault();
        openContextMenu(card.dataset.id, event.clientX, event.clientY);
    });

    return root;
}

export function renderBar() {
    const root = ensureRoot();
    const state = getState();
    root.classList.toggle('npcb-compact', Boolean(state.ui.compact));
    root.querySelector('.npcb-away-toggle').classList.toggle('active', Boolean(state.ui.showAwayOnBar));

    const chars = barCharacters(state);
    root.querySelector('.npcb-count').textContent = `${chars.filter(c => ['present', 'nearby'].includes(c.status)).length} active / ${state.order.length} saved`;
    const scroller = root.querySelector('.npcb-card-scroll');

    if (!chars.length) {
        scroller.innerHTML = `
            <button class="npcb-empty" type="button">
                <span>＋</span>
                <strong>Add your first NPC</strong>
                <small>Saved per chat. Click to create.</small>
            </button>`;
        scroller.querySelector('.npcb-empty').addEventListener('click', addNpcFlow);
        return;
    }

    scroller.innerHTML = chars.map(character => `
        <button class="npcb-card status-${escapeHtml(character.status)}" data-id="${escapeHtml(character.id)}" type="button">
            <div class="npcb-avatar-wrap">
                ${avatarHtml(character)}
                <span class="npcb-status-dot" title="${escapeHtml(statusLabel(character.status))}">${statusIcon(character.status)}</span>
            </div>
            <div class="npcb-card-body">
                <div class="npcb-card-name">${escapeHtml(character.name)}</div>
                <div class="npcb-card-meta">${escapeHtml(character.role || character.faction || statusLabel(character.status))}</div>
                <div class="npcb-card-state">${escapeHtml(character.scene?.action || character.scene?.mood || character.relationship?.label || '')}</div>
            </div>
            ${character.relationship?.label && character.relationship.label !== 'Unknown'
                ? `<span class="npcb-relation-badge">${escapeHtml(character.relationship.label)}</span>` : ''}
        </button>`).join('');
}

async function addNpcFlow() {
    const name = window.prompt('NPC name');
    if (!name?.trim()) return;
    const character = await addCharacter({ name: name.trim(), status: 'present' });
    renderBar();
    openWorkshop(character.id);
}

function ensureModalRoot() {
    let root = document.getElementById(MODAL_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = MODAL_ID;
        root.className = 'npcb-modal-root';
        root.addEventListener('mousedown', event => {
            if (event.target === root) closeModal();
        });
        document.body.appendChild(root);
    }
    return root;
}

function closeModal() {
    const root = ensureModalRoot();
    root.classList.remove('open');
    root.innerHTML = '';
    currentCharacterId = null;
}

function field(label, key, value = '', options = {}) {
    const type = options.type || 'text';
    const hint = options.hint ? `<small>${escapeHtml(options.hint)}</small>` : '';
    if (type === 'textarea') {
        return `<label class="npcb-field ${options.wide ? 'wide' : ''}">
            <span>${escapeHtml(label)}</span>
            <textarea data-field="${escapeHtml(key)}" rows="${options.rows || 4}" placeholder="${escapeHtml(options.placeholder || '')}">${escapeHtml(value)}</textarea>
            ${hint}
        </label>`;
    }
    if (type === 'select') {
        return `<label class="npcb-field ${options.wide ? 'wide' : ''}">
            <span>${escapeHtml(label)}</span>
            <select data-field="${escapeHtml(key)}">${(options.items || []).map(item => `<option value="${escapeHtml(item)}" ${item === value ? 'selected' : ''}>${escapeHtml(statusLabel(item))}</option>`).join('')}</select>
            ${hint}
        </label>`;
    }
    return `<label class="npcb-field ${options.wide ? 'wide' : ''}">
        <span>${escapeHtml(label)}</span>
        <input data-field="${escapeHtml(key)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(options.placeholder || '')}">
        ${hint}
    </label>`;
}

function readPath(obj, path) {
    return path.split('.').reduce((acc, part) => acc?.[part], obj);
}

function writePath(obj, path, value) {
    const parts = path.split('.');
    let cursor = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        cursor[parts[i]] ||= {};
        cursor = cursor[parts[i]];
    }
    cursor[parts.at(-1)] = value;
}

const persistWorkshop = debounce(async () => {
    const root = ensureModalRoot();
    if (!currentCharacterId || !root.classList.contains('open')) return;
    const form = root.querySelector('.npcb-workshop');
    if (!form) return;

    await updateCharacter(currentCharacterId, character => {
        form.querySelectorAll('[data-field]').forEach(input => {
            let value = input.type === 'checkbox' ? input.checked : input.value;
            if (input.dataset.field === 'aliases') {
                character.aliases = value.split(',').map(x => x.trim()).filter(Boolean);
                return;
            }
            if (input.dataset.field === 'knowledge') {
                character.knowledge = value.split('\n').map(x => x.trim()).filter(Boolean);
                return;
            }
            writePath(character, input.dataset.field, value);
        });
    });
    renderBar();
}, 350);

export function openWorkshop(id, tab = 'identity') {
    const state = getState();
    const character = state.characters[id];
    if (!character) return;
    currentCharacterId = id;
    const root = ensureModalRoot();
    root.classList.add('open');
    root.innerHTML = `
      <div class="npcb-dialog npcb-workshop">
        <header class="npcb-dialog-header">
            <div class="npcb-workshop-avatar">${avatarHtml(character, 'large')}</div>
            <div>
                <h2>${escapeHtml(character.name)}</h2>
                <p>${escapeHtml(character.role || 'NPC')} · ${escapeHtml(statusLabel(character.status))}</p>
            </div>
            <div class="npcb-spacer"></div>
            <button class="npcb-danger-btn npcb-delete-character" title="Delete NPC">Delete</button>
            <button class="npcb-close-btn" title="Close">×</button>
        </header>

        <nav class="npcb-tabs">
            ${[['identity','Identity'],['profile','Profile'],['state','Scene'],['relations','Relations'],['memory','Memory'],['lore','Lorebook']]
                .map(([key,label]) => `<button data-tab="${key}" class="${key === tab ? 'active' : ''}">${label}</button>`).join('')}
        </nav>

        <div class="npcb-tab-content">
            <section data-pane="identity" class="${tab === 'identity' ? 'active' : ''}">
                <div class="npcb-portrait-editor">
                    <div class="npcb-portrait-preview">${avatarHtml(character, 'preview')}</div>
                    <div class="npcb-portrait-actions">
                        ${field('Portrait URL / data URI', 'portrait', character.portrait, { wide: true, placeholder: 'https://…' })}
                        <label class="npcb-file-btn">Upload image<input type="file" accept="image/*" class="npcb-portrait-file"></label>
                        <button type="button" class="npcb-soft-btn npcb-clear-portrait">Clear portrait</button>
                    </div>
                </div>
                <div class="npcb-form-grid">
                    ${field('Name', 'name', character.name)}
                    ${field('Aliases', 'aliases', character.aliases.join(', '), { placeholder: 'nickname, title, alternate name' })}
                    ${field('Role', 'role', character.role)}
                    ${field('Faction', 'faction', character.faction)}
                    ${field('Roster status', 'status', character.status, { type: 'select', items: STATUS })}
                </div>
            </section>

            <section data-pane="profile" class="${tab === 'profile' ? 'active' : ''}">
                <div class="npcb-form-grid">
                    ${field('Age', 'profile.age', character.profile.age)}
                    ${field('Gender', 'profile.gender', character.profile.gender)}
                    ${field('Appearance', 'profile.appearance', character.profile.appearance, { type: 'textarea', rows: 5, wide: true })}
                    ${field('Personality', 'profile.personality', character.profile.personality, { type: 'textarea', rows: 5, wide: true })}
                    ${field('Background', 'profile.background', character.profile.background, { type: 'textarea', rows: 6, wide: true })}
                    ${field('Goals', 'profile.goals', character.profile.goals, { type: 'textarea', rows: 4, wide: true })}
                    ${field('Secrets', 'profile.secrets', character.profile.secrets, { type: 'textarea', rows: 4, wide: true })}
                </div>
            </section>

            <section data-pane="state" class="${tab === 'state' ? 'active' : ''}">
                <div class="npcb-info-strip">Scene fields are temporary state. They are excluded from Lorebook sync unless you explicitly enable it.</div>
                <div class="npcb-form-grid">
                    ${field('Location', 'scene.location', character.scene.location)}
                    ${field('Mood', 'scene.mood', character.scene.mood)}
                    ${field('Condition', 'scene.condition', character.scene.condition)}
                    ${field('Current action', 'scene.action', character.scene.action)}
                    ${field('Clothing', 'scene.clothing', character.scene.clothing, { type: 'textarea', rows: 3, wide: true })}
                    ${field('Internal thoughts', 'scene.thoughts', character.scene.thoughts, { type: 'textarea', rows: 5, wide: true })}
                </div>
            </section>

            <section data-pane="relations" class="${tab === 'relations' ? 'active' : ''}">
                <div class="npcb-form-grid">
                    ${field('Relationship label', 'relationship.label', character.relationship.label, { placeholder: 'Friend / Rival / Neutral…' })}
                    ${field('Relationship details', 'relationship.detail', character.relationship.detail, { type: 'textarea', rows: 5, wide: true })}
                    ${field('Knowledge / secrets known', 'knowledge', character.knowledge.join('\n'), { type: 'textarea', rows: 8, wide: true, hint: 'One fact per line.' })}
                </div>
            </section>

            <section data-pane="memory" class="${tab === 'memory' ? 'active' : ''}">
                <div class="npcb-memory-toolbar">
                    <button class="npcb-primary-btn npcb-add-memory" type="button">＋ Add memory</button>
                </div>
                <div class="npcb-memory-list">
                    ${renderMemories(character)}
                </div>
                <div class="npcb-form-grid">
                    ${field('Private notes', 'notes', character.notes, { type: 'textarea', rows: 8, wide: true })}
                </div>
            </section>

            <section data-pane="lore" class="${tab === 'lore' ? 'active' : ''}">
                <div class="npcb-info-strip">Persistent profile data is safe to sync. Current scene state is off by default.</div>
                <div class="npcb-form-grid">
                    ${field('Lorebook', 'lore.book', character.lore.book, { placeholder: 'Leave blank to use chat Lorebook' })}
                    ${field('Entry UID', 'lore.uid', character.lore.uid, { placeholder: 'Created automatically on first Push' })}
                    <label class="npcb-check wide"><input data-field="lore.includeScene" type="checkbox" ${character.lore.includeScene ? 'checked' : ''}> Include current scene state in generated Lorebook content</label>
                    ${field('Lorebook content', 'lore.content', character.lore.content || buildLoreContent(character), { type: 'textarea', rows: 15, wide: true })}
                </div>
                <div class="npcb-lore-actions">
                    <button class="npcb-soft-btn npcb-lore-rebuild" type="button">Rebuild from profile</button>
                    <button class="npcb-primary-btn npcb-lore-push" type="button">Push → Lorebook</button>
                    <button class="npcb-soft-btn npcb-lore-pull" type="button">Pull ← Lorebook</button>
                </div>
                <div class="npcb-sync-time">${character.lore.lastSync ? `Last sync: ${escapeHtml(character.lore.lastSync)}` : 'Not synced yet.'}</div>
            </section>
        </div>
      </div>`;

    bindWorkshopEvents(character);
}

function renderMemories(character) {
    if (!character.memories.length) return `<div class="npcb-muted-box">No memories saved yet.</div>`;
    return character.memories.map((memory, index) => {
        const text = typeof memory === 'string' ? memory : memory.text || '';
        const date = typeof memory === 'object' ? memory.date || '' : '';
        return `<div class="npcb-memory-row" data-memory-index="${index}">
            <input class="npcb-memory-date" value="${escapeHtml(date)}" placeholder="Day / date">
            <textarea class="npcb-memory-text" rows="2" placeholder="What happened?">${escapeHtml(text)}</textarea>
            <button class="npcb-icon-btn npcb-remove-memory" type="button">×</button>
        </div>`;
    }).join('');
}

function bindWorkshopEvents(character) {
    const root = ensureModalRoot();
    root.querySelector('.npcb-close-btn').addEventListener('click', closeModal);
    root.querySelectorAll('.npcb-tabs button').forEach(button => button.addEventListener('click', () => {
        root.querySelectorAll('.npcb-tabs button').forEach(x => x.classList.toggle('active', x === button));
        root.querySelectorAll('[data-pane]').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === button.dataset.tab));
    }));
    root.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', persistWorkshop));
    root.querySelectorAll('[data-field]').forEach(input => input.addEventListener('change', persistWorkshop));

    root.querySelector('.npcb-delete-character').addEventListener('click', async () => {
        if (!confirm(`Delete ${character.name} from this chat's Character Archive?`)) return;
        await deleteCharacter(character.id);
        closeModal();
        renderBar();
    });

    const fileInput = root.querySelector('.npcb-portrait-file');
    fileInput.addEventListener('change', async () => {
        try {
            const dataUrl = await imageFileToDataUrl(fileInput.files?.[0]);
            await updateCharacter(character.id, c => { c.portrait = dataUrl; });
            toast('success', 'Portrait saved.');
            openWorkshop(character.id, 'identity');
            renderBar();
        } catch (error) { toast('error', error.message); }
    });
    root.querySelector('.npcb-clear-portrait').addEventListener('click', async () => {
        await updateCharacter(character.id, c => { c.portrait = ''; });
        openWorkshop(character.id, 'identity');
        renderBar();
    });

    root.querySelector('.npcb-add-memory').addEventListener('click', async () => {
        await updateCharacter(character.id, c => c.memories.push({ date: '', text: '' }));
        openWorkshop(character.id, 'memory');
    });
    root.querySelectorAll('.npcb-memory-row').forEach(row => {
        const index = Number(row.dataset.memoryIndex);
        row.querySelector('.npcb-remove-memory').addEventListener('click', async () => {
            await updateCharacter(character.id, c => c.memories.splice(index, 1));
            openWorkshop(character.id, 'memory');
        });
        const saveMemory = debounce(async () => {
            await updateCharacter(character.id, c => {
                c.memories[index] = {
                    date: row.querySelector('.npcb-memory-date').value,
                    text: row.querySelector('.npcb-memory-text').value,
                };
            });
        }, 300);
        row.querySelector('.npcb-memory-date').addEventListener('input', saveMemory);
        row.querySelector('.npcb-memory-text').addEventListener('input', saveMemory);
    });

    root.querySelector('.npcb-lore-rebuild').addEventListener('click', async () => {
        await persistWorkshopNow(character.id);
        const fresh = getState().characters[character.id];
        await updateCharacter(character.id, c => { c.lore.content = buildLoreContent(fresh); });
        openWorkshop(character.id, 'lore');
    });
    root.querySelector('.npcb-lore-push').addEventListener('click', async () => {
        try {
            await persistWorkshopNow(character.id);
            const fresh = getState().characters[character.id];
            const lore = await pushLore(fresh);
            await updateCharacter(character.id, c => Object.assign(c.lore, lore));
            toast('success', `Synced ${fresh.name} to Lorebook.`);
            openWorkshop(character.id, 'lore');
        } catch (error) { console.error(error); toast('error', error.message || 'Lorebook sync failed.'); }
    });
    root.querySelector('.npcb-lore-pull').addEventListener('click', async () => {
        try {
            await persistWorkshopNow(character.id);
            const fresh = getState().characters[character.id];
            const lore = await pullLore(fresh);
            await updateCharacter(character.id, c => Object.assign(c.lore, lore));
            toast('success', `Loaded Lorebook entry for ${fresh.name}.`);
            openWorkshop(character.id, 'lore');
        } catch (error) { console.error(error); toast('error', error.message || 'Lorebook pull failed.'); }
    });
}

async function persistWorkshopNow(id) {
    const root = ensureModalRoot();
    const form = root.querySelector('.npcb-workshop');
    if (!form) return;
    await updateCharacter(id, character => {
        form.querySelectorAll('[data-field]').forEach(input => {
            const value = input.type === 'checkbox' ? input.checked : input.value;
            if (input.dataset.field === 'aliases') {
                character.aliases = String(value).split(',').map(x => x.trim()).filter(Boolean);
            } else if (input.dataset.field === 'knowledge') {
                character.knowledge = String(value).split('\n').map(x => x.trim()).filter(Boolean);
            } else {
                writePath(character, input.dataset.field, value);
            }
        });
    });
}

export function openArchive() {
    const localState = getState();
    const archive = getGlobalArchive();
    const currentChat = getCurrentChatRef();
    const root = ensureModalRoot();
    currentCharacterId = null;
    root.classList.add('open');

    const allChats = new Map();
    for (const entry of Object.values(archive.npcs || {})) {
        for (const link of entry.chatLinks || []) {
            allChats.set(link.chatId, link.label || link.chatId);
        }
    }

    const groups = Object.values(archive.groups || {}).sort((a, b) => a.name.localeCompare(b.name));
    const groupOptions = [
        '<option value="all">All groups</option>',
        '<option value="ungrouped">Ungrouped</option>',
        ...groups.map(group => `<option value="${escapeHtml(group.id)}" ${archiveGroupFilter === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`),
    ].join('');

    const chatOptions = [
        '<option value="all">All chats</option>',
        `<option value="current" ${archiveChatFilter === 'current' ? 'selected' : ''}>Current chat</option>`,
        ...[...allChats.entries()]
            .filter(([id]) => id !== currentChat.id)
            .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
            .map(([id, label]) => `<option value="${escapeHtml(id)}" ${archiveChatFilter === id ? 'selected' : ''}>${escapeHtml(label)}</option>`),
    ].join('');

    root.innerHTML = `
      <div class="npcb-dialog npcb-archive npcb-global-archive">
        <header class="npcb-dialog-header">
            <div>
                <h2>Global Character Archive</h2>
                <p>${Object.keys(archive.npcs || {}).length} NPCs across linked chats · current: ${escapeHtml(currentChat.label)}</p>
            </div>
            <div class="npcb-spacer"></div>
            <button class="npcb-soft-btn npcb-create-group">＋ Group</button>
            <button class="npcb-primary-btn npcb-archive-add">＋ Add NPC</button>
            <button class="npcb-close-btn">×</button>
        </header>
        <div class="npcb-archive-tools npcb-global-tools">
            <input class="npcb-search" placeholder="Search name, alias, role, faction…" value="${escapeHtml(archiveSearch)}">
            <select class="npcb-archive-group-filter">${groupOptions}</select>
            <select class="npcb-archive-chat-filter">${chatOptions}</select>
            <button class="npcb-soft-btn npcb-export">Export current chat</button>
            <label class="npcb-file-btn">Import<input type="file" accept="application/json,.json" class="npcb-import-file"></label>
        </div>
        <div class="npcb-archive-list"></div>
      </div>`;

    const renderList = () => {
        const latestLocal = getState();
        const latestArchive = getGlobalArchive();
        const chat = getCurrentChatRef();
        const needle = archiveSearch.trim().toLowerCase();

        const entries = Object.values(latestArchive.npcs || {}).filter(entry => {
            if (needle && ![
                entry.name, entry.role, entry.faction,
                ...(entry.aliases || []),
                ...(entry.chatLinks || []).map(x => x.label),
                ...(entry.groupIds || []).map(id => latestArchive.groups?.[id]?.name || ''),
            ].join(' ').toLowerCase().includes(needle)) return false;

            if (archiveGroupFilter === 'ungrouped' && (entry.groupIds || []).length) return false;
            if (archiveGroupFilter !== 'all' && archiveGroupFilter !== 'ungrouped' && !(entry.groupIds || []).includes(archiveGroupFilter)) return false;

            if (archiveChatFilter === 'current' && !(entry.chatLinks || []).some(link => link.chatId === chat.id)) return false;
            if (archiveChatFilter !== 'all' && archiveChatFilter !== 'current' && !(entry.chatLinks || []).some(link => link.chatId === archiveChatFilter)) return false;
            return true;
        }).sort((a, b) => a.name.localeCompare(b.name));

        const list = root.querySelector('.npcb-archive-list');
        list.innerHTML = entries.length ? entries.map(entry => {
            const local = Object.values(latestLocal.characters).find(c => c.archiveId === entry.id);
            const linkedHere = Boolean(local || (entry.chatLinks || []).some(link => link.chatId === chat.id));
            const groupNames = (entry.groupIds || []).map(id => latestArchive.groups?.[id]?.name).filter(Boolean);
            const chatLabels = (entry.chatLinks || []).map(link => link.label || link.chatId).filter(Boolean);
            return `
                <div class="npcb-archive-row npcb-global-row" data-archive-id="${escapeHtml(entry.id)}" data-local-id="${escapeHtml(local?.id || '')}">
                    ${avatarHtml(entry)}
                    <div class="npcb-archive-main">
                        <strong>${escapeHtml(entry.name)}</strong>
                        <span>${escapeHtml(entry.role || entry.faction || 'NPC')}</span>
                        <div class="npcb-archive-chips">
                            ${groupNames.map(name => `<i class="group">${escapeHtml(name)}</i>`).join('')}
                            ${chatLabels.slice(0, 3).map(name => `<i class="chat">${escapeHtml(name)}</i>`).join('')}
                            ${chatLabels.length > 3 ? `<i>+${chatLabels.length - 3}</i>` : ''}
                        </div>
                    </div>
                    <div class="npcb-global-row-actions">
                        <button data-action="groups">GROUPS</button>
                        <button data-action="link">${linkedHere ? 'UNLINK CHAT' : 'LINK CHAT'}</button>
                        <button data-action="open" ${local ? '' : 'disabled'}>OPEN</button>
                    </div>
                </div>`;
        }).join('') : '<div class="npcb-muted-box">No archived characters match these filters.</div>';

        list.querySelectorAll('.npcb-global-row').forEach(row => {
            const archiveId = row.dataset.archiveId;
            const localId = row.dataset.localId;

            row.querySelector('[data-action="open"]')?.addEventListener('click', event => {
                event.stopPropagation();
                if (localId) openWorkshop(localId);
            });

            row.querySelector('[data-action="link"]')?.addEventListener('click', async event => {
                event.stopPropagation();
                const latest = getGlobalArchive().npcs[archiveId];
                if (!latest) return;
                const isLinked = (latest.chatLinks || []).some(link => link.chatId === getCurrentChatRef().id);

                if (isLinked) {
                    if (localId && confirm('Unlink this NPC from the current chat? The global archive entry will remain.')) {
                        await deleteCharacter(localId);
                    }
                    unlinkArchiveFromChat(archiveId, getCurrentChatRef().id);
                    renderBar();
                    openArchive();
                    return;
                }

                const seed = getArchiveSeed(archiveId);
                if (!seed) return;
                const character = await addCharacter(seed);
                toast('success', `${character.name} linked to the current chat.`);
                renderBar();
                openArchive();
            });

            row.querySelector('[data-action="groups"]')?.addEventListener('click', event => {
                event.stopPropagation();
                const latest = getGlobalArchive();
                const entry = latest.npcs[archiveId];
                if (!entry) return;
                const currentNames = (entry.groupIds || []).map(id => latest.groups?.[id]?.name).filter(Boolean);
                const available = Object.values(latest.groups || {}).map(g => g.name).sort();
                const answer = prompt(
                    `Group names for ${entry.name}, comma-separated.\nAvailable: ${available.join(', ') || '(none — type a new name)'}`,
                    currentNames.join(', '),
                );
                if (answer === null) return;
                const wantedNames = [...new Set(answer.split(',').map(x => x.trim()).filter(Boolean))];
                const fresh = getGlobalArchive();
                const ids = [];
                for (const name of wantedNames) {
                    let group = Object.values(fresh.groups || {}).find(g => g.name.toLowerCase() === name.toLowerCase());
                    if (!group) group = createArchiveGroup(name);
                    if (group?.id) ids.push(group.id);
                }
                setNpcGroups(archiveId, ids);
                openArchive();
            });
        });
    };

    renderList();

    root.querySelector('.npcb-close-btn').addEventListener('click', closeModal);
    root.querySelector('.npcb-archive-add').addEventListener('click', async () => { closeModal(); await addNpcFlow(); });
    root.querySelector('.npcb-create-group').addEventListener('click', () => {
        const name = prompt('New NPC group name');
        if (!name?.trim()) return;
        const group = createArchiveGroup(name.trim());
        if (group) archiveGroupFilter = group.id;
        openArchive();
    });
    root.querySelector('.npcb-search').addEventListener('input', event => {
        archiveSearch = event.target.value;
        renderList();
    });
    root.querySelector('.npcb-archive-group-filter').addEventListener('change', event => {
        archiveGroupFilter = event.target.value;
        openArchive();
    });
    root.querySelector('.npcb-archive-chat-filter').addEventListener('change', event => {
        archiveChatFilter = event.target.value;
        openArchive();
    });
    root.querySelector('.npcb-export').addEventListener('click', () => downloadJson('npc-character-bar-current-chat.json', getState()));
    root.querySelector('.npcb-import-file').addEventListener('change', async event => {
        try {
            const file = event.target.files?.[0];
            if (!file) return;
            const parsed = JSON.parse(await file.text());
            await importRoster(parsed);
            toast('success', 'Character roster imported into current chat and global archive.');
            renderBar();
            openArchive();
        } catch (error) { toast('error', `Import failed: ${error.message}`); }
    });
}

function openContextMenu(id, x, y) {
    document.querySelector('.npcb-context-menu')?.remove();
    const character = getState().characters[id];
    if (!character) return;
    const menu = document.createElement('div');
    menu.className = 'npcb-context-menu';
    menu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 300)}px`;
    menu.innerHTML = `
        <button data-action="open">Open workshop</button>
        <div class="npcb-menu-label">Set status</div>
        ${STATUS.map(status => `<button data-status="${status}" class="${status === character.status ? 'active' : ''}">${statusIcon(status)} ${statusLabel(status)}</button>`).join('')}
        <div class="npcb-menu-sep"></div>
        <button data-action="delete" class="danger">Delete NPC</button>`;
    document.body.appendChild(menu);

    menu.addEventListener('click', async event => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.action === 'open') openWorkshop(id);
        if (button.dataset.status) {
            await updateCharacter(id, c => { c.status = button.dataset.status; });
            renderBar();
        }
        if (button.dataset.action === 'delete' && confirm(`Delete ${character.name}?`)) {
            await deleteCharacter(id);
            renderBar();
        }
        menu.remove();
    });
    setTimeout(() => document.addEventListener('mousedown', () => menu.remove(), { once: true }), 0);
}

export function mountUI() {
    ensureRoot();
    renderBar();
}
