import {
    CORE_ATTRIBUTES,
    STATUS,
    addCharacter,
    deleteCharacter,
    getState,
    importRoster,
    mutateState,
    saveState,
    updateCharacter,
} from './store.js';
import { applyLoreContentToCharacter, buildLoreContent, pullLore, pushLore } from './lore.js';
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
const loreAutoSynced = new Set();

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
            if (input.type === 'number') value = Number(value) || 0;
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

async function autoHydrateProfileFromLore(id, tab) {
    if (loreAutoSynced.has(id)) return;
    const character = getState().characters[id];
    if (!character) return;

    const hasLocalLore = Boolean(character.lore?.content?.trim());
    const canPull = Boolean(character.lore?.uid?.trim());
    if (!hasLocalLore && !canPull) return;

    loreAutoSynced.add(id);
    try {
        if (canPull) {
            const lore = await pullLore(character);
            await updateCharacter(id, c => {
                Object.assign(c.lore, lore);
                applyLoreContentToCharacter(c, lore.content, { overwrite: true });
            });
        } else {
            await updateCharacter(id, c => {
                applyLoreContentToCharacter(c, c.lore?.content || '', { overwrite: true });
            });
        }

        if (currentCharacterId === id && ensureModalRoot().classList.contains('open')) {
            openWorkshop(id, tab);
        }
    } catch (error) {
        console.warn('[NPC Character Bar] Lore profile auto-sync skipped:', error);
    }
}

export function openWorkshop(id, tab = 'overview') {
    const state = getState();
    const character = state.characters[id];
    if (!character) return;

    const allowedTabs = ['overview', 'current', 'memory', 'system'];
    if (!allowedTabs.includes(tab)) tab = 'overview';

    currentCharacterId = id;
    const root = ensureModalRoot();
    root.classList.add('open');

    const loreStatus = character.lore?.uid
        ? (character.lore?.lastSync ? `Lore synced ${escapeHtml(new Date(character.lore.lastSync).toLocaleString())}` : 'Lorebook linked')
        : character.lore?.content
            ? 'Local Lore content'
            : 'No Lorebook link';

    root.innerHTML = `
      <div class="npcb-dialog npcb-workshop npcb-workshop-v2">
        <header class="npcb-dialog-header npcb-workshop-header">
            <button class="npcb-back-btn" type="button" title="Back to Character Archive">← Back</button>
            <div class="npcb-workshop-avatar">${avatarHtml(character, 'large')}</div>
            <div class="npcb-workshop-title">
                <h2>${escapeHtml(character.name)}</h2>
                <p>${escapeHtml(character.role || 'NPC')} · ${escapeHtml(statusLabel(character.status))}</p>
                <small>${loreStatus}</small>
            </div>
            <div class="npcb-spacer"></div>
            <button class="npcb-danger-btn npcb-delete-character" type="button" title="Delete NPC from current chat">Delete</button>
            <button class="npcb-close-btn" type="button" title="Close">×</button>
        </header>

        <nav class="npcb-tabs npcb-workshop-tabs">
            ${[
                ['overview','Overview'],
                ['current','Current'],
                ['memory','Memory & Lore'],
                ['system','System'],
            ].map(([key,label]) => `<button type="button" data-tab="${key}" class="${key === tab ? 'active' : ''}">${label}</button>`).join('')}
        </nav>

        <div class="npcb-workshop-scroll">
            <section data-pane="overview" class="${tab === 'overview' ? 'active' : ''}">
                <div class="npcb-section-heading">
                    <div><small>IDENTITY</small><strong>Character Profile</strong></div>
                    <span>AI fills missing facts from RP; structured Lorebook fields override when synced.</span>
                </div>

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
                    ${field('Age', 'profile.age', character.profile.age)}
                    ${field('Gender', 'profile.gender', character.profile.gender)}
                    ${field('Appearance', 'profile.appearance', character.profile.appearance, { type: 'textarea', rows: 3, wide: true })}
                    ${field('Personality', 'profile.personality', character.profile.personality, { type: 'textarea', rows: 3, wide: true })}
                    ${field('Background', 'profile.background', character.profile.background, { type: 'textarea', rows: 4, wide: true })}
                    ${field('Goals', 'profile.goals', character.profile.goals, { type: 'textarea', rows: 3, wide: true })}
                    ${field('Secrets', 'profile.secrets', character.profile.secrets, { type: 'textarea', rows: 3, wide: true })}
                    ${field('Relationship', 'relationship.label', character.relationship.label, { placeholder: 'Friend / Rival / Neutral…' })}
                    ${field('Relationship details', 'relationship.detail', character.relationship.detail, { type: 'textarea', rows: 3, wide: true })}
                    ${field('Knowledge / secrets known', 'knowledge', character.knowledge.join('\n'), { type: 'textarea', rows: 5, wide: true, hint: 'One fact per line.' })}
                </div>
            </section>

            <section data-pane="current" class="${tab === 'current' ? 'active' : ''}">
                <div class="npcb-section-heading">
                    <div><small>LIVE STATE</small><strong>Current Scene & Vitals</strong></div>
                    <span>Temporary state updates automatically from roleplay.</span>
                </div>
                <div class="npcb-form-grid">
                    ${field('Location', 'scene.location', character.scene.location)}
                    ${field('Mood', 'scene.mood', character.scene.mood)}
                    ${field('Condition', 'scene.condition', character.scene.condition)}
                    ${field('Current action', 'scene.action', character.scene.action)}
                    ${field('Clothing', 'scene.clothing', character.scene.clothing, { type: 'textarea', rows: 3, wide: true })}
                    ${field('Internal thoughts', 'scene.thoughts', character.scene.thoughts, { type: 'textarea', rows: 4, wide: true })}
                    ${field('HP', 'vitals.hp', character.vitals?.hp ?? 100, { type: 'number' })}
                    ${field('Max HP', 'vitals.maxHp', character.vitals?.maxHp ?? 100, { type: 'number' })}
                    ${field('Fatigue', 'vitals.fatigue', character.vitals?.fatigue ?? 0, { type: 'number' })}
                    ${field('Max Fatigue', 'vitals.maxFatigue', character.vitals?.maxFatigue ?? 100, { type: 'number' })}
                    ${field('Relationship value (-100 to 100)', 'relationship.value', character.relationship?.value ?? 0, { type: 'number', wide: true })}
                </div>
            </section>

            <section data-pane="memory" class="${tab === 'memory' ? 'active' : ''}">
                <div class="npcb-section-heading">
                    <div><small>CONTINUITY</small><strong>Memory & Lorebook</strong></div>
                    <span>Lorebook sync is token-free; structured labels hydrate this profile directly.</span>
                </div>

                <div class="npcb-memory-toolbar">
                    <button class="npcb-primary-btn npcb-add-memory" type="button">＋ Add memory</button>
                    <button class="npcb-soft-btn npcb-lore-pull" type="button">Pull Lore → Profile</button>
                    <button class="npcb-soft-btn npcb-lore-push" type="button">Push Profile → Lore</button>
                </div>
                <div class="npcb-memory-list">${renderMemories(character)}</div>
                <div class="npcb-form-grid">
                    ${field('Private notes', 'notes', character.notes, { type: 'textarea', rows: 5, wide: true })}
                    ${field('Lorebook', 'lore.book', character.lore.book, { placeholder: 'Blank = current chat Lorebook' })}
                    ${field('Entry UID', 'lore.uid', character.lore.uid, { placeholder: 'Created on first Push' })}
                </div>

                <details class="npcb-lore-details">
                    <summary>Raw Lorebook content</summary>
                    <div class="npcb-form-grid">
                        <label class="npcb-check wide"><input data-field="lore.includeScene" type="checkbox" ${character.lore.includeScene ? 'checked' : ''}> Include current scene state when rebuilding Lore content</label>
                        ${field('Lore content', 'lore.content', character.lore.content || buildLoreContent(character), { type: 'textarea', rows: 12, wide: true })}
                    </div>
                    <div class="npcb-lore-actions">
                        <button class="npcb-soft-btn npcb-lore-rebuild" type="button">Rebuild from profile</button>
                    </div>
                </details>
                <div class="npcb-sync-time">${character.lore.lastSync ? `Last sync: ${escapeHtml(character.lore.lastSync)}` : 'Not synced yet.'}</div>
            </section>

            <section data-pane="system" class="${tab === 'system' ? 'active' : ''}">
                <div class="npcb-section-heading">
                    <div><small>RPG INTERFACE</small><strong>NPC System Status</strong></div>
                    <span>Detailed RPG stats only exist when the story establishes this NPC has a System.</span>
                </div>

                <label class="npcb-check npcb-system-toggle-card">
                    <input class="npcb-npc-system-toggle" data-field="system.hasSystem" type="checkbox" ${character.system?.hasSystem ? 'checked' : ''}>
                    <span>This NPC has a System / detailed status interface</span>
                </label>

                ${character.system?.hasSystem ? `
                    <div class="npcb-system-npc-sheet">
                        <div class="npcb-form-grid">
                            ${field('System Level', 'system.level', character.system.level ?? 1, { type: 'number' })}
                            ${field('System XP', 'system.xp', character.system.xp ?? 0, { type: 'number' })}
                            ${field('XP to next level', 'system.xpToNext', character.system.xpToNext ?? 100, { type: 'number' })}
                        </div>
                        <div class="npcb-npc-attribute-editor">
                            ${CORE_ATTRIBUTES.map(key => `
                                <label>
                                    <span>${key}</span>
                                    <input data-field="system.attributes.${key}" type="number" min="0" value="${escapeHtml(character.system.attributes?.[key] ?? 0)}">
                                </label>
                            `).join('')}
                        </div>
                        <div class="npcb-system-section-head">
                            <span>CUSTOM SYSTEM STATS</span>
                            <button class="npcb-add-npc-system-stat" type="button">＋ ADD STAT</button>
                        </div>
                        <div class="npcb-npc-system-stat-list">
                            ${character.system.stats?.length ? character.system.stats.map((stat, index) => `
                                <div class="npcb-npc-system-stat-row" data-system-stat-index="${index}">
                                    <input data-field="system.stats.${index}.name" value="${escapeHtml(stat.name)}" placeholder="Stat">
                                    <input data-field="system.stats.${index}.value" type="number" value="${escapeHtml(stat.value)}" placeholder="Value">
                                    <span>/</span>
                                    <input data-field="system.stats.${index}.max" type="number" value="${escapeHtml(stat.max)}" placeholder="Max">
                                    <input data-field="system.stats.${index}.unit" value="${escapeHtml(stat.unit || '')}" placeholder="Unit">
                                    <button class="npcb-remove-npc-system-stat" type="button">×</button>
                                </div>
                            `).join('') : '<div class="npcb-muted-box">No custom System stats yet.</div>'}
                        </div>
                    </div>
                ` : '<div class="npcb-system-locked npcb-npc-system-locked"><strong>DETAILED STATUS LOCKED</strong><span>Enable only when the story establishes a System.</span></div>'}
            </section>
        </div>
      </div>`;

    bindWorkshopEvents(character, tab);
    setTimeout(() => autoHydrateProfileFromLore(id, tab), 0);
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

    root.querySelector('.npcb-npc-system-toggle')?.addEventListener('change', async event => {
        const enabled = event.target.checked;
        await updateCharacter(character.id, c => {
            c.system ||= {};
            c.system.hasSystem = enabled;
            if (enabled) {
                c.system.level = Math.max(1, Number(c.system.level) || 1);
                c.system.xp = Math.max(0, Number(c.system.xp) || 0);
                c.system.xpToNext = Math.max(1, Number(c.system.xpToNext) || 100);
                c.system.attributes ||= {};
                if (CORE_ATTRIBUTES.every(key => !Number(c.system.attributes[key]))) {
                    c.system.attributes = Object.fromEntries(CORE_ATTRIBUTES.map(key => [key, 10]));
                }
                c.system.stats ||= [];
            } else {
                c.system.level = 0;
                c.system.xp = 0;
                c.system.xpToNext = 0;
                c.system.attributes = Object.fromEntries(CORE_ATTRIBUTES.map(key => [key, 0]));
                c.system.stats = [];
            }
        });
        openWorkshop(character.id, 'stats');
    });

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

    root.querySelector('.npcb-add-npc-system-stat')?.addEventListener('click', async () => {
        await persistWorkshopNow(character.id);
        await updateCharacter(character.id, c => {
            c.system.stats ||= [];
            c.system.stats.push({ id: `npcstat_${Date.now()}`, name: 'Custom Stat', value: 0, max: 100, unit: '', aiTrack: true });
        });
        openWorkshop(character.id, 'stats');
    });
    root.querySelectorAll('.npcb-remove-npc-system-stat').forEach(button => {
        button.addEventListener('click', async () => {
            const index = Number(button.closest('[data-system-stat-index]')?.dataset.systemStatIndex);
            if (!Number.isFinite(index)) return;
            await updateCharacter(character.id, c => c.system.stats.splice(index, 1));
            openWorkshop(character.id, 'stats');
        });
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
            let value = input.type === 'checkbox' ? input.checked : input.value;
            if (input.type === 'number') value = Number(value) || 0;
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
        `<option value="all" ${archiveGroupFilter === 'all' ? 'selected' : ''}>All groups</option>`,
        `<option value="ungrouped" ${archiveGroupFilter === 'ungrouped' ? 'selected' : ''}>Ungrouped</option>`,
        ...groups.map(group => `<option value="${escapeHtml(group.id)}" ${archiveGroupFilter === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`),
    ].join('');

    const chatOptions = [
        `<option value="all" ${archiveChatFilter === 'all' ? 'selected' : ''}>All chats</option>`,
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
