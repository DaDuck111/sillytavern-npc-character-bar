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
import {
    applyLoreContentToCharacter,
    getLorebookCatalog,
    getLorebookGroups,
    getLorebookTags,
    setLorebookActive,
    syncLore,
    updateLorebookMeta,
} from './lore.js';
import {
    addNpcToGroup,
    createArchiveGroup,
    deleteArchiveGroup,
    getArchiveSeed,
    getCurrentChatRef,
    getGlobalArchive,
    removeNpcFromGroup,
    renameArchiveGroup,
    setNpcGroups,
    unlinkArchiveFromChat,
    updateArchiveNpcMeta,
} from './globalArchive.js';
import { mountThoughts, renderThoughts, toggleThoughts } from './thoughts.js';
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
let archiveSort = 'name';
let archiveTagFilter = 'all';
let loreSearch = '';
let loreGroupFilter = 'all';
let loreTagFilter = 'all';
let loreActiveFilter = 'all';
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
            <button class="npcb-icon-btn npcb-thoughts-toggle" title="Show/hide NPC thoughts">💭</button>
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
    root.querySelector('.npcb-thoughts-toggle').addEventListener('click', () => toggleThoughts());
    root.querySelector('.npcb-away-toggle').addEventListener('click', async () => {
        await mutateState(state => { state.ui.showAwayOnBar = !state.ui.showAwayOnBar; });
        renderBar();
    });
    root.querySelector('.npcb-card-scroll').addEventListener('click', event => {
        if (event.target.closest('.npcb-card-thought')) {
            event.stopPropagation();
            toggleThoughts(true);
            return;
        }
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
        renderThoughts();
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
                <div class="npcb-card-hp" title="HP ${escapeHtml(character.vitals?.hp ?? 100)} / ${escapeHtml(character.vitals?.maxHp ?? 100)}">
                    <i style="width:${Math.max(0, Math.min(100, ((Number(character.vitals?.hp) || 0) / Math.max(1, Number(character.vitals?.maxHp) || 100)) * 100))}%"></i>
                </div>
                <div class="npcb-card-state">${escapeHtml(character.scene?.action || character.scene?.mood || character.relationship?.label || '')}</div>
            </div>
            ${String(character.scene?.thoughts || '').trim() ? '<span class="npcb-card-thought" role="button" tabindex="0" title="Show NPC thoughts">💭</span>' : ''}
            ${character.relationship?.label && character.relationship.label !== 'Unknown'
                ? `<span class="npcb-relation-badge">${escapeHtml(character.relationship.label)}</span>` : ''}
        </button>`).join('');
    renderThoughts();
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

function renderLoreLibrary(character) {
    const books = getLorebookCatalog();
    const groups = getLorebookGroups();
    const tags = getLorebookTags();
    const needle = loreSearch.trim().toLowerCase();

    const filtered = books.filter(book => {
        if (loreGroupFilter !== 'all' && (book.group || '') !== loreGroupFilter) return false;
        if (loreTagFilter !== 'all' && !(book.tags || []).includes(loreTagFilter)) return false;
        if (loreActiveFilter === 'active' && !book.active) return false;
        if (loreActiveFilter === 'inactive' && book.active) return false;
        if (needle) {
            const hay = [book.name, book.group, ...(book.tags || [])].join(' ').toLowerCase();
            if (!hay.includes(needle)) return false;
        }
        return true;
    });

    return `
        <div class="npcb-lore-link-card">
            <div>
                <small>NPC LOREBOOK</small>
                <strong>${escapeHtml(character.lore?.book || 'Current chat Lorebook')}</strong>
                <span>${character.lore?.uid ? `Entry #${escapeHtml(character.lore.uid)}` : 'No NPC entry linked yet'}</span>
            </div>
            <button class="npcb-primary-btn npcb-lore-sync" type="button">SYNC NPC</button>
        </div>

        <div class="npcb-lore-help">
            <strong>How this works</strong>
            <span>Select a Lorebook below, then Sync NPC. Existing entry → profile refresh. No matching entry → create one from this NPC profile.</span>
        </div>

        <div class="npcb-lore-library-tools">
            <input class="npcb-lore-search" placeholder="Search Lorebooks…" value="${escapeHtml(loreSearch)}">
            <select class="npcb-lore-active-filter">
                <option value="all" ${loreActiveFilter === 'all' ? 'selected' : ''}>All</option>
                <option value="active" ${loreActiveFilter === 'active' ? 'selected' : ''}>Active only</option>
                <option value="inactive" ${loreActiveFilter === 'inactive' ? 'selected' : ''}>Inactive only</option>
            </select>
            <select class="npcb-lore-group-filter">
                <option value="all">All groups</option>
                ${groups.map(group => `<option value="${escapeHtml(group)}" ${loreGroupFilter === group ? 'selected' : ''}>${escapeHtml(group)}</option>`).join('')}
            </select>
            <select class="npcb-lore-tag-filter">
                <option value="all">All tags</option>
                ${tags.map(tag => `<option value="${escapeHtml(tag)}" ${loreTagFilter === tag ? 'selected' : ''}>#${escapeHtml(tag)}</option>`).join('')}
            </select>
        </div>

        <div class="npcb-lore-library">
            ${filtered.length ? filtered.map(book => `
                <article class="npcb-lore-book-card ${book.name === character.lore?.book ? 'selected' : ''}" data-book-name="${escapeHtml(book.name)}">
                    <button class="npcb-lore-use" type="button" title="Use this Lorebook for this NPC">
                        <span class="npcb-lore-radio">${book.name === character.lore?.book ? '●' : '○'}</span>
                        <div>
                            <strong>${escapeHtml(book.name)}</strong>
                            <small>${book.group ? escapeHtml(book.group) : 'Ungrouped'}</small>
                        </div>
                    </button>
                    <div class="npcb-lore-tags">
                        ${(book.tags || []).length ? book.tags.map(tag => `<i>#${escapeHtml(tag)}</i>`).join('') : '<em>No tags</em>'}
                    </div>
                    <label class="npcb-lore-active-switch">
                        <input type="checkbox" ${book.active ? 'checked' : ''}>
                        <span>${book.active ? 'ACTIVE' : 'INACTIVE'}</span>
                    </label>
                    <button class="npcb-lore-organize" type="button">ORGANIZE</button>
                </article>
            `).join('') : '<div class="npcb-muted-box">No Lorebooks match these filters.</div>'}
        </div>

        <div class="npcb-info-strip">
            Raw Lorebook text is intentionally hidden here. SillyTavern still stores it normally; this extension manages that internal text for you.
        </div>
    `;
}

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
            const lore = await syncLore(character, { book: character.lore?.book || '', createIfMissing: false });
            await updateCharacter(id, c => {
                Object.assign(c.lore, lore);
                if (lore.content) applyLoreContentToCharacter(c, lore.content, { overwrite: true });
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

    const allowedTabs = ['overview', 'current', 'lore', 'system'];
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
                ['lore','Lorebook'],
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
                    ${field('Mana', 'vitals.mana', character.vitals?.mana ?? 0, { type: 'number' })}
                    ${field('Max Mana', 'vitals.maxMana', character.vitals?.maxMana ?? 0, { type: 'number' })}
                    ${field('Fatigue', 'vitals.fatigue', character.vitals?.fatigue ?? 0, { type: 'number' })}
                    ${field('Max Fatigue', 'vitals.maxFatigue', character.vitals?.maxFatigue ?? 100, { type: 'number' })}
                    ${field('Relationship value (-100 to 100)', 'relationship.value', character.relationship?.value ?? 0, { type: 'number', wide: true })}
                </div>
            </section>

            <section data-pane="lore" class="${tab === 'lore' ? 'active' : ''}">
                <div class="npcb-section-heading">
                    <div><small>LOREBOOK LIBRARY</small><strong>NPC Lore & Active Books</strong></div>
                    <span>Choose which Lorebook owns this NPC, organize books with groups/tags, and toggle which global Lorebooks are active in SillyTavern.</span>
                </div>
                ${renderLoreLibrary(character)}
            </section>

            <section data-pane="system" class="${tab === 'system' ? 'active' : ''}">
                <div class="npcb-section-heading">
                    <div><small>RPG INTERFACE</small><strong>NPC System Status</strong></div>
                    <span>Detailed RPG stats only exist when the story establishes this NPC has a System.</span>
                </div>

                <label class="npcb-check npcb-system-toggle-card">
                    <input class="npcb-npc-system-toggle" data-field="system.hasSystem" type="checkbox" ${character.system?.hasSystem ? 'checked' : ''}>
                    <span>NPC has a System / detailed status interface <small>(AI can turn this on/off when the story establishes it)</small></span>
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


function bindWorkshopEvents(character, activeTab = 'overview') {
    const root = ensureModalRoot();
    root.querySelector('.npcb-close-btn').addEventListener('click', closeModal);
    root.querySelector('.npcb-back-btn')?.addEventListener('click', async () => {
        await persistWorkshopNow(character.id);
        openArchive();
    });

    root.querySelectorAll('.npcb-workshop-tabs button').forEach(button => button.addEventListener('click', async () => {
        if (button.dataset.tab === activeTab) return;
        await persistWorkshopNow(character.id);
        openWorkshop(character.id, button.dataset.tab);
    }));
    root.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', event => {
        if (['lore.book', 'lore.uid'].includes(event.target.dataset.field)) loreAutoSynced.delete(character.id);
        persistWorkshop();
    }));
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
        openWorkshop(character.id, 'system');
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
            openWorkshop(character.id, 'overview');
            renderBar();
        } catch (error) { toast('error', error.message); }
    });
    root.querySelector('.npcb-clear-portrait').addEventListener('click', async () => {
        await updateCharacter(character.id, c => { c.portrait = ''; });
        openWorkshop(character.id, 'overview');
        renderBar();
    });

    root.querySelector('.npcb-add-npc-system-stat')?.addEventListener('click', async () => {
        await persistWorkshopNow(character.id);
        await updateCharacter(character.id, c => {
            c.system.stats ||= [];
            c.system.stats.push({ id: `npcstat_${Date.now()}`, name: 'Custom Stat', value: 0, max: 100, unit: '', aiTrack: true });
        });
        openWorkshop(character.id, 'system');
    });
    root.querySelectorAll('.npcb-remove-npc-system-stat').forEach(button => {
        button.addEventListener('click', async () => {
            const index = Number(button.closest('[data-system-stat-index]')?.dataset.systemStatIndex);
            if (!Number.isFinite(index)) return;
            await updateCharacter(character.id, c => c.system.stats.splice(index, 1));
            openWorkshop(character.id, 'system');
        });
    });

    const rerenderLore = () => openWorkshop(character.id, 'lore');

    root.querySelector('.npcb-lore-search')?.addEventListener('input', event => {
        loreSearch = event.target.value;
        const caret = event.target.selectionStart;
        rerenderLore();
        requestAnimationFrame(() => {
            const input = ensureModalRoot().querySelector('.npcb-lore-search');
            input?.focus();
            input?.setSelectionRange?.(caret, caret);
        });
    });
    root.querySelector('.npcb-lore-active-filter')?.addEventListener('change', event => {
        loreActiveFilter = event.target.value;
        rerenderLore();
    });
    root.querySelector('.npcb-lore-group-filter')?.addEventListener('change', event => {
        loreGroupFilter = event.target.value;
        rerenderLore();
    });
    root.querySelector('.npcb-lore-tag-filter')?.addEventListener('change', event => {
        loreTagFilter = event.target.value;
        rerenderLore();
    });

    root.querySelectorAll('.npcb-lore-book-card').forEach(card => {
        const name = card.dataset.bookName;
        card.querySelector('.npcb-lore-use')?.addEventListener('click', async () => {
            loreAutoSynced.delete(character.id);
            await updateCharacter(character.id, c => {
                c.lore.book = name;
                c.lore.uid = '';
                c.lore.lastSync = '';
            });

            try {
                const fresh = getState().characters[character.id];
                const result = await syncLore(fresh, { book: name, createIfMissing: false });
                if (result.uid && result.content) {
                    await updateCharacter(character.id, c => {
                        Object.assign(c.lore, result);
                        applyLoreContentToCharacter(c, result.content, { overwrite: true });
                    });
                    loreAutoSynced.add(character.id);
                    toast('success', 'NPC linked and refreshed from Lorebook.');
                }
            } catch (error) {
                console.warn('[NPC Character Bar] Lorebook lookup skipped:', error);
            }
            rerenderLore();
        });

        card.querySelector('.npcb-lore-active-switch input')?.addEventListener('change', async event => {
            await setLorebookActive(name, event.target.checked);
            rerenderLore();
        });

        card.querySelector('.npcb-lore-organize')?.addEventListener('click', () => {
            const catalog = getLorebookCatalog();
            const book = catalog.find(x => x.name === name);
            if (!book) return;
            const group = prompt('Lorebook group / folder (blank = ungrouped)', book.group || '');
            if (group === null) return;
            const tags = prompt('Tags, comma-separated', (book.tags || []).join(', '));
            if (tags === null) return;
            updateLorebookMeta(name, {
                group: group.trim(),
                tags: tags.split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean),
            });
            rerenderLore();
        });
    });

    root.querySelector('.npcb-lore-sync')?.addEventListener('click', async () => {
        try {
            await persistWorkshopNow(character.id);
            const fresh = getState().characters[character.id];
            const result = await syncLore(fresh, { book: fresh.lore?.book || '', createIfMissing: true });
            await updateCharacter(character.id, c => {
                Object.assign(c.lore, result);
                if (!result.created && result.content) applyLoreContentToCharacter(c, result.content, { overwrite: true });
            });
            loreAutoSynced.add(character.id);
            toast('success', result.created ? 'Created NPC Lorebook entry.' : 'NPC profile refreshed from Lorebook.');
            rerenderLore();
        } catch (error) {
            console.error(error);
            toast('error', error.message || 'Lorebook sync failed.');
        }
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

    const groups = Object.values(archive.groups || {}).sort((a, b) => a.name.localeCompare(b.name));
    const tags = [...new Set(Object.values(archive.npcs || {}).flatMap(entry => entry.tags || []))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    const allChats = new Map();
    for (const entry of Object.values(archive.npcs || {})) {
        for (const link of entry.chatLinks || []) allChats.set(link.chatId, link.label || link.chatId);
    }

    const chatOptions = [
        `<option value="all" ${archiveChatFilter === 'all' ? 'selected' : ''}>All chats</option>`,
        `<option value="current" ${archiveChatFilter === 'current' ? 'selected' : ''}>Current chat</option>`,
        ...[...allChats.entries()]
            .filter(([id]) => id !== currentChat.id)
            .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
            .map(([id, label]) => `<option value="${escapeHtml(id)}" ${archiveChatFilter === id ? 'selected' : ''}>${escapeHtml(label)}</option>`),
    ].join('');

    const tagOptions = [
        `<option value="all" ${archiveTagFilter === 'all' ? 'selected' : ''}>All tags</option>`,
        ...tags.map(tag => `<option value="${escapeHtml(tag)}" ${archiveTagFilter === tag ? 'selected' : ''}>#${escapeHtml(tag)}</option>`),
    ].join('');

    root.innerHTML = `
      <div class="npcb-dialog npcb-archive npcb-archive-v2">
        <header class="npcb-dialog-header">
            <div>
                <h2>Character Archive</h2>
                <p>${Object.keys(archive.npcs || {}).length} NPCs · ${escapeHtml(currentChat.kind === 'group' ? `Group chat: ${currentChat.groupLabel || currentChat.label}` : `Chat: ${currentChat.label}`)}</p>
            </div>
            <div class="npcb-spacer"></div>
            <button class="npcb-soft-btn npcb-create-group">＋ Folder</button>
            <button class="npcb-primary-btn npcb-archive-add">＋ Add NPC</button>
            <button class="npcb-close-btn">×</button>
        </header>

        <div class="npcb-archive-layout">
            <aside class="npcb-folder-sidebar">
                <div class="npcb-folder-head">FOLDERS</div>
                <button class="npcb-folder-item ${archiveGroupFilter === 'all' ? 'active' : ''}" data-folder-filter="all">
                    <span>◇</span><strong>All NPCs</strong><small>${Object.keys(archive.npcs || {}).length}</small>
                </button>
                <button class="npcb-folder-item npcb-folder-drop ${archiveGroupFilter === 'ungrouped' ? 'active' : ''}" data-folder-filter="ungrouped" data-drop-group="ungrouped" title="Drop an NPC here to remove it from all folders">
                    <span>○</span><strong>Ungrouped</strong>
                </button>
                <div class="npcb-folder-list">
                    ${groups.map(group => `
                        <div class="npcb-folder-wrap" data-group-id="${escapeHtml(group.id)}">
                            <button class="npcb-folder-item npcb-folder-drop ${archiveGroupFilter === group.id ? 'active' : ''}" data-folder-filter="${escapeHtml(group.id)}" data-drop-group="${escapeHtml(group.id)}">
                                <span>▱</span>
                                <strong>${escapeHtml(group.name)}</strong>
                                <small>${Object.values(archive.npcs || {}).filter(e => (e.groupIds || []).includes(group.id)).length}</small>
                            </button>
                            <button class="npcb-folder-more" title="Folder options">⋯</button>
                        </div>
                    `).join('')}
                </div>
                <div class="npcb-folder-tip">Drag NPC cards onto folders. Drop onto Ungrouped to remove folder memberships.</div>
            </aside>

            <main class="npcb-archive-mainpane">
                <div class="npcb-archive-tools npcb-archive-tools-v2">
                    <input class="npcb-search" placeholder="Search name, role, faction, tag…" value="${escapeHtml(archiveSearch)}">
                    <select class="npcb-archive-sort">
                        <option value="name" ${archiveSort === 'name' ? 'selected' : ''}>Sort: Name</option>
                        <option value="updated" ${archiveSort === 'updated' ? 'selected' : ''}>Sort: Recently updated</option>
                        <option value="relationship" ${archiveSort === 'relationship' ? 'selected' : ''}>Sort: Relationship</option>
                        <option value="scope" ${archiveSort === 'scope' ? 'selected' : ''}>Sort: Scope</option>
                    </select>
                    <select class="npcb-archive-tag-filter">${tagOptions}</select>
                    <select class="npcb-archive-chat-filter">${chatOptions}</select>
                </div>
                <div class="npcb-archive-list"></div>
            </main>
        </div>
      </div>`;

    const scopeAllowsCurrent = entry => {
        if (entry.scope === 'global' || !entry.scope) return true;
        if (entry.scope === 'chat') return entry.scopeRef === currentChat.id;
        if (entry.scope === 'group') return Boolean(currentChat.groupId) && entry.scopeRef === currentChat.groupId;
        return true;
    };

    const renderList = () => {
        const latestLocal = getState();
        const latestArchive = getGlobalArchive();
        const needle = archiveSearch.trim().toLowerCase();

        let entries = Object.values(latestArchive.npcs || {}).filter(entry => {
            const groupIds = entry.groupIds || [];
            if (archiveGroupFilter === 'ungrouped' && groupIds.length) return false;
            if (archiveGroupFilter !== 'all' && archiveGroupFilter !== 'ungrouped' && !groupIds.includes(archiveGroupFilter)) return false;

            if (archiveTagFilter !== 'all' && !(entry.tags || []).includes(archiveTagFilter)) return false;

            if (archiveChatFilter === 'current' && !(entry.chatLinks || []).some(link => link.chatId === currentChat.id)) return false;
            if (archiveChatFilter !== 'all' && archiveChatFilter !== 'current' && !(entry.chatLinks || []).some(link => link.chatId === archiveChatFilter)) return false;

            if (needle) {
                const haystack = [
                    entry.name, entry.role, entry.faction,
                    ...(entry.aliases || []),
                    ...(entry.tags || []),
                    ...(entry.groupIds || []).map(id => latestArchive.groups?.[id]?.name || ''),
                    ...(entry.chatLinks || []).map(link => link.label || ''),
                ].join(' ').toLowerCase();
                if (!haystack.includes(needle)) return false;
            }
            return true;
        });

        entries.sort((a, b) => {
            if (archiveSort === 'updated') return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
            if (archiveSort === 'relationship') return (Number(b.relationship?.value) || 0) - (Number(a.relationship?.value) || 0);
            if (archiveSort === 'scope') return String(a.scope || 'global').localeCompare(String(b.scope || 'global')) || a.name.localeCompare(b.name);
            return a.name.localeCompare(b.name);
        });

        const list = root.querySelector('.npcb-archive-list');
        list.innerHTML = entries.length ? entries.map(entry => {
            const local = Object.values(latestLocal.characters).find(c => c.archiveId === entry.id);
            const linkedHere = Boolean(local || (entry.chatLinks || []).some(link => link.chatId === currentChat.id));
            const allowedHere = scopeAllowsCurrent(entry);
            const folderNames = (entry.groupIds || []).map(id => latestArchive.groups?.[id]).filter(Boolean);
            const hp = Math.max(0, Math.min(100, ((Number(entry.vitals?.hp) || 0) / Math.max(1, Number(entry.vitals?.maxHp) || 100)) * 100));
            const scopeLabel = entry.scope === 'chat' ? 'CHAT' : entry.scope === 'group' ? 'GROUP CHAT' : 'GLOBAL';

            return `
                <article class="npcb-archive-card" draggable="true" data-archive-id="${escapeHtml(entry.id)}" data-local-id="${escapeHtml(local?.id || '')}">
                    <div class="npcb-archive-card-main">
                        <div class="npcb-archive-avatar-wrap">
                            ${avatarHtml(entry)}
                            <div class="npcb-archive-hp"><i style="width:${hp}%"></i></div>
                        </div>
                        <div class="npcb-archive-card-text">
                            <div class="npcb-archive-name-line">
                                <strong>${escapeHtml(entry.name)}</strong>
                                <span class="npcb-scope-badge scope-${escapeHtml(entry.scope || 'global')}">${scopeLabel}</span>
                                ${entry.system?.hasSystem ? '<span class="npcb-system-badge">SYSTEM</span>' : ''}
                            </div>
                            <span>${escapeHtml(entry.role || entry.faction || 'NPC')}</span>
                            <div class="npcb-archive-chips">
                                ${folderNames.map(group => `<button class="group" data-remove-group="${escapeHtml(group.id)}" title="Remove from folder">${escapeHtml(group.name)} ×</button>`).join('')}
                                ${(entry.tags || []).map(tag => `<i class="tag">#${escapeHtml(tag)}</i>`).join('')}
                            </div>
                        </div>
                    </div>

                    <div class="npcb-archive-card-controls">
                        <label>
                            <span>SCOPE</span>
                            <select class="npcb-scope-select">
                                <option value="global" ${(entry.scope || 'global') === 'global' ? 'selected' : ''}>Global</option>
                                <option value="chat" ${entry.scope === 'chat' ? 'selected' : ''}>This chat only</option>
                                ${currentChat.groupId ? `<option value="group" ${entry.scope === 'group' ? 'selected' : ''}>This group chat</option>` : ''}
                            </select>
                        </label>
                        <label class="npcb-auto-insert" title="When AI detects this same NPC in an allowed chat, reuse the archived NPC automatically">
                            <input type="checkbox" ${entry.autoInsert ? 'checked' : ''}> AUTO-LINK
                        </label>
                        <button data-action="tags">TAGS</button>
                        <button data-action="link" ${!linkedHere && !allowedHere ? 'disabled title="Scope blocks this chat"' : ''}>${linkedHere ? 'UNLINK' : 'LINK HERE'}</button>
                        <button data-action="open" ${local ? '' : 'disabled'}>OPEN</button>
                    </div>
                </article>`;
        }).join('') : '<div class="npcb-muted-box">No NPCs match the current archive filters.</div>';

        list.querySelectorAll('.npcb-archive-card').forEach(card => {
            const archiveId = card.dataset.archiveId;
            const localId = card.dataset.localId;

            card.addEventListener('dragstart', event => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/npcb-archive-id', archiveId);
                event.dataTransfer.setData('text/plain', archiveId);
                card.classList.add('dragging');
            });
            card.addEventListener('dragend', () => card.classList.remove('dragging'));

            card.querySelectorAll('[data-remove-group]').forEach(chip => chip.addEventListener('click', event => {
                event.stopPropagation();
                removeNpcFromGroup(archiveId, chip.dataset.removeGroup);
                openArchive();
            }));

            card.querySelector('.npcb-scope-select')?.addEventListener('change', event => {
                const scope = event.target.value;
                updateArchiveNpcMeta(archiveId, {
                    scope,
                    scopeRef: scope === 'chat' ? currentChat.id : scope === 'group' ? currentChat.groupId : '',
                });
                openArchive();
            });

            card.querySelector('.npcb-auto-insert input')?.addEventListener('change', event => {
                updateArchiveNpcMeta(archiveId, { autoInsert: event.target.checked });
            });

            card.querySelector('[data-action="tags"]')?.addEventListener('click', event => {
                event.stopPropagation();
                const entry = getGlobalArchive().npcs[archiveId];
                const value = prompt('Tags, comma-separated', (entry?.tags || []).join(', '));
                if (value === null) return;
                updateArchiveNpcMeta(archiveId, {
                    tags: value.split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean),
                });
                openArchive();
            });

            card.querySelector('[data-action="open"]')?.addEventListener('click', event => {
                event.stopPropagation();
                if (localId) openWorkshop(localId);
            });

            card.querySelector('[data-action="link"]')?.addEventListener('click', async event => {
                event.stopPropagation();
                const latest = getGlobalArchive().npcs[archiveId];
                if (!latest) return;
                const isLinked = (latest.chatLinks || []).some(link => link.chatId === currentChat.id);

                if (isLinked) {
                    if (localId) await deleteCharacter(localId);
                    else unlinkArchiveFromChat(archiveId, currentChat.id);
                    renderBar();
                    openArchive();
                    return;
                }

                if (!scopeAllowsCurrent(latest)) {
                    toast('error', 'This NPC scope does not allow linking into the current chat.');
                    return;
                }
                const seed = getArchiveSeed(archiveId);
                if (!seed) return;
                const character = await addCharacter(seed);
                toast('success', `${character.name} linked to the current chat.`);
                renderBar();
                openArchive();
            });
        });

        root.querySelectorAll('.npcb-folder-drop').forEach(folder => {
            if (folder.dataset.dropBound === '1') return;
            folder.dataset.dropBound = '1';
            folder.addEventListener('dragover', event => {
                event.preventDefault();
                folder.classList.add('drag-over');
                event.dataTransfer.dropEffect = 'move';
            });
            folder.addEventListener('dragleave', () => folder.classList.remove('drag-over'));
            folder.addEventListener('drop', event => {
                event.preventDefault();
                folder.classList.remove('drag-over');
                const archiveId = event.dataTransfer.getData('text/npcb-archive-id') || event.dataTransfer.getData('text/plain');
                if (!archiveId) return;
                const groupId = folder.dataset.dropGroup;
                if (groupId === 'ungrouped') setNpcGroups(archiveId, []);
                else addNpcToGroup(archiveId, groupId);
                openArchive();
            });
        });
    };

    renderList();

    root.querySelector('.npcb-close-btn').addEventListener('click', closeModal);
    root.querySelector('.npcb-archive-add').addEventListener('click', async () => { closeModal(); await addNpcFlow(); });
    root.querySelector('.npcb-create-group').addEventListener('click', () => {
        const name = prompt('New folder name');
        if (!name?.trim()) return;
        const group = createArchiveGroup(name.trim());
        if (group) archiveGroupFilter = group.id;
        openArchive();
    });

    root.querySelectorAll('[data-folder-filter]').forEach(button => button.addEventListener('click', event => {
        if (event.target.closest('.npcb-folder-more')) return;
        archiveGroupFilter = button.dataset.folderFilter;
        openArchive();
    }));

    root.querySelectorAll('.npcb-folder-more').forEach(button => button.addEventListener('click', event => {
        event.stopPropagation();
        const groupId = button.closest('[data-group-id]')?.dataset.groupId;
        const group = getGlobalArchive().groups[groupId];
        if (!group) return;
        const action = prompt(`Folder: ${group.name}\nType "rename" or "delete"`, 'rename');
        if (!action) return;
        if (action.trim().toLowerCase() === 'rename') {
            const name = prompt('New folder name', group.name);
            if (name?.trim()) renameArchiveGroup(groupId, name.trim());
        } else if (action.trim().toLowerCase() === 'delete') {
            if (confirm(`Delete folder "${group.name}"? NPCs will remain in the archive.`)) {
                deleteArchiveGroup(groupId);
                if (archiveGroupFilter === groupId) archiveGroupFilter = 'all';
            }
        }
        openArchive();
    }));

    root.querySelector('.npcb-search').addEventListener('input', event => {
        archiveSearch = event.target.value;
        renderList();
    });
    root.querySelector('.npcb-archive-sort').addEventListener('change', event => {
        archiveSort = event.target.value;
        renderList();
    });
    root.querySelector('.npcb-archive-tag-filter').addEventListener('change', event => {
        archiveTagFilter = event.target.value;
        renderList();
    });
    root.querySelector('.npcb-archive-chat-filter').addEventListener('change', event => {
        archiveChatFilter = event.target.value;
        renderList();
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
    mountThoughts();
    renderBar();
}
