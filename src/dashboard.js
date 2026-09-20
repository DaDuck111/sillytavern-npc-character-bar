import { CORE_ATTRIBUTES, getState, mutateState } from './store.js';
import { scanLatestRoleplay } from './autoTracker.js';
import { openArchive, openWorkshop, renderBar } from './ui.js';
import { escapeHtml, getContext, uid } from './utils.js';

const ID = 'npcb-dashboard';
const TOGGLE_ID = 'npcb-dashboard-toggle';

let activeTab = 'status';
let inventoryTab = 'person';
let activeStorageId = '';
let trackerStatus = { status: 'idle', message: 'Waiting for roleplay.' };
let listenersInstalled = false;

const DASH_PREF_KEY = 'npc_character_bar_dashboard_v2';
const TAB_DEFS = Object.freeze({
    status: 'STATUS',
    inventory: 'ITEMS',
    quests: 'QUESTS',
    skills: 'SKILLS',
    npc: 'NPC',
    events: 'EVENTS',
    tracker: 'SYSTEM',
});
const DEFAULT_TAB_ORDER = Object.freeze(Object.keys(TAB_DEFS));

function getDashboardPrefs() {
    const ctx = getContext();
    ctx.extensionSettings ||= {};
    const raw = ctx.extensionSettings[DASH_PREF_KEY] || {};
    const savedOrder = Array.isArray(raw.tabOrder) ? raw.tabOrder.filter(key => TAB_DEFS[key]) : [];
    const tabOrder = [...savedOrder, ...DEFAULT_TAB_ORDER.filter(key => !savedOrder.includes(key))];

    return {
        tabOrder,
        rect: raw.rect && typeof raw.rect === 'object' ? raw.rect : null,
    };
}

function saveDashboardPrefs(patch) {
    const ctx = getContext();
    ctx.extensionSettings ||= {};
    const current = getDashboardPrefs();
    ctx.extensionSettings[DASH_PREF_KEY] = { ...current, ...patch };
    ctx.saveSettingsDebounced?.();
}

function clampPanelRect(rect) {
    const margin = 6;
    const width = Math.max(320, Math.min(Number(rect.width) || 390, Math.max(320, window.innerWidth - margin * 2)));
    const height = Math.max(360, Math.min(Number(rect.height) || 700, Math.max(360, window.innerHeight - margin * 2)));
    const left = Math.max(margin, Math.min(Number(rect.left) || margin, window.innerWidth - width - margin));
    const top = Math.max(margin, Math.min(Number(rect.top) || margin, window.innerHeight - height - margin));
    return { left, top, width, height };
}

function applyDashboardGeometry(root) {
    const rect = getDashboardPrefs().rect;
    if (!rect) return;
    const safe = clampPanelRect(rect);
    root.style.left = `${safe.left}px`;
    root.style.top = `${safe.top}px`;
    root.style.width = `${safe.width}px`;
    root.style.height = `${safe.height}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.dataset.userGeometry = '1';
}

function persistCurrentGeometry(root) {
    const rect = root.getBoundingClientRect();
    saveDashboardPrefs({
        rect: clampPanelRect({
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
        }),
    });
}

function installPanelDragging(root) {
    const header = root.querySelector('.npcb-system-header');
    if (!header) return;

    header.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        if (event.target.closest('button, input, select, textarea, .npcb-side-status')) return;

        const rect = root.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const startLeft = rect.left;
        const startTop = rect.top;
        root.dataset.dragging = '1';
        root.style.left = `${rect.left}px`;
        root.style.top = `${rect.top}px`;
        root.style.width = `${rect.width}px`;
        root.style.height = `${rect.height}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.dataset.userGeometry = '1';
        header.setPointerCapture?.(event.pointerId);

        const move = e => {
            const next = clampPanelRect({
                left: startLeft + e.clientX - startX,
                top: startTop + e.clientY - startY,
                width: root.getBoundingClientRect().width,
                height: root.getBoundingClientRect().height,
            });
            root.style.left = `${next.left}px`;
            root.style.top = `${next.top}px`;
        };

        const up = e => {
            header.releasePointerCapture?.(e.pointerId);
            header.removeEventListener('pointermove', move);
            header.removeEventListener('pointerup', up);
            header.removeEventListener('pointercancel', up);
            delete root.dataset.dragging;
            persistCurrentGeometry(root);
        };

        header.addEventListener('pointermove', move);
        header.addEventListener('pointerup', up);
        header.addEventListener('pointercancel', up);
        event.preventDefault();
    });
}

function installResizePersistence(root) {
    if (root._npcbResizeObserver || typeof ResizeObserver === 'undefined') return;
    let ready = false;
    let timer = null;
    const observer = new ResizeObserver(() => {
        if (!ready || root.dataset.dragging === '1') return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            const rect = root.getBoundingClientRect();
            const safe = clampPanelRect(rect);
            root.dataset.userGeometry = '1';
            root.style.left = `${safe.left}px`;
            root.style.top = `${safe.top}px`;
            root.style.width = `${safe.width}px`;
            root.style.height = `${safe.height}px`;
            root.style.right = 'auto';
            root.style.bottom = 'auto';
            saveDashboardPrefs({ rect: safe });
        }, 250);
    });
    observer.observe(root);
    root._npcbResizeObserver = observer;
    requestAnimationFrame(() => { ready = true; });
}

function installTabReordering(root) {
    let draggedKey = '';

    root.querySelectorAll('.npcb-system-tabs [data-tab]').forEach(button => {
        button.addEventListener('dragstart', event => {
            draggedKey = button.dataset.tab;
            button.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', draggedKey);
        });

        button.addEventListener('dragend', () => {
            draggedKey = '';
            button.classList.remove('dragging');
            root.querySelectorAll('.npcb-system-tabs [data-tab]').forEach(x => x.classList.remove('drag-over'));
        });

        button.addEventListener('dragover', event => {
            event.preventDefault();
            if (!draggedKey || draggedKey === button.dataset.tab) return;
            button.classList.add('drag-over');
            event.dataTransfer.dropEffect = 'move';
        });

        button.addEventListener('dragleave', () => button.classList.remove('drag-over'));

        button.addEventListener('drop', event => {
            event.preventDefault();
            const source = draggedKey || event.dataTransfer.getData('text/plain');
            const target = button.dataset.tab;
            if (!TAB_DEFS[source] || !TAB_DEFS[target] || source === target) return;

            const order = [...getDashboardPrefs().tabOrder];
            const sourceIndex = order.indexOf(source);
            const targetIndex = order.indexOf(target);
            if (sourceIndex < 0 || targetIndex < 0) return;
            order.splice(sourceIndex, 1);
            order.splice(targetIndex, 0, source);
            saveDashboardPrefs({ tabOrder: order });
            renderDashboard();
        });
    });
}

function statusLabel() {
    if (trackerStatus.status === 'scanning') return 'SYSTEM SCANNING';
    if (trackerStatus.status === 'error') return 'SYSTEM ERROR';
    if (trackerStatus.status === 'ready') return 'SYSTEM ONLINE';
    return 'SYSTEM IDLE';
}

function statusClass() {
    return trackerStatus.status === 'error' ? 'error'
        : trackerStatus.status === 'scanning' ? 'scanning'
            : trackerStatus.status === 'ready' ? 'ready'
                : '';
}

function pct(value, max) {
    const m = Number(max) || 0;
    if (m <= 0) return 0;
    return Math.max(0, Math.min(100, (Number(value) || 0) / m * 100));
}

function clampRelationship(value) {
    return Math.max(-100, Math.min(100, Number(value) || 0));
}

function relationshipPct(value) {
    return (clampRelationship(value) + 100) / 2;
}

function playerTitle(player) {
    if (!player.hasSystem) return 'SYSTEM NOT ACQUIRED';
    return player.title || player.className || 'AWAKENED';
}

function renderRecentEvents(state) {
    const events = [...(state.events || [])].slice(-4).reverse();
    return `
        <div class="npcb-system-section-head">
            <span>EVENT TRACKER</span>
            <button data-action="open-events">VIEW ALL</button>
        </div>
        <div class="npcb-event-mini-list">
            ${events.length ? events.map(event => `
                <button class="npcb-event-mini" data-action="open-events">
                    <i class="importance-${escapeHtml(event.importance)}"></i>
                    <div>
                        <strong>${escapeHtml(event.title)}</strong>
                        <span>${escapeHtml(event.description || event.location || event.type)}</span>
                    </div>
                </button>
            `).join('') : '<div class="npcb-side-empty">No major events tracked yet.</div>'}
        </div>
    `;
}

function renderAttributes(player) {
    if (!player.hasSystem) {
        return `
            <div class="npcb-system-locked">
                <div class="npcb-lock-glyph">◇</div>
                <strong>ATTRIBUTE INTERFACE LOCKED</strong>
                <span>Lv. 0 · EXP unavailable until the story grants a System.</span>
            </div>
        `;
    }

    const canSpend = Number(player.statPoints) > 0;
    return `
        <div class="npcb-system-section-head">
            <span>CORE ATTRIBUTES</span>
            <b>${escapeHtml(player.statPoints)} POINT${Number(player.statPoints) === 1 ? '' : 'S'} AVAILABLE</b>
        </div>
        <div class="npcb-attribute-grid">
            ${CORE_ATTRIBUTES.map(key => `
                <div class="npcb-attribute-card" data-attribute="${key}">
                    <small>${key}</small>
                    <strong>${escapeHtml(player.attributes?.[key] ?? 0)}</strong>
                    <button data-action="attribute-plus" ${canSpend ? '' : 'disabled'}>＋</button>
                </div>
            `).join('')}
        </div>
    `;
}

function worldConditionChips(values = {}) {
    const labels = [
        ['date', 'DATE'], ['day', 'DAY'], ['time', 'TIME'], ['dayPart', 'DAYPART'],
        ['weather', 'WEATHER'], ['season', 'SEASON'], ['year', 'YEAR'], ['holiday', 'HOLIDAY'],
    ];
    return labels
        .filter(([key]) => String(values?.[key] || '').trim())
        .map(([key, label]) => `<span><small>${label}</small><strong>${escapeHtml(values[key])}</strong></span>`)
        .join('');
}

function renderWorldState(state) {
    const scene = state.scene || {};
    const chips = worldConditionChips(scene);
    return `
        <div class="npcb-system-section-head"><span>RP WORLD STATE</span><b>STORY TIME</b></div>
        <div class="npcb-world-state">
            ${chips || '<div class="npcb-side-empty">Time / date / weather not established yet.</div>'}
        </div>
    `;
}

function renderStatus(state) {
    const p = state.player;
    const xpPct = p.hasSystem ? pct(p.xp, p.xpToNext) : 0;

    const stats = (p.stats || []).map(stat => {
        const statPct = pct(stat.value, stat.max);
        return `
        <div class="npcb-system-stat" data-stat-id="${escapeHtml(stat.id)}">
            <div class="npcb-system-stat-top">
                <strong>${escapeHtml(stat.name)}</strong>
                <span>${escapeHtml(stat.value)}${stat.unit ? escapeHtml(stat.unit) : ''} / ${escapeHtml(stat.max)}${stat.unit ? escapeHtml(stat.unit) : ''}</span>
            </div>
            <div class="npcb-system-bar"><i style="width:${statPct}%"></i></div>
            <div class="npcb-system-stat-actions">
                <label title="Allow AI tracker to update this stat"><input class="npcb-stat-ai" type="checkbox" ${stat.aiTrack !== false ? 'checked' : ''}> AI</label>
                <button data-action="stat-edit">Edit</button>
                <button data-action="stat-delete">×</button>
            </div>
        </div>`;
    }).join('');

    return `
        <div class="npcb-player-card ${p.hasSystem ? 'system-active' : 'system-locked'}">
            <div class="npcb-player-rank">LV. ${escapeHtml(p.hasSystem ? p.level : 0)}</div>
            <div class="npcb-player-ident">
                <small>PLAYER</small>
                <strong>${escapeHtml(p.name || 'Player')}</strong>
                <span>${escapeHtml(playerTitle(p))}</span>
            </div>
            <button class="npcb-system-mini" data-action="player-edit">EDIT</button>
        </div>

        <div class="npcb-system-xp ${p.hasSystem ? '' : 'locked'}">
            <div>
                <span>EXPERIENCE</span>
                <strong>${p.hasSystem ? `${escapeHtml(p.xp)} / ${escapeHtml(p.xpToNext)}` : 'LOCKED'}</strong>
            </div>
            <div class="npcb-system-bar xp"><i style="width:${xpPct}%"></i></div>
        </div>

        ${renderAttributes(p)}

        <div class="npcb-system-resource-grid">
            <div><small>FUNDS</small><strong>${escapeHtml(p.money.toLocaleString?.() ?? p.money)} <em>${escapeHtml(p.currency)}</em></strong></div>
            <div><small>LOCATION</small><strong>${escapeHtml(p.currentLocation || state.scene.location || 'Unknown')}</strong></div>
        </div>

        ${renderWorldState(state)}

        <div class="npcb-system-section-head"><span>VITAL / CUSTOM STATS</span><button data-action="stat-add">＋ ADD STAT</button></div>
        <div class="npcb-system-stats">${stats || '<div class="npcb-side-empty">No custom stats configured.</div>'}</div>

        ${p.condition ? `<div class="npcb-system-condition"><small>CONDITION</small><span>${escapeHtml(p.condition)}</span></div>` : ''}

        ${renderRecentEvents(state)}
    `;
}

function inventoryUsed(player, type, storageId = '') {
    return (player.inventory || []).filter(item => {
        if (item.locationType !== type) return false;
        if (type === 'stored') return item.storageId === storageId;
        return true;
    }).length;
}

function inventoryCapacity(player, type, storageId = '') {
    if (type === 'person') return Math.max(1, Number(player.inventoryLimits?.onPerson) || 12);
    if (type === 'clothing') return Math.max(1, Number(player.inventoryLimits?.clothing) || 8);
    const storage = (player.storageLocations || []).find(x => x.id === storageId);
    return Math.max(1, Number(storage?.capacity) || Number(player.inventoryLimits?.defaultStorage) || 30);
}

function renderInventoryItems(player, type, storageId = '') {
    const items = (player.inventory || [])
        .filter(item => item.locationType === type && (type !== 'stored' || item.storageId === storageId))
        .sort((a, b) => Number(b.equipped) - Number(a.equipped) || a.name.localeCompare(b.name));

    return items.length ? items.map(item => `
        <div class="npcb-system-list-row ${item.equipped ? 'equipped' : ''}" data-item-id="${escapeHtml(item.id)}">
            <div class="npcb-system-list-icon">${type === 'clothing' ? '◫' : type === 'stored' ? '▣' : '◇'}</div>
            <div class="npcb-system-list-main">
                <strong>${escapeHtml(item.name)} ${item.quantity > 1 ? `×${escapeHtml(item.quantity)}` : ''}</strong>
                <span>${escapeHtml(item.type || item.description || (item.equipped ? 'Equipped' : 'Item'))}</span>
            </div>
            <div class="npcb-system-row-actions">
                <button data-action="item-minus">−</button>
                <button data-action="item-plus">＋</button>
                <button data-action="item-move">MOVE</button>
                <button data-action="item-equip">${item.equipped ? 'OFF' : 'EQUIP'}</button>
                <button data-action="item-delete">×</button>
            </div>
        </div>
    `).join('') : '<div class="npcb-side-empty">No items in this category.</div>';
}

function renderInventory(state) {
    const p = state.player;
    const storages = (p.storageLocations || []).filter(storage => !storage.systemOnly || p.hasSystem);

    if (inventoryTab === 'stored' && !activeStorageId && storages.length) activeStorageId = storages[0].id;
    if (inventoryTab === 'stored' && activeStorageId && !storages.some(x => x.id === activeStorageId)) {
        activeStorageId = storages[0]?.id || '';
    }

    const storage = storages.find(x => x.id === activeStorageId);
    const used = inventoryUsed(p, inventoryTab, inventoryTab === 'stored' ? activeStorageId : '');
    const cap = inventoryCapacity(p, inventoryTab, inventoryTab === 'stored' ? activeStorageId : '');
    const over = used > cap;

    return `
        <div class="npcb-inventory-subtabs">
            <button data-inventory-tab="person" class="${inventoryTab === 'person' ? 'active' : ''}">ON PERSON</button>
            <button data-inventory-tab="clothing" class="${inventoryTab === 'clothing' ? 'active' : ''}">CLOTHING</button>
            <button data-inventory-tab="stored" class="${inventoryTab === 'stored' ? 'active' : ''}">STORED</button>
        </div>

        <div class="npcb-inventory-money">
            <span>AVAILABLE FUNDS</span>
            <strong>${escapeHtml(p.money.toLocaleString?.() ?? p.money)} ${escapeHtml(p.currency)}</strong>
            <button data-action="money-edit">EDIT</button>
        </div>

        ${inventoryTab === 'stored' ? `
            <div class="npcb-storage-toolbar">
                <select class="npcb-storage-select">
                    ${storages.length ? storages.map(x => `<option value="${escapeHtml(x.id)}" ${x.id === activeStorageId ? 'selected' : ''}>${escapeHtml(x.name)}${x.systemOnly ? ' [SYSTEM]' : ''}</option>`).join('') : '<option value="">No storage locations</option>'}
                </select>
                <button data-action="storage-add">＋ STORAGE</button>
                ${storage ? '<button data-action="storage-edit">EDIT LIMIT</button>' : ''}
            </div>
        ` : ''}

        <div class="npcb-capacity-line ${over ? 'over' : ''}">
            <span>SLOTS</span>
            <strong>${used} / ${cap}</strong>
            <button data-action="capacity-edit">${inventoryTab === 'stored' ? 'STORAGE LIMIT' : 'EDIT LIMIT'}</button>
        </div>

        ${over ? '<div class="npcb-capacity-warning">CAPACITY EXCEEDED — move or remove item stacks.</div>' : ''}

        <div class="npcb-system-section-head">
            <span>${inventoryTab === 'person' ? 'CARRIED ITEMS' : inventoryTab === 'clothing' ? 'CLOTHING / EQUIPMENT' : escapeHtml(storage?.name || 'STORED ITEMS')}</span>
            <button data-action="item-add">＋ ADD ITEM</button>
        </div>

        <div class="npcb-system-list">
            ${inventoryTab === 'stored' && !storage
                ? '<div class="npcb-side-empty">Create a storage location first. Story-detected homes, lockers, vehicles, vaults and System storage can also appear here automatically.</div>'
                : renderInventoryItems(p, inventoryTab, inventoryTab === 'stored' ? activeStorageId : '')}
        </div>
    `;
}

function renderSkills(state) {
    const p = state.player;
    return `
        <div class="npcb-system-section-head"><span>ACQUIRED SKILLS</span><button data-action="skill-add">＋ ADD SKILL</button></div>
        <div class="npcb-skill-grid">
            ${p.skills?.length ? p.skills.map(skill => `
                <div class="npcb-skill-card" data-skill-id="${escapeHtml(skill.id)}">
                    <div class="npcb-skill-rank">${escapeHtml(skill.rank || '—')}</div>
                    <strong>${escapeHtml(skill.name)}</strong>
                    <span>${escapeHtml(skill.description || skill.source || 'Acquired skill')}</span>
                    <div><button data-action="skill-edit">EDIT</button><button data-action="skill-delete">×</button></div>
                </div>
            `).join('') : '<div class="npcb-side-empty">No skills acquired yet.</div>'}
        </div>
        <div class="npcb-system-section-head"><span>TITLES</span></div>
        <div class="npcb-system-tags">
            ${p.titles?.length ? p.titles.map(title => `<span>${escapeHtml(title)}</span>`).join('') : '<em>No titles yet</em>'}
        </div>
    `;
}

function renderHome(state) {
    const p = state.player;
    return `
        <div class="npcb-home-banner">
            <small>PLAYER BASE / HOME</small>
            <strong>${escapeHtml(p.homeLocation || 'UNASSIGNED')}</strong>
            <span>Persistent home data stays put when the active scene moves.</span>
        </div>
        <label class="npcb-system-field">
            <span>CURRENT LOCATION</span>
            <input data-player-field="currentLocation" value="${escapeHtml(p.currentLocation || state.scene.location || '')}">
        </label>
        <label class="npcb-system-field">
            <span>HOME / BASE LOCATION</span>
            <input data-player-field="homeLocation" value="${escapeHtml(p.homeLocation)}" placeholder="Apartment, guild hall, estate…">
        </label>
        <label class="npcb-system-field">
            <span>HOME DETAILS</span>
            <textarea data-player-field="homeDescription" rows="6" placeholder="Rooms, facilities, storage, residents, upgrades…">${escapeHtml(p.homeDescription)}</textarea>
        </label>
        <label class="npcb-system-field">
            <span>CURRENT CONDITION</span>
            <textarea data-player-field="condition" rows="4">${escapeHtml(p.condition)}</textarea>
        </label>
    `;
}

function renderQuestCard(quest) {
    return `
        <div class="npcb-quest-card status-${escapeHtml(quest.status)}" data-quest-id="${escapeHtml(quest.id)}">
            <div class="npcb-quest-top">
                <div>
                    <small>${escapeHtml(quest.type.toUpperCase())} QUEST</small>
                    <strong>${escapeHtml(quest.title)}</strong>
                </div>
                <select class="npcb-quest-status">
                    ${['active','completed','failed','hidden'].map(status => `<option value="${status}" ${quest.status === status ? 'selected' : ''}>${status.toUpperCase()}</option>`).join('')}
                </select>
            </div>
            ${quest.description ? `<p>${escapeHtml(quest.description)}</p>` : ''}
            <div class="npcb-quest-objectives">
                ${quest.objectives?.length ? quest.objectives.map(obj => `
                    <label data-objective-id="${escapeHtml(obj.id)}">
                        <input type="checkbox" class="npcb-objective-check" ${obj.complete ? 'checked' : ''}>
                        <span>${escapeHtml(obj.text)}</span>
                    </label>
                `).join('') : '<em>No objectives recorded.</em>'}
            </div>
            ${worldConditionChips(quest.conditions) ? `
                <div class="npcb-condition-block ${quest.conditionsMet ? 'met' : ''}">
                    <div class="npcb-condition-title">${quest.conditionsMet ? 'CONDITIONS MET' : 'CONDITIONS'} </div>
                    <div class="npcb-condition-chips">${worldConditionChips(quest.conditions)}</div>
                </div>
            ` : ''}
            ${quest.reward ? `<div class="npcb-quest-reward"><span>REWARD</span><strong>${escapeHtml(quest.reward)}</strong></div>` : ''}
            ${quest.source ? `<div class="npcb-quest-source">SOURCE // ${escapeHtml(quest.source)}</div>` : ''}
            <div class="npcb-quest-actions"><button data-action="quest-edit">EDIT</button><button data-action="quest-delete">DELETE</button></div>
        </div>
    `;
}

function renderQuests(state) {
    const quests = [...(state.quests || [])].sort((a, b) => {
        const rank = { active: 0, completed: 1, failed: 2, hidden: 3 };
        return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || String(b.updatedAt).localeCompare(String(a.updatedAt));
    });

    return `
        <div class="npcb-system-section-head"><span>QUEST LOG</span><button data-action="quest-add">＋ ADD QUEST</button></div>
        <div class="npcb-quest-list">
            ${quests.length ? quests.map(renderQuestCard).join('') : '<div class="npcb-side-empty">No quests tracked. Story goals and explicit System quests can be detected automatically.</div>'}
        </div>
    `;
}

function npcMeter(label, value, max, cls = '') {
    return `
        <div class="npcb-npc-meter ${cls}">
            <span>${escapeHtml(label)}</span>
            <div><i style="width:${pct(value, max)}%"></i></div>
            <b>${escapeHtml(value)} / ${escapeHtml(max)}</b>
        </div>
    `;
}

function characterRows(state) {
    const chars = state.order.map(id => state.characters[id]).filter(Boolean);
    const rank = { present: 0, nearby: 1, away: 2, unknown: 3, missing: 4, inactive: 5, dead: 6 };
    chars.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.name.localeCompare(b.name));

    if (!chars.length) {
        return '<div class="npcb-side-empty">No NPCs saved yet.<br>The tracker will register named characters from RP.</div>';
    }

    return chars.map(c => {
        const portrait = c.portrait
            ? `<img src="${escapeHtml(c.portrait)}" alt="">`
            : `<div class="npcb-side-avatar-fallback">${escapeHtml(c.name.trim().slice(0, 2).toUpperCase() || '?')}</div>`;
        const rel = clampRelationship(c.relationship?.value || 0);
        return `
            <button class="npcb-side-character npcb-npc-vital-card status-${escapeHtml(c.status)}" data-id="${escapeHtml(c.id)}">
                <div class="npcb-side-avatar">${portrait}<span class="npcb-side-presence"></span></div>
                <div class="npcb-side-character-text">
                    <div class="npcb-npc-name-line"><strong>${escapeHtml(c.name)}</strong>${c.system?.hasSystem ? `<i>SYS · LV${escapeHtml(c.system.level)}</i>` : ''}</div>
                    <span>${escapeHtml(c.role || c.scene?.action || c.faction || 'NPC')}</span>
                    <div class="npcb-npc-mini-bars">
                        <div title="HP"><i class="hp" style="width:${pct(c.vitals?.hp, c.vitals?.maxHp)}%"></i></div>
                        <div title="Fatigue"><i class="fatigue" style="width:${pct(c.vitals?.fatigue, c.vitals?.maxFatigue)}%"></i></div>
                        <div title="Relationship"><i class="relationship" style="width:${relationshipPct(rel)}%"></i></div>
                    </div>
                </div>
                <small>${escapeHtml(c.status)}</small>
            </button>`;
    }).join('');
}

function renderCharacters(state) {
    const present = state.order.map(id => state.characters[id]).filter(c => c && ['present', 'nearby'].includes(c.status)).length;
    return `
        <div class="npcb-side-actions">
            <button class="npcb-side-scan"><span>↻</span> Scan latest RP</button>
            <button class="npcb-side-archive">Global Archive</button>
        </div>
        <div class="npcb-side-section-title"><span>NPC VITAL TRACKER</span><small>${present} active · ${state.order.length} linked</small></div>
        <div class="npcb-side-character-list">${characterRows(state)}</div>
        <div class="npcb-npc-legend"><span>HP</span><span>FATIGUE</span><span>RELATIONSHIP</span><em>Detailed STR/DEX/INT/STA/SEN only appears on NPCs with a System.</em></div>
    `;
}

function renderEvents(state) {
    const events = [...(state.events || [])].reverse();
    return `
        <div class="npcb-system-section-head">
            <span>EVENT TRACKER</span>
            <div><button data-action="event-add">＋ EVENT</button><button data-action="event-clear">CLEAR</button></div>
        </div>
        <div class="npcb-event-list">
            ${events.length ? events.map(event => `
                <div class="npcb-event-row importance-${escapeHtml(event.importance)}" data-event-id="${escapeHtml(event.id)}">
                    <div class="npcb-event-node"></div>
                    <div>
                        <small>${escapeHtml(event.type.toUpperCase())}${event.location ? ` // ${escapeHtml(event.location)}` : ''}</small>
                        <strong>${escapeHtml(event.title)}</strong>
                        <span>${escapeHtml(event.description)}</span>
                        ${event.status === 'pending' ? `<b class="npcb-event-status ${event.triggerMet ? 'ready' : ''}">${event.triggerMet ? 'TRIGGER CONDITIONS MET' : 'PENDING TRIGGER'}</b>` : ''}
                        ${worldConditionChips(event.trigger) ? `<div class="npcb-condition-chips compact">${worldConditionChips(event.trigger)}</div>` : ''}
                        ${event.participants?.length ? `<em>${escapeHtml(event.participants.join(' · '))}</em>` : ''}
                    </div>
                    <button data-action="event-delete">×</button>
                </div>
            `).join('') : '<div class="npcb-side-empty">No tracked events yet.</div>'}
        </div>
    `;
}

function renderTrackerSettings(state) {
    const t = state.tracker || {};
    const toggle = (path, checked, title, desc) => `
        <label class="npcb-side-setting">
            <div><strong>${title}</strong><span>${desc}</span></div>
            <input type="checkbox" data-setting="${path}" ${checked ? 'checked' : ''}>
        </label>`;

    return `
        <div class="npcb-tracker-state ${statusClass()}">
            <div class="npcb-tracker-dot"></div>
            <div><strong>${escapeHtml(statusLabel())}</strong><span>${escapeHtml(trackerStatus.message || '')}</span></div>
        </div>

        ${toggle('tracker.autoRead', t.autoRead !== false, 'Auto-read roleplay', 'Run one separate extraction after assistant replies.')}
        ${toggle('tracker.trackPlayer', t.trackPlayer !== false, 'Track player state', 'Track System state, location and condition.')}
        ${toggle('tracker.trackStats', t.trackStats !== false, 'Track player vitals', 'Update AI-enabled custom stats.')}
        ${toggle('tracker.trackInventory', t.trackInventory !== false, 'Track inventory + storage', 'Track carried, clothing and stored items.')}
        ${toggle('tracker.trackSkills', t.trackSkills !== false, 'Track skills & titles', 'Record acquired skills/ranks/titles.')}
        ${toggle('tracker.trackMoney', t.trackMoney !== false, 'Track money', 'Update funds when explicit spending/rewards occur.')}
        ${toggle('tracker.trackQuests', t.trackQuests !== false, 'Track quests', 'Create/update story and System quests from clear objectives.')}
        ${toggle('tracker.trackEvents', t.trackEvents !== false, 'Track events', 'Record meaningful story developments for continuity.')}
        ${toggle('tracker.trackNpcVitals', t.trackNpcVitals !== false, 'Track NPC HP/Fatigue', 'Maintain lightweight vitals for recurring NPCs.')}
        ${toggle('ui.autoRegisterTrackerNPCs', state.ui.autoRegisterTrackerNPCs !== false, 'Auto-register NPCs', 'Save newly detected named NPCs.')}
        ${toggle('ui.showAwayOnBar', Boolean(state.ui.showAwayOnBar), 'Show away NPC covers', 'Keep absent NPCs on portrait shelf.')}
        ${toggle('ui.compact', Boolean(state.ui.compact), 'Compact NPC covers', 'Use smaller portrait covers.')}

        <label class="npcb-side-number">
            <div><strong>System context depth</strong><span>Recent messages sent to extractor (2–20).</span></div>
            <input type="number" min="2" max="20" step="1" data-setting="tracker.contextDepth" value="${Number(t.contextDepth || 6)}">
        </label>

        <button class="npcb-side-scan npcb-side-scan-large">↻ RUN SYSTEM SCAN</button>
    `;
}

function setPath(obj, path, value) {
    const parts = path.split('.');
    let cursor = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        cursor[parts[i]] ||= {};
        cursor = cursor[parts[i]];
    }
    cursor[parts.at(-1)] = value;
}

async function editPlayer() {
    const state = getState();
    const p = state.player;
    const name = prompt('Player name', p.name) ?? p.name;
    const title = prompt('Title', p.title) ?? p.title;
    const className = prompt('Class / role', p.className) ?? p.className;
    const systemAnswer = prompt('Has System? yes / no', p.hasSystem ? 'yes' : 'no');
    if (systemAnswer === null) return;
    const hasSystem = /^y(es)?$/i.test(systemAnswer.trim());

    let level = p.level;
    let xp = p.xp;
    let xpToNext = p.xpToNext;
    let pointsPerLevel = Math.max(0, Number(p.statPointsPerLevel) || 5);

    if (hasSystem) {
        level = Math.max(1, Number(prompt('Level', String(Math.max(1, p.level || 1))) ?? p.level) || 1);
        xp = Math.max(0, Number(prompt('Current XP', String(p.xp || 0)) ?? p.xp) || 0);
        xpToNext = Math.max(1, Number(prompt('XP needed for next level', String(p.xpToNext || 100)) ?? p.xpToNext) || 100);
        pointsPerLevel = Math.max(0, Number(prompt('Allocatable stat points gained per level', String(pointsPerLevel)) ?? pointsPerLevel) || 0);
    }

    await mutateState(s => {
        const wasSystem = s.player.hasSystem;
        Object.assign(s.player, {
            name: name.trim(),
            title: title.trim(),
            className: className.trim(),
            hasSystem,
        });

        if (!hasSystem) {
            s.player.level = 0;
            s.player.xp = 0;
            s.player.xpToNext = 0;
            s.player.statPoints = 0;
            s.player.attributes = Object.fromEntries(CORE_ATTRIBUTES.map(key => [key, 0]));
        } else {
            const oldLevel = wasSystem ? Math.max(1, Number(s.player.level) || 1) : level;
            s.player.statPointsPerLevel = pointsPerLevel;
            if (wasSystem && level > oldLevel) {
                s.player.statPoints += (level - oldLevel) * pointsPerLevel;
            }
            s.player.level = level;
            s.player.xp = xp;
            s.player.xpToNext = xpToNext;
            if (!wasSystem && CORE_ATTRIBUTES.every(key => !Number(s.player.attributes?.[key]))) {
                s.player.attributes = Object.fromEntries(CORE_ATTRIBUTES.map(key => [key, 10]));
            }
        }
    });
    renderDashboard();
}

async function addStat() {
    const name = prompt('Stat name (Health, Mana, Sanity, etc.)');
    if (!name?.trim()) return;
    const value = Number(prompt('Starting value', '100') ?? 100);
    const max = Number(prompt('Maximum value', '100') ?? 100);
    const unit = prompt('Unit (%, pts, etc.)', '') ?? '';
    await mutateState(s => s.player.stats.push({
        id: uid('stat'),
        name: name.trim(),
        value: Number.isFinite(value) ? value : 0,
        max: Number.isFinite(max) && max > 0 ? max : 100,
        unit: unit.trim(),
        aiTrack: true,
    }));
    renderDashboard();
}

async function editStat(id) {
    const stat = getState().player.stats.find(x => x.id === id);
    if (!stat) return;
    const name = prompt('Stat name', stat.name) ?? stat.name;
    const value = prompt('Current value', String(stat.value));
    const max = prompt('Maximum value', String(stat.max));
    const unit = prompt('Unit', stat.unit) ?? stat.unit;
    await mutateState(s => {
        const x = s.player.stats.find(v => v.id === id);
        if (!x) return;
        x.name = name.trim() || x.name;
        if (value !== null && value !== '') x.value = Number(value) || 0;
        if (max !== null && max !== '') x.max = Math.max(1, Number(max) || 1);
        x.unit = unit;
    });
    renderDashboard();
}

async function addItem() {
    const state = getState();
    const name = prompt('Item name');
    if (!name?.trim()) return;
    const quantity = Math.max(1, Number(prompt('Quantity', '1') ?? 1) || 1);
    const type = prompt('Type (weapon, armor, consumable, quest…)', '') ?? '';
    const description = prompt('Description', '') ?? '';

    if (inventoryTab === 'stored' && !activeStorageId) {
        alert('Create/select a storage location first.');
        return;
    }

    await mutateState(s => s.player.inventory.push({
        id: uid('item'),
        name: name.trim(),
        quantity,
        type: type.trim(),
        description: description.trim(),
        equipped: inventoryTab === 'clothing',
        value: 0,
        locationType: inventoryTab,
        storageId: inventoryTab === 'stored' ? activeStorageId : '',
    }));
    renderDashboard();
}

async function addStorage() {
    const state = getState();
    const name = prompt('Storage location name (Apartment Storage, Guild Locker, System Inventory…)');
    if (!name?.trim()) return;
    const capacity = Math.max(1, Number(prompt('Slot capacity', String(state.player.inventoryLimits.defaultStorage || 30)) ?? 30) || 30);
    const systemOnly = /^y(es)?$/i.test((prompt('System-only storage? yes / no', 'no') ?? 'no').trim());
    if (systemOnly && !state.player.hasSystem) {
        alert('System-only storage cannot exist before the player acquires a System.');
        return;
    }
    const id = uid('storage');
    await mutateState(s => s.player.storageLocations.push({
        id,
        name: name.trim(),
        capacity,
        type: systemOnly ? 'system' : 'location',
        systemOnly,
        description: '',
    }));
    activeStorageId = id;
    inventoryTab = 'stored';
    renderDashboard();
}

async function addSkill() {
    const name = prompt('Skill name');
    if (!name?.trim()) return;
    const rank = prompt('Rank / level', '') ?? '';
    const description = prompt('Description', '') ?? '';
    await mutateState(s => s.player.skills.push({
        id: uid('skill'), name: name.trim(), rank: rank.trim(), description: description.trim(), source: '',
    }));
    renderDashboard();
}

async function editSkill(id) {
    const skill = getState().player.skills.find(x => x.id === id);
    if (!skill) return;
    const name = prompt('Skill name', skill.name) ?? skill.name;
    const rank = prompt('Rank / level', skill.rank) ?? skill.rank;
    const description = prompt('Description', skill.description) ?? skill.description;
    await mutateState(s => {
        const x = s.player.skills.find(v => v.id === id);
        if (x) Object.assign(x, { name: name.trim() || x.name, rank: rank.trim(), description: description.trim() });
    });
    renderDashboard();
}

async function addQuest() {
    const title = prompt('Quest title');
    if (!title?.trim()) return;
    const description = prompt('Quest description', '') ?? '';
    const type = prompt('Type: story / main / side / system', 'story') ?? 'story';
    if (type.trim().toLowerCase() === 'system' && !getState().player.hasSystem) {
        alert('A System quest cannot exist before the player acquires a System.');
        return;
    }
    const objectivesRaw = prompt('Objectives, one per line', '') ?? '';
    await mutateState(s => s.quests.push({
        id: uid('quest'),
        title: title.trim(),
        type: ['story','main','side','system'].includes(type.trim().toLowerCase()) ? type.trim().toLowerCase() : 'story',
        status: 'active',
        description: description.trim(),
        objectives: objectivesRaw.split('\n').map(x => x.trim()).filter(Boolean).map(text => ({ id: uid('objective'), text, complete: false })),
        reward: '',
        source: 'Manual',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }));
    renderDashboard();
}

async function editQuest(id) {
    const quest = getState().quests.find(x => x.id === id);
    if (!quest) return;
    const title = prompt('Quest title', quest.title) ?? quest.title;
    const description = prompt('Description', quest.description) ?? quest.description;
    const reward = prompt('Reward', quest.reward) ?? quest.reward;
    const source = prompt('Source / issuer', quest.source) ?? quest.source;
    await mutateState(s => {
        const q = s.quests.find(x => x.id === id);
        if (q) {
            Object.assign(q, { title: title.trim() || q.title, description, reward, source, updatedAt: new Date().toISOString() });
        }
    });
    renderDashboard();
}

async function addEvent() {
    const title = prompt('Event title');
    if (!title?.trim()) return;
    const description = prompt('Description', '') ?? '';
    const type = prompt('Type (combat, discovery, social, travel, quest, system, acquisition, story)', 'story') ?? 'story';
    await mutateState(s => s.events.push({
        id: uid('event'),
        type: type.trim() || 'story',
        title: title.trim(),
        description: description.trim(),
        location: s.scene.location || s.player.currentLocation || '',
        participants: [],
        importance: 'normal',
        createdAt: new Date().toISOString(),
    }));
    renderDashboard();
}

async function moveItem(id) {
    const state = getState();
    const item = state.player.inventory.find(x => x.id === id);
    if (!item) return;

    const answer = prompt('Move to: person / clothing / stored', item.locationType) ?? item.locationType;
    const target = answer.trim().toLowerCase();
    if (!['person','clothing','stored'].includes(target)) return;

    let storageId = '';
    if (target === 'stored') {
        const available = state.player.storageLocations.filter(x => !x.systemOnly || state.player.hasSystem);
        if (!available.length) {
            alert('No storage locations exist.');
            return;
        }
        const storageName = prompt(`Storage name:\n${available.map(x => x.name).join('\n')}`, available[0].name);
        if (!storageName) return;
        const storage = available.find(x => x.name.toLowerCase() === storageName.trim().toLowerCase());
        if (!storage) {
            alert('Storage not found.');
            return;
        }
        storageId = storage.id;
    }

    await mutateState(s => {
        const x = s.player.inventory.find(v => v.id === id);
        if (!x) return;
        x.locationType = target;
        x.storageId = storageId;
        if (target === 'clothing') x.equipped = true;
        if (target !== 'clothing' && x.equipped && x.type.toLowerCase().includes('clothing')) x.equipped = false;
    });
    renderDashboard();
}

function bindEvents(root) {
    root.querySelectorAll('.npcb-side-tabs button').forEach(button => {
        button.addEventListener('click', () => {
            activeTab = button.dataset.tab;
            renderDashboard();
        });
    });
    installTabReordering(root);
    installPanelDragging(root);

    root.querySelectorAll('[data-inventory-tab]').forEach(button => {
        button.addEventListener('click', () => {
            inventoryTab = button.dataset.inventoryTab;
            renderDashboard();
        });
    });

    root.querySelector('.npcb-storage-select')?.addEventListener('change', event => {
        activeStorageId = event.target.value;
        renderDashboard();
    });

    root.querySelector('.npcb-side-close')?.addEventListener('click', () => {
        root.classList.add('npcb-side-hidden');
        document.getElementById(TOGGLE_ID)?.classList.add('visible');
    });

    root.querySelectorAll('.npcb-side-character').forEach(row => row.addEventListener('click', () => openWorkshop(row.dataset.id)));
    root.querySelectorAll('.npcb-side-archive').forEach(button => button.addEventListener('click', openArchive));

    root.querySelectorAll('.npcb-side-scan').forEach(button => {
        button.addEventListener('click', async () => {
            button.disabled = true;
            try { await scanLatestRoleplay({ force: true, manual: true }); }
            finally { button.disabled = false; }
        });
    });

    root.querySelectorAll('[data-setting]').forEach(input => {
        input.addEventListener('change', async () => {
            const path = input.dataset.setting;
            const value = input.type === 'checkbox'
                ? input.checked
                : Math.max(2, Math.min(20, Number(input.value || 6)));
            await mutateState(state => setPath(state, path, value));
            renderBar();
            renderDashboard();
        });
    });

    root.querySelectorAll('[data-player-field]').forEach(input => {
        input.addEventListener('change', async () => {
            await mutateState(s => { s.player[input.dataset.playerField] = input.value; });
            renderDashboard();
        });
    });

    root.querySelectorAll('.npcb-stat-ai').forEach(input => {
        input.addEventListener('change', async () => {
            const id = input.closest('[data-stat-id]')?.dataset.statId;
            await mutateState(s => {
                const stat = s.player.stats.find(x => x.id === id);
                if (stat) stat.aiTrack = input.checked;
            });
        });
    });

    root.querySelectorAll('.npcb-quest-status').forEach(select => {
        select.addEventListener('change', async () => {
            const id = select.closest('[data-quest-id]')?.dataset.questId;
            await mutateState(s => {
                const quest = s.quests.find(x => x.id === id);
                if (quest) {
                    quest.status = select.value;
                    quest.updatedAt = new Date().toISOString();
                }
            });
            renderDashboard();
        });
    });

    root.querySelectorAll('.npcb-objective-check').forEach(input => {
        input.addEventListener('change', async () => {
            const questId = input.closest('[data-quest-id]')?.dataset.questId;
            const objectiveId = input.closest('[data-objective-id]')?.dataset.objectiveId;
            await mutateState(s => {
                const quest = s.quests.find(x => x.id === questId);
                const objective = quest?.objectives.find(x => x.id === objectiveId);
                if (objective) objective.complete = input.checked;
                if (quest) quest.updatedAt = new Date().toISOString();
            });
            renderDashboard();
        });
    });

    root.querySelectorAll('[data-action]').forEach(button => {
        button.addEventListener('click', async event => {
            event.stopPropagation();
            const action = button.dataset.action;

            if (action === 'open-events') {
                activeTab = 'events';
                return renderDashboard();
            }
            if (action === 'player-edit') return editPlayer();
            if (action === 'stat-add') return addStat();
            if (action === 'item-add') return addItem();
            if (action === 'storage-add') return addStorage();
            if (action === 'skill-add') return addSkill();
            if (action === 'quest-add') return addQuest();
            if (action === 'event-add') return addEvent();

            if (action === 'money-edit') {
                const p = getState().player;
                const money = prompt('Money / funds', String(p.money));
                if (money === null) return;
                const currency = prompt('Currency name', p.currency) ?? p.currency;
                await mutateState(s => {
                    s.player.money = Number(money) || 0;
                    s.player.currency = currency.trim() || s.player.currency;
                });
                return renderDashboard();
            }

            if (action === 'attribute-plus') {
                const key = button.closest('[data-attribute]')?.dataset.attribute;
                await mutateState(s => {
                    if (!s.player.hasSystem || s.player.statPoints <= 0 || !CORE_ATTRIBUTES.includes(key)) return;
                    s.player.attributes[key] = (Number(s.player.attributes[key]) || 0) + 1;
                    s.player.statPoints -= 1;
                });
                return renderDashboard();
            }

            if (action === 'capacity-edit') {
                const p = getState().player;
                if (inventoryTab === 'stored') {
                    const storage = p.storageLocations.find(x => x.id === activeStorageId);
                    if (!storage) return;
                    const next = prompt(`Capacity for ${storage.name}`, String(storage.capacity));
                    if (next === null) return;
                    await mutateState(s => {
                        const x = s.player.storageLocations.find(v => v.id === activeStorageId);
                        if (x) x.capacity = Math.max(1, Number(next) || 1);
                    });
                } else {
                    const key = inventoryTab === 'person' ? 'onPerson' : 'clothing';
                    const next = prompt('Slot capacity', String(p.inventoryLimits[key]));
                    if (next === null) return;
                    await mutateState(s => { s.player.inventoryLimits[key] = Math.max(1, Number(next) || 1); });
                }
                return renderDashboard();
            }

            if (action === 'storage-edit') {
                const storage = getState().player.storageLocations.find(x => x.id === activeStorageId);
                if (!storage) return;
                const name = prompt('Storage name', storage.name) ?? storage.name;
                const cap = prompt('Slot capacity', String(storage.capacity));
                await mutateState(s => {
                    const x = s.player.storageLocations.find(v => v.id === activeStorageId);
                    if (!x) return;
                    x.name = name.trim() || x.name;
                    if (cap !== null) x.capacity = Math.max(1, Number(cap) || x.capacity);
                });
                return renderDashboard();
            }

            const statRow = button.closest('[data-stat-id]');
            if (statRow) {
                const id = statRow.dataset.statId;
                if (action === 'stat-edit') return editStat(id);
                if (action === 'stat-delete' && confirm('Delete this stat?')) {
                    await mutateState(s => { s.player.stats = s.player.stats.filter(x => x.id !== id); });
                    return renderDashboard();
                }
            }

            const itemRow = button.closest('[data-item-id]');
            if (itemRow) {
                const id = itemRow.dataset.itemId;
                if (action === 'item-move') return moveItem(id);
                await mutateState(s => {
                    const item = s.player.inventory.find(x => x.id === id);
                    if (!item) return;
                    if (action === 'item-plus') item.quantity += 1;
                    if (action === 'item-minus') item.quantity = Math.max(0, item.quantity - 1);
                    if (action === 'item-equip') item.equipped = !item.equipped;
                    if (action === 'item-delete') item.quantity = 0;
                    s.player.inventory = s.player.inventory.filter(x => x.quantity > 0);
                });
                return renderDashboard();
            }

            const skillRow = button.closest('[data-skill-id]');
            if (skillRow) {
                const id = skillRow.dataset.skillId;
                if (action === 'skill-edit') return editSkill(id);
                if (action === 'skill-delete' && confirm('Delete this skill?')) {
                    await mutateState(s => { s.player.skills = s.player.skills.filter(x => x.id !== id); });
                    return renderDashboard();
                }
            }

            const questRow = button.closest('[data-quest-id]');
            if (questRow) {
                const id = questRow.dataset.questId;
                if (action === 'quest-edit') return editQuest(id);
                if (action === 'quest-delete' && confirm('Delete this quest?')) {
                    await mutateState(s => { s.quests = s.quests.filter(x => x.id !== id); });
                    return renderDashboard();
                }
            }

            const eventRow = button.closest('[data-event-id]');
            if (eventRow && action === 'event-delete') {
                const id = eventRow.dataset.eventId;
                await mutateState(s => { s.events = s.events.filter(x => x.id !== id); });
                return renderDashboard();
            }

            if (action === 'event-clear' && confirm('Clear all tracked events for this chat?')) {
                await mutateState(s => { s.events = []; });
                return renderDashboard();
            }
        });
    });
}

export function mountDashboard() {
    let root = document.getElementById(ID);
    if (!root) {
        root = document.createElement('aside');
        root.id = ID;
        document.body.appendChild(root);
    }

    applyDashboardGeometry(root);
    installResizePersistence(root);

    if (!document.getElementById(TOGGLE_ID)) {
        const toggle = document.createElement('button');
        toggle.id = TOGGLE_ID;
        toggle.type = 'button';
        toggle.title = 'Open System';
        toggle.innerHTML = '◇';
        toggle.addEventListener('click', () => {
            const panel = document.getElementById(ID);
            panel?.classList.remove('npcb-side-hidden');
            if (panel) applyDashboardGeometry(panel);
            toggle.classList.remove('visible');
        });
        document.body.appendChild(toggle);
    }

    if (!listenersInstalled) {
        listenersInstalled = true;
        window.addEventListener('npcb:state-changed', renderDashboard);
        window.addEventListener('npcb:tracker-status', event => {
            trackerStatus = event.detail || trackerStatus;
            renderDashboard();
        });
        window.addEventListener('npcb:archive-changed', () => {
            if (activeTab === 'npc') renderDashboard();
        });
        window.addEventListener('resize', () => {
            const panel = document.getElementById(ID);
            if (!panel || panel.dataset.userGeometry !== '1') return;
            const safe = clampPanelRect(panel.getBoundingClientRect());
            panel.style.left = `${safe.left}px`;
            panel.style.top = `${safe.top}px`;
            panel.style.width = `${safe.width}px`;
            panel.style.height = `${safe.height}px`;
            persistCurrentGeometry(panel);
        });
    }

    renderDashboard();
}

export function renderDashboard() {
    const root = document.getElementById(ID);
    if (!root) return;
    const state = getState();

    const renders = {
        status: renderStatus,
        inventory: renderInventory,
        quests: renderQuests,
        skills: renderSkills,
        npc: renderCharacters,
        events: renderEvents,
        tracker: renderTrackerSettings,
    };
    if (!renders[activeTab]) activeTab = 'status';

    const body = renders[activeTab](state);
    const tabOrder = getDashboardPrefs().tabOrder;

    root.innerHTML = `
        <div class="npcb-side-header npcb-system-header" title="Drag here to move the System panel">
            <div class="npcb-drag-grip" aria-hidden="true">⋮⋮</div>
            <div class="npcb-side-brand"><span>◇</span><strong>THE SYSTEM</strong></div>
            <div class="npcb-side-status ${statusClass()}">${escapeHtml(statusLabel())}</div>
            <button class="npcb-side-close" title="Hide System">×</button>
        </div>
        <div class="npcb-side-tabs npcb-system-tabs" title="Drag tabs to reorder">
            ${tabOrder.map(key => `<button draggable="true" data-tab="${key}" class="${activeTab === key ? 'active' : ''}" title="Drag to reorder">${TAB_DEFS[key]}</button>`).join('')}
        </div>
        <div class="npcb-side-body">${body}</div>
        <div class="npcb-side-footer npcb-system-footer">
            <span>${escapeHtml(state.scene.summary || 'Awaiting System data')}</span>
            <b>v0.5.0</b>
        </div>
    `;

    applyDashboardGeometry(root);
    bindEvents(root);
}
