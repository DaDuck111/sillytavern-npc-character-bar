import { CORE_ATTRIBUTES, getState, mutateState } from './store.js';
import { scanLatestRoleplay } from './autoTracker.js';
import { openArchive, openWorkshop, renderBar } from './ui.js';
import { createArchiveGroup, getGlobalArchive, setNpcGroups } from './globalArchive.js';
import { escapeHtml, getContext, uid } from './utils.js';

const ID = 'npcb-dashboard';
const TOGGLE_ID = 'npcb-dashboard-toggle';

let activeTab = 'status';
let inventoryTab = 'person';
let activeStorageId = '';
let questCategory = 'all';
let npcSceneOnly = true;
let npcGroupFilter = 'all';
let npcFactionFilter = 'all';
let trackerStatus = { status: 'idle', message: 'Waiting for roleplay.' };
let listenersInstalled = false;

const DASH_PREF_KEY = 'npc_character_bar_dashboard_v2';
const DEFAULT_THEME = Object.freeze({
    accentColor: '#4bdcff',
    panelColor: '#050b12',
});
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
        accentColor: /^#[0-9a-f]{6}$/i.test(raw.accentColor || '') ? raw.accentColor : DEFAULT_THEME.accentColor,
        panelColor: /^#[0-9a-f]{6}$/i.test(raw.panelColor || '') ? raw.panelColor : DEFAULT_THEME.panelColor,
    };
}

function saveDashboardPrefs(patch) {
    const ctx = getContext();
    ctx.extensionSettings ||= {};
    const current = getDashboardPrefs();
    ctx.extensionSettings[DASH_PREF_KEY] = { ...current, ...patch };
    ctx.saveSettingsDebounced?.();
}

function hexToRgb(hex) {
    const clean = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(clean)) return [75, 220, 255];
    return [
        parseInt(clean.slice(0, 2), 16),
        parseInt(clean.slice(2, 4), 16),
        parseInt(clean.slice(4, 6), 16),
    ];
}

function applyThemePrefs() {
    const prefs = getDashboardPrefs();
    const [ar, ag, ab] = hexToRgb(prefs.accentColor);
    const [pr, pg, pb] = hexToRgb(prefs.panelColor);
    const style = document.documentElement.style;
    style.setProperty('--npcb-accent', prefs.accentColor);
    style.setProperty('--npcb-accent-rgb', `${ar}, ${ag}, ${ab}`);
    style.setProperty('--npcb-panel', prefs.panelColor);
    style.setProperty('--npcb-panel-rgb', `${pr}, ${pg}, ${pb}`);
}

function clampPanelRect(rect) {
    const margin = 6;
    const availableWidth = Math.max(260, window.innerWidth - margin * 2);
    const availableHeight = Math.max(300, window.innerHeight - margin * 2);
    const minWidth = Math.min(320, availableWidth);
    const minHeight = Math.min(360, availableHeight);
    const width = Math.max(minWidth, Math.min(Number(rect.width) || 390, availableWidth));
    const height = Math.max(minHeight, Math.min(Number(rect.height) || 700, availableHeight));
    const left = Math.max(margin, Math.min(Number(rect.left) || margin, Math.max(margin, window.innerWidth - width - margin)));
    const top = Math.max(margin, Math.min(Number(rect.top) || margin, Math.max(margin, window.innerHeight - height - margin)));
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
    if (trackerStatus.status === 'scanning') return 'TRACKER SCANNING';
    if (trackerStatus.status === 'error') return 'TRACKER ERROR';
    if (trackerStatus.status === 'ready') return 'TRACKER ONLINE';
    return 'TRACKER IDLE';
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
    const equipped = (player.titles || []).find(title => title.id === player.equippedTitleId || title.equipped);
    return equipped?.name || player.title || player.className || 'AWAKENED';
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
    const modifiers = Object.fromEntries(CORE_ATTRIBUTES.map(key => [key, 0]));
    for (const skill of player.skills || []) {
        if (skill.type !== 'passive') continue;
        for (const key of CORE_ATTRIBUTES) modifiers[key] += Number(skill.modifiers?.[key]) || 0;
    }
    for (const effect of player.effects || []) {
        for (const key of CORE_ATTRIBUTES) modifiers[key] += Number(effect.modifiers?.[key]) || 0;
    }
    const equippedTitle = (player.titles || []).find(title => title.id === player.equippedTitleId || title.equipped);
    if (equippedTitle) {
        for (const key of CORE_ATTRIBUTES) modifiers[key] += Number(equippedTitle.modifiers?.[key]) || 0;
    }

    return `
        <div class="npcb-system-section-head">
            <span>CORE ATTRIBUTES</span>
            <b>${escapeHtml(player.statPoints)} POINT${Number(player.statPoints) === 1 ? '' : 'S'} AVAILABLE</b>
        </div>
        <div class="npcb-attribute-grid">
            ${CORE_ATTRIBUTES.map(key => {
                const base = Number(player.attributes?.[key]) || 0;
                const mod = Number(modifiers[key]) || 0;
                const effective = base + mod;
                return `
                    <div class="npcb-attribute-card" data-attribute="${key}" title="${mod ? `Base ${base} · Modifier ${mod > 0 ? '+' : ''}${mod}` : `Base ${base}`}">
                        <small>${key}</small>
                        <strong>${escapeHtml(effective)}</strong>
                        ${mod ? `<em>${mod > 0 ? '+' : ''}${escapeHtml(mod)} EFFECT</em>` : '<em>BASE</em>'}
                        <button data-action="attribute-plus" ${canSpend ? '' : 'disabled'}>＋</button>
                    </div>
                `;
            }).join('')}
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

function approximateTimeFromDayPart(dayPart = '') {
    const key = String(dayPart).trim().toLowerCase();
    const map = {
        dawn: '~06:00',
        morning: '~09:00',
        noon: '~12:00',
        midday: '~12:00',
        afternoon: '~15:00',
        evening: '~19:00',
        night: '~22:00',
        'late night': '~01:00',
    };
    return map[key] || '';
}

function renderWorldState(state) {
    const scene = state.scene || {};
    const display = {
        ...scene,
        time: String(scene.time || '').trim() || approximateTimeFromDayPart(scene.dayPart) || 'Not established',
    };
    const chips = worldConditionChips(display);
    return `
        <div class="npcb-system-section-head"><span>RP WORLD STATE</span><div><b>STORY TIME</b><button data-action="world-edit">EDIT</button></div></div>
        <div class="npcb-world-state">
            ${chips}
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

        <div class="npcb-system-resource-grid npcb-fund-grid">
            <div class="npcb-fund-card system-fund">
                <small>SYSTEM FUND</small>
                <strong>${escapeHtml((p.funds?.system?.amount ?? 0).toLocaleString?.() ?? p.funds?.system?.amount ?? 0)} <em>${escapeHtml(p.funds?.system?.currency || 'Gold')}</em></strong>
                <button data-action="fund-edit" data-fund-kind="system">EDIT</button>
            </div>
            <div class="npcb-fund-card real-fund">
                <small>REAL-WORLD / SETTING FUND</small>
                <strong>${escapeHtml((p.funds?.real?.amount ?? 0).toLocaleString?.() ?? p.funds?.real?.amount ?? 0)} <em>${escapeHtml(p.funds?.real?.currency || 'Currency unknown')}</em></strong>
                <button data-action="fund-edit" data-fund-kind="real">EDIT</button>
            </div>
            <div class="npcb-location-card"><small>LOCATION</small><strong>${escapeHtml(p.currentLocation || state.scene.location || 'Unknown')}</strong></div>
        </div>

        ${renderWorldState(state)}

        <div class="npcb-system-section-head"><span>VITAL / CUSTOM STATS</span><button data-action="stat-add">＋ ADD STAT</button></div>
        <div class="npcb-system-stats">${stats || '<div class="npcb-side-empty">No custom stats configured.</div>'}</div>

        <div class="npcb-system-section-head"><span>RESISTANCES</span><button data-action="resistance-add">＋ ADD</button></div>
        <div class="npcb-resistance-grid">
            ${(p.resistances || []).length ? p.resistances.map(resistance => `
                <div class="npcb-resistance-card" data-resistance-id="${escapeHtml(resistance.id)}">
                    <div><strong>${escapeHtml(resistance.name)}</strong><span>${escapeHtml(resistance.value)}%</span></div>
                    <div class="npcb-resistance-bar"><i style="width:${Math.max(0, Math.min(100, (Number(resistance.value) + 100) / 2))}%"></i></div>
                    ${resistance.description ? `<small>${escapeHtml(resistance.description)}</small>` : ''}
                    <div><label><input class="npcb-resistance-ai" type="checkbox" ${resistance.aiTrack !== false ? 'checked' : ''}> AI</label><button data-action="resistance-edit">EDIT</button><button data-action="resistance-delete">×</button></div>
                </div>
            `).join('') : '<div class="npcb-side-empty">No resistances tracked.</div>'}
        </div>

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

        <div class="npcb-inventory-funds">
            <div>
                <span>SYSTEM FUND</span>
                <strong>${escapeHtml((p.funds?.system?.amount ?? 0).toLocaleString?.() ?? p.funds?.system?.amount ?? 0)} ${escapeHtml(p.funds?.system?.currency || 'Gold')}</strong>
                <button data-action="fund-edit" data-fund-kind="system">EDIT</button>
            </div>
            <div>
                <span>REAL-WORLD / SETTING FUND</span>
                <strong>${escapeHtml((p.funds?.real?.amount ?? 0).toLocaleString?.() ?? p.funds?.real?.amount ?? 0)} ${escapeHtml(p.funds?.real?.currency || 'Currency unknown')}</strong>
                <button data-action="fund-edit" data-fund-kind="real">EDIT</button>
            </div>
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

function getPlayerResource(player, resourceName) {
    const needle = String(resourceName || '').trim().toLowerCase();
    if (!needle) return null;
    return (player.stats || []).find(stat => String(stat.name || '').trim().toLowerCase() === needle) || null;
}

function skillUsability(player, skill) {
    const reasons = [];
    const remaining = String(skill.remainingCooldown || '').trim().toLowerCase();
    if (remaining && !['0', 'ready', 'none', 'off'].includes(remaining)) reasons.push(`Cooldown: ${skill.remainingCooldown}`);

    for (const [key, minimum] of Object.entries(skill.requirements?.attributes || {})) {
        if (Number(minimum) > 0 && Number(player.attributes?.[key] || 0) < Number(minimum)) {
            reasons.push(`${key} ${player.attributes?.[key] || 0}/${minimum}`);
        }
    }

    if (skill.cost?.resource && Number(skill.cost.amount) > 0) {
        const stat = getPlayerResource(player, skill.cost.resource);
        if (stat && Number(stat.value) < Number(skill.cost.amount)) {
            reasons.push(`${skill.cost.resource} ${stat.value}/${skill.cost.amount}`);
        }
    }

    return {
        usable: reasons.length === 0,
        reasons,
        contextualRequirement: String(skill.requirements?.text || '').trim(),
    };
}

function renderSkills(state) {
    const p = state.player;
    const cards = (p.skills || []).map(skill => {
        const check = skillUsability(p, skill);
        const modifiers = Object.entries(skill.modifiers || {})
            .filter(([, value]) => Number(value) !== 0)
            .map(([key, value]) => `${key} ${Number(value) > 0 ? '+' : ''}${value}`);
        return `
            <div class="npcb-skill-card npcb-skill-card-v2" data-skill-id="${escapeHtml(skill.id)}">
                <div class="npcb-skill-card-head">
                    <div class="npcb-skill-rank">${escapeHtml(skill.rank || '—')}</div>
                    <div>
                        <strong>${escapeHtml(skill.name)}</strong>
                        <small>${escapeHtml((skill.type || 'active').toUpperCase())}</small>
                    </div>
                    <span class="npcb-skill-availability ${check.usable ? 'ready' : 'blocked'}">${check.usable ? 'READY' : 'LIMITED'}</span>
                </div>
                <p>${escapeHtml(skill.description || 'No explanation recorded yet.')}</p>
                <div class="npcb-skill-meta">
                    ${skill.cost?.resource && Number(skill.cost.amount) > 0 ? `<span><b>COST</b>${escapeHtml(skill.cost.amount)} ${escapeHtml(skill.cost.resource)}</span>` : ''}
                    ${skill.cooldown ? `<span><b>COOLDOWN</b>${escapeHtml(skill.cooldown)}</span>` : ''}
                    ${skill.remainingCooldown ? `<span><b>REMAINING</b>${escapeHtml(skill.remainingCooldown)}</span>` : ''}
                    ${skill.requirements?.text ? `<span><b>REQUIRES</b>${escapeHtml(skill.requirements.text)}</span>` : ''}
                </div>
                ${modifiers.length || skill.effects?.length ? `
                    <div class="npcb-skill-effects">
                        ${modifiers.map(text => `<i>${escapeHtml(text)}</i>`).join('')}
                        ${(skill.effects || []).map(text => `<i>${escapeHtml(text)}</i>`).join('')}
                    </div>
                ` : ''}
                ${!check.usable ? `<div class="npcb-skill-block-reason">${escapeHtml(check.reasons.join(' · '))}</div>` : ''}
                <div class="npcb-skill-actions"><button data-action="skill-edit">EDIT</button><button data-action="skill-delete">×</button></div>
            </div>
        `;
    }).join('');

    const effects = (p.effects || []).map(effect => {
        const mods = Object.entries(effect.modifiers || {})
            .filter(([, value]) => Number(value) !== 0)
            .map(([key, value]) => `${key} ${Number(value) > 0 ? '+' : ''}${value}`);
        return `
            <div class="npcb-effect-row ${effect.harmful ? 'harmful' : 'beneficial'}" data-effect-id="${escapeHtml(effect.id)}">
                <div>
                    <strong>${escapeHtml(effect.name)}</strong>
                    <span>${escapeHtml(effect.description || effect.source || 'Status effect')}</span>
                </div>
                <div class="npcb-effect-tags">
                    ${effect.duration ? `<i>${escapeHtml(effect.duration)}</i>` : ''}
                    ${mods.map(text => `<i>${escapeHtml(text)}</i>`).join('')}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="npcb-system-section-head"><span>ACQUIRED SKILLS</span><button data-action="skill-add">＋ ADD SKILL</button></div>
        <div class="npcb-skill-grid">${cards || '<div class="npcb-side-empty">No skills acquired yet.</div>'}</div>

        <div class="npcb-system-section-head"><span>ACTIVE STATUS EFFECTS</span></div>
        <div class="npcb-effect-list">${effects || '<div class="npcb-side-empty">No active buffs/debuffs.</div>'}</div>

        <div class="npcb-system-section-head"><span>TITLES</span><button data-action="title-add">＋ ADD TITLE</button></div>
        <div class="npcb-title-list">
            ${p.titles?.length ? p.titles.map(title => {
                const equipped = title.id === p.equippedTitleId || title.equipped;
                const mods = Object.entries(title.modifiers || {})
                    .filter(([, value]) => Number(value) !== 0)
                    .map(([key, value]) => `${key} ${Number(value) > 0 ? '+' : ''}${value}`);
                return `
                    <article class="npcb-title-card ${equipped ? 'equipped' : ''}" data-title-id="${escapeHtml(title.id)}">
                        <div class="npcb-title-head">
                            <div><small>${equipped ? 'EQUIPPED TITLE' : 'TITLE'}</small><strong>${escapeHtml(title.name)}</strong></div>
                            <button data-action="title-equip">${equipped ? 'UNEQUIP' : 'EQUIP'}</button>
                        </div>
                        <p>${escapeHtml(title.description || 'No description recorded.')}</p>
                        ${mods.length || title.effects?.length ? `
                            <div class="npcb-title-effects">
                                ${mods.map(text => `<i>${escapeHtml(text)}</i>`).join('')}
                                ${(title.effects || []).map(text => `<i>${escapeHtml(text)}</i>`).join('')}
                            </div>` : ''}
                        <div class="npcb-title-actions"><button data-action="title-edit">EDIT</button><button data-action="title-delete">×</button></div>
                    </article>
                `;
            }).join('') : '<div class="npcb-side-empty">No titles acquired yet.</div>'}
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
    const typeOrder = ['main', 'side', 'system'];
    const typeLabels = { main: 'MAIN', side: 'SIDE', system: 'SYSTEM' };
    let quests = [...(state.quests || [])].sort((a, b) => {
        const statusRank = { active: 0, completed: 1, failed: 2, hidden: 3 };
        const typeRank = Object.fromEntries(typeOrder.map((type, index) => [type, index]));
        return (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9)
            || (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9)
            || String(b.updatedAt).localeCompare(String(a.updatedAt));
    });

    if (questCategory !== 'all') quests = quests.filter(q => q.type === questCategory);

    const grouped = typeOrder
        .map(type => [type, quests.filter(q => q.type === type)])
        .filter(([, list]) => list.length);

    return `
        <div class="npcb-system-section-head"><span>QUEST LOG</span><button data-action="quest-add">＋ ADD QUEST</button></div>
        <div class="npcb-quest-category-tabs">
            ${[
                ['all', 'ALL'],
                ...typeOrder.map(type => [type, typeLabels[type]]),
            ].map(([key,label]) => `<button data-quest-category="${key}" class="${questCategory === key ? 'active' : ''}">${label}</button>`).join('')}
        </div>
        <div class="npcb-quest-groups">
            ${grouped.length ? grouped.map(([type, list]) => `
                <section class="npcb-quest-group type-${type}">
                    <div class="npcb-quest-group-head"><span>${typeLabels[type]} QUESTS</span><b>${list.length}</b></div>
                    <div class="npcb-quest-list">${list.map(renderQuestCard).join('')}</div>
                </section>
            `).join('') : '<div class="npcb-side-empty">No quests in this category.</div>'}
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

function characterRows(state, chars, archive) {
    const rank = { present: 0, nearby: 1, away: 2, unknown: 3, missing: 4, inactive: 5, dead: 6 };
    chars.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.name.localeCompare(b.name));

    if (!chars.length) {
        return '<div class="npcb-side-empty">No NPCs match this view.</div>';
    }

    return chars.map(c => {
        const portrait = c.portrait
            ? `<img src="${escapeHtml(c.portrait)}" alt="">`
            : `<div class="npcb-side-avatar-fallback">${escapeHtml(c.name.trim().slice(0, 2).toUpperCase() || '?')}</div>`;
        const rel = clampRelationship(c.relationship?.value || 0);
        const archiveEntry = c.archiveId ? archive.npcs?.[c.archiveId] : null;
        const groups = (archiveEntry?.groupIds || []).map(id => archive.groups?.[id]).filter(Boolean);
        const manaKnown = Number(c.vitals?.maxMana) > 0;

        return `
            <div class="npcb-side-character npcb-npc-vital-card status-${escapeHtml(c.status)}" data-id="${escapeHtml(c.id)}">
                <div class="npcb-side-avatar">${portrait}<span class="npcb-side-presence"></span></div>
                <div class="npcb-side-character-text">
                    <div class="npcb-npc-name-line">
                        <strong>${escapeHtml(c.name)}</strong>
                        ${c.system?.hasSystem ? `<i>SYS · LV${escapeHtml(c.system.level)}</i>` : ''}
                    </div>
                    <span>${escapeHtml(c.role || c.scene?.action || c.faction || 'NPC')}</span>
                    <div class="npcb-npc-mini-bars npcb-npc-mini-bars-v2">
                        <div title="HP ${escapeHtml(c.vitals?.hp ?? 0)} / ${escapeHtml(c.vitals?.maxHp ?? 100)}"><i class="hp" style="width:${pct(c.vitals?.hp, c.vitals?.maxHp)}%"></i><b>HP</b></div>
                        <div title="${manaKnown ? `Mana ${c.vitals.mana} / ${c.vitals.maxMana}` : 'Mana not established'}"><i class="mana" style="width:${manaKnown ? pct(c.vitals?.mana, c.vitals?.maxMana) : 0}%"></i><b>MP</b></div>
                        <div title="Fatigue"><i class="fatigue" style="width:${pct(c.vitals?.fatigue, c.vitals?.maxFatigue)}%"></i><b>FAT</b></div>
                        <div title="Relationship"><i class="relationship" style="width:${relationshipPct(rel)}%"></i><b>REL</b></div>
                    </div>
                    ${groups.length ? `<div class="npcb-npc-group-chips">${groups.map(group => `<i>${escapeHtml(group.name)}</i>`).join('')}</div>` : ''}
                </div>
                <div class="npcb-npc-card-side">
                    <small>${escapeHtml(c.status)}</small>
                    <button type="button" data-action="npc-group-assign" title="Assign folders/groups">GROUP</button>
                </div>
            </div>`;
    }).join('');
}

function renderCharacters(state) {
    const archive = getGlobalArchive();
    const groups = Object.values(archive.groups || {}).sort((a, b) => a.name.localeCompare(b.name));
    const allChars = state.order.map(id => state.characters[id]).filter(Boolean);
    const present = allChars.filter(c => ['present', 'nearby'].includes(c.status)).length;

    const factions = [...new Set(allChars.map(c => String(c.faction || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b));
    let chars = allChars;
    if (npcSceneOnly) chars = chars.filter(c => ['present', 'nearby'].includes(c.status));
    if (npcGroupFilter !== 'all') {
        chars = chars.filter(c => {
            const entry = c.archiveId ? archive.npcs?.[c.archiveId] : null;
            return (entry?.groupIds || []).includes(npcGroupFilter);
        });
    }
    if (npcFactionFilter !== 'all') chars = chars.filter(c => (c.faction || '') === npcFactionFilter);

    const factionGroups = Object.entries(chars.reduce((acc, character) => {
        const key = String(character.faction || '').trim() || 'Unaffiliated';
        (acc[key] ||= []).push(character);
        return acc;
    }, {})).sort(([a],[b]) => a === 'Unaffiliated' ? 1 : b === 'Unaffiliated' ? -1 : a.localeCompare(b));

    return `
        <div class="npcb-side-actions">
            <button class="npcb-side-scan"><span>↻</span> Scan latest RP</button>
            <button class="npcb-side-archive">Global Archive</button>
        </div>

        <div class="npcb-npc-view-tools">
            <label><input type="checkbox" class="npcb-npc-scene-only" ${npcSceneOnly ? 'checked' : ''}> SCENE ONLY</label>
            <select class="npcb-npc-group-filter">
                <option value="all">All folders</option>
                ${groups.map(group => `<option value="${escapeHtml(group.id)}" ${npcGroupFilter === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}
            </select>
            <select class="npcb-npc-faction-filter">
                <option value="all">All factions</option>
                ${factions.map(faction => `<option value="${escapeHtml(faction)}" ${npcFactionFilter === faction ? 'selected' : ''}>${escapeHtml(faction)}</option>`).join('')}
            </select>
            <button data-action="npc-group-create">＋ FOLDER</button>
        </div>

        <div class="npcb-side-section-title"><span>NPC VITAL TRACKER</span><small>${present} in scene · ${allChars.length} linked</small></div>
        <div class="npcb-side-character-list">
            ${factionGroups.length ? factionGroups.map(([faction, list]) => `
                <section class="npcb-faction-section">
                    <div class="npcb-faction-head"><span>◈ ${escapeHtml(faction)}</span><b>${list.length}</b></div>
                    ${characterRows(state, list, archive)}
                </section>
            `).join('') : '<div class="npcb-side-empty">No NPCs match this view.</div>'}
        </div>
        <div class="npcb-npc-legend">
            <span>HP</span><span class="mana">MANA</span><span>FATIGUE</span><span>RELATIONSHIP</span>
            <em>Scene Only hides NPCs who are not currently present/nearby. Detailed STR/DEX/INT/STA/SEN remains System-only.</em>
        </div>
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
        ${toggle('tracker.trackSkills', t.trackSkills !== false, 'Track skills, cooldowns & effects', 'Record skill details, cooldown state, titles and buffs/debuffs.')}
        ${toggle('tracker.trackMoney', t.trackMoney !== false, 'Track both funds', 'Track System Gold separately from ordinary setting/story currency.')}
        ${toggle('tracker.trackQuests', t.trackQuests !== false, 'Track quests', 'Create/update Main, Side and System quests from clear objectives.')}
        ${toggle('tracker.trackEvents', t.trackEvents !== false, 'Track events', 'Record compact story developments for continuity after RP replies.')}
        ${toggle('tracker.injectGameState', t.injectGameState !== false, 'Respect RPG constraints in RP', 'Inject a compact live state so the roleplay model considers injuries, resources, cooldowns, requirements and status effects.')}
        ${toggle('tracker.trackNpcVitals', t.trackNpcVitals !== false, 'Track NPC HP/Mana/Fatigue', 'Maintain lightweight vitals for recurring NPCs.')}
        ${toggle('ui.autoRegisterTrackerNPCs', state.ui.autoRegisterTrackerNPCs !== false, 'Auto-register NPCs', 'Save newly detected named NPCs.')}
        ${toggle('ui.showAwayOnBar', Boolean(state.ui.showAwayOnBar), 'Show away NPC covers', 'Keep absent NPCs on portrait shelf.')}
        ${toggle('ui.compact', Boolean(state.ui.compact), 'Compact NPC covers', 'Use smaller portrait covers.')}

        <label class="npcb-side-number">
            <div><strong>System context depth</strong><span>Recent messages sent to extractor (2–20).</span></div>
            <input type="number" min="2" max="20" step="1" data-setting="tracker.contextDepth" value="${Number(t.contextDepth || 6)}">
        </label>

        <div class="npcb-theme-settings">
            <div class="npcb-system-section-head"><span>UI THEME</span><button type="button" data-action="theme-reset">RESET</button></div>
            <label class="npcb-theme-color">
                <div><strong>Accent color</strong><span>Highlights, borders, bars and glow.</span></div>
                <input type="color" data-theme-color="accentColor" value="${escapeHtml(getDashboardPrefs().accentColor)}">
            </label>
            <label class="npcb-theme-color">
                <div><strong>Panel background</strong><span>Main dark background tint.</span></div>
                <input type="color" data-theme-color="panelColor" value="${escapeHtml(getDashboardPrefs().panelColor)}">
            </label>
            <div class="npcb-theme-presets">
                ${['#4bdcff','#8d7cff','#55db91','#ffb347','#ff6685','#f2f2f2'].map(color => `<button type="button" data-theme-preset="${color}" style="--swatch:${color}" title="${color}"></button>`).join('')}
            </div>
        </div>

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

    const name = prompt('Player name', p.name);
    if (name === null) return;
    const title = prompt('Title', p.title);
    if (title === null) return;
    const className = prompt('Class / role', p.className);
    if (className === null) return;
    const systemAnswer = prompt('Has System? yes / no', p.hasSystem ? 'yes' : 'no');
    if (systemAnswer === null) return;
    const hasSystem = /^y(es)?$/i.test(systemAnswer.trim());

    let level = p.level;
    let xp = p.xp;
    let xpToNext = p.xpToNext;
    let pointsPerLevel = Math.max(0, Number(p.statPointsPerLevel) || 5);

    if (hasSystem) {
        const levelRaw = prompt('Level', String(Math.max(1, p.level || 1)));
        if (levelRaw === null) return;
        const xpRaw = prompt('Current XP', String(p.xp || 0));
        if (xpRaw === null) return;
        const xpToNextRaw = prompt('XP needed for next level', String(p.xpToNext || 100));
        if (xpToNextRaw === null) return;
        const pointsRaw = prompt('Allocatable stat points gained per level', String(pointsPerLevel));
        if (pointsRaw === null) return;

        level = Math.max(1, Number(levelRaw) || 1);
        xp = Math.max(0, Number(xpRaw) || 0);
        xpToNext = Math.max(1, Number(xpToNextRaw) || 100);
        pointsPerLevel = Math.max(0, Number(pointsRaw) || 0);
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
    if (name === null || !name.trim()) return;
    const valueRaw = prompt('Starting value', '100');
    if (valueRaw === null) return;
    const maxRaw = prompt('Maximum value', '100');
    if (maxRaw === null) return;
    const unit = prompt('Unit (%, pts, etc.)', '');
    if (unit === null) return;

    const value = Number.parseFloat(valueRaw);
    const max = Number.parseFloat(maxRaw);
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

    const name = prompt('Stat name', stat.name);
    if (name === null) return;
    const value = prompt('Current value', String(stat.value));
    if (value === null) return;
    const max = prompt('Maximum value', String(stat.max));
    if (max === null) return;
    const unit = prompt('Unit', stat.unit);
    if (unit === null) return;

    await mutateState(s => {
        const x = s.player.stats.find(v => v.id === id);
        if (!x) return;
        x.name = name.trim() || x.name;
        if (value !== '') x.value = Number.parseFloat(String(value).replace('%','')) || 0;
        if (max !== '') x.max = Math.max(0, Number.parseFloat(String(max).replace('%','')) || 0);
        x.unit = unit;
    });
    renderDashboard();
}
async function addResistance() {
    const name = prompt('Resistance name (Fire, Cold, Poison, Magic, etc.)');
    if (name === null || !name.trim()) return;
    const valueRaw = prompt('Resistance % (-100 vulnerability to +100 resistance)', '0');
    if (valueRaw === null) return;
    const description = prompt('Notes / source', '');
    if (description === null) return;

    const value = Math.max(-100, Math.min(100, Number.parseFloat(String(valueRaw).replace('%','')) || 0));
    await mutateState(s => {
        s.player.resistances ||= [];
        s.player.resistances.push({
            id: uid('resist'),
            name: name.trim(),
            value,
            description: description.trim(),
            aiTrack: true,
        });
    });
    renderDashboard();
}
async function editResistance(id) {
    const resistance = getState().player.resistances?.find(x => x.id === id);
    if (!resistance) return;

    const name = prompt('Resistance name', resistance.name);
    if (name === null) return;
    const valueRaw = prompt('Resistance % (-100 to +100)', String(resistance.value));
    if (valueRaw === null) return;
    const description = prompt('Notes / source', resistance.description || '');
    if (description === null) return;

    await mutateState(s => {
        const x = s.player.resistances?.find(v => v.id === id);
        if (!x) return;
        x.name = name.trim() || x.name;
        x.value = Math.max(-100, Math.min(100, Number.parseFloat(String(valueRaw).replace('%','')) || 0));
        x.description = description.trim();
    });
    renderDashboard();
}
async function addItem() {
    const state = getState();
    const name = prompt('Item name');
    if (name === null || !name.trim()) return;
    const quantityRaw = prompt('Quantity', '1');
    if (quantityRaw === null) return;
    const type = prompt('Type (weapon, armor, consumable, quest…)', '');
    if (type === null) return;
    const description = prompt('Description', '');
    if (description === null) return;

    const quantity = Math.max(1, Number(quantityRaw) || 1);

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
    if (name === null || !name.trim()) return;
    const capacityRaw = prompt('Slot capacity', String(state.player.inventoryLimits.defaultStorage || 30));
    if (capacityRaw === null) return;
    const systemOnlyRaw = prompt('System-only storage? yes / no', 'no');
    if (systemOnlyRaw === null) return;

    const capacity = Math.max(1, Number(capacityRaw) || 30);
    const systemOnly = /^y(es)?$/i.test(systemOnlyRaw.trim());
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
    if (name === null || !name.trim()) return;
    const rank = prompt('Rank / level', '');
    if (rank === null) return;
    const typeAnswer = prompt('Type: active / passive / toggle', 'active');
    if (typeAnswer === null) return;
    const description = prompt('What does this skill do?', '');
    if (description === null) return;
    const cooldown = prompt('Cooldown (example: 3 turns, 10 minutes, once/day)', '');
    if (cooldown === null) return;
    const costResource = prompt('Resource cost type (Mana / Stamina / Health / blank)', '');
    if (costResource === null) return;

    let costAmount = 0;
    if (costResource.trim()) {
        const costAmountRaw = prompt('Resource cost amount', '0');
        if (costAmountRaw === null) return;
        costAmount = Math.max(0, Number(costAmountRaw) || 0);
    }

    const requirement = prompt('Requirements / restrictions', '');
    if (requirement === null) return;
    const effects = prompt('Gameplay effects, one per line', '');
    if (effects === null) return;

    const typeRaw = typeAnswer.trim().toLowerCase();
    const type = ['active','passive','toggle'].includes(typeRaw) ? typeRaw : 'active';

    await mutateState(s => s.player.skills.push({
        id: uid('skill'),
        name: name.trim(),
        rank: rank.trim(),
        type,
        description: description.trim(),
        source: 'Manual',
        cooldown: cooldown.trim(),
        remainingCooldown: '',
        cost: { resource: costResource.trim(), amount: costAmount },
        requirements: { text: requirement.trim(), attributes: {} },
        modifiers: {},
        effects: effects.split('\n').map(x => x.trim()).filter(Boolean),
    }));
    renderDashboard();
}
async function editSkill(id) {
    const skill = getState().player.skills.find(x => x.id === id);
    if (!skill) return;

    const name = prompt('Skill name', skill.name);
    if (name === null) return;
    const rank = prompt('Rank / level', skill.rank);
    if (rank === null) return;
    const typeAnswer = prompt('Type: active / passive / toggle', skill.type || 'active');
    if (typeAnswer === null) return;
    const description = prompt('Explanation / effect', skill.description);
    if (description === null) return;
    const cooldown = prompt('Base cooldown', skill.cooldown || '');
    if (cooldown === null) return;
    const remainingCooldown = prompt('Current remaining cooldown (blank = ready)', skill.remainingCooldown || '');
    if (remainingCooldown === null) return;
    const costResource = prompt('Resource cost type', skill.cost?.resource || '');
    if (costResource === null) return;

    let costAmount = 0;
    if (costResource.trim()) {
        const costAmountRaw = prompt('Resource cost amount', String(skill.cost?.amount || 0));
        if (costAmountRaw === null) return;
        costAmount = Math.max(0, Number(costAmountRaw) || 0);
    }

    const requirement = prompt('Requirements / restrictions', skill.requirements?.text || '');
    if (requirement === null) return;
    const effectsRaw = prompt('Gameplay effects, one per line', (skill.effects || []).join('\n'));
    if (effectsRaw === null) return;

    const typeRaw = typeAnswer.trim().toLowerCase();
    await mutateState(s => {
        const x = s.player.skills.find(v => v.id === id);
        if (!x) return;
        x.name = name.trim() || x.name;
        x.rank = rank.trim();
        x.type = ['active','passive','toggle'].includes(typeRaw) ? typeRaw : x.type || 'active';
        x.description = description.trim();
        x.cooldown = cooldown.trim();
        x.remainingCooldown = remainingCooldown.trim();
        x.cost = { resource: costResource.trim(), amount: costAmount };
        x.requirements ||= { text: '', attributes: {} };
        x.requirements.text = requirement.trim();
        x.effects = effectsRaw.split('\n').map(v => v.trim()).filter(Boolean);
    });
    renderDashboard();
}
async function addTitle() {
    const name = prompt('Title name');
    if (name === null || !name.trim()) return;
    const description = prompt('Title description', '');
    if (description === null) return;
    const effectsRaw = prompt('Title effects, one per line', '');
    if (effectsRaw === null) return;

    await mutateState(s => {
        s.player.titles ||= [];
        s.player.titles.push({
            id: uid('title'),
            name: name.trim(),
            equipped: false,
            description: description.trim(),
            effects: effectsRaw.split('\n').map(x => x.trim()).filter(Boolean),
            modifiers: {},
        });
    });
    renderDashboard();
}
async function editTitle(id) {
    const title = getState().player.titles?.find(x => x.id === id);
    if (!title) return;

    const name = prompt('Title name', title.name);
    if (name === null) return;
    const description = prompt('Title description', title.description || '');
    if (description === null) return;
    const effectsRaw = prompt('Title effects, one per line', (title.effects || []).join('\n'));
    if (effectsRaw === null) return;
    const modsRaw = prompt(
        'Attribute modifiers, comma-separated (example: STR:+2, INT:+5)',
        Object.entries(title.modifiers || {}).filter(([,v]) => Number(v) !== 0).map(([k,v]) => `${k}:${v}`).join(', '),
    );
    if (modsRaw === null) return;

    await mutateState(s => {
        const x = s.player.titles?.find(v => v.id === id);
        if (!x) return;
        x.name = name.trim() || x.name;
        x.description = description.trim();
        x.effects = effectsRaw.split('\n').map(v => v.trim()).filter(Boolean);
        x.modifiers = {};
        for (const pair of modsRaw.split(',')) {
            const [keyRaw, valueRaw] = pair.split(':');
            const key = String(keyRaw || '').trim().toUpperCase();
            if (!CORE_ATTRIBUTES.includes(key)) continue;
            const value = Number.parseFloat(String(valueRaw || '').trim());
            if (Number.isFinite(value)) x.modifiers[key] = value;
        }
    });
    renderDashboard();
}
async function addQuest() {
    const title = prompt('Quest title');
    if (title === null || !title.trim()) return;
    const description = prompt('Quest description', '');
    if (description === null) return;
    const type = prompt('Type: main / side / system', 'side');
    if (type === null) return;

    if (type.trim().toLowerCase() === 'system' && !getState().player.hasSystem) {
        alert('A System quest cannot exist before the player acquires a System.');
        return;
    }

    const objectivesRaw = prompt('Objectives, one per line', '');
    if (objectivesRaw === null) return;

    await mutateState(s => s.quests.push({
        id: uid('quest'),
        title: title.trim(),
        type: ['main','side','system'].includes(type.trim().toLowerCase()) ? type.trim().toLowerCase() : 'side',
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

    const title = prompt('Quest title', quest.title);
    if (title === null) return;
    const description = prompt('Description', quest.description);
    if (description === null) return;
    const reward = prompt('Reward', quest.reward);
    if (reward === null) return;
    const source = prompt('Source / issuer', quest.source);
    if (source === null) return;

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
    if (title === null || !title.trim()) return;
    const description = prompt('Description', '');
    if (description === null) return;
    const type = prompt('Type (combat, discovery, social, travel, quest, system, acquisition, story)', 'story');
    if (type === null) return;

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

    const answer = prompt('Move to: person / clothing / stored', item.locationType);
    if (answer === null) return;
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
        if (storageName === null || !storageName.trim()) return;
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

    root.querySelectorAll('[data-quest-category]').forEach(button => {
        button.addEventListener('click', () => {
            questCategory = button.dataset.questCategory || 'all';
            renderDashboard();
        });
    });

    root.querySelector('.npcb-storage-select')?.addEventListener('change', event => {
        activeStorageId = event.target.value;
        renderDashboard();
    });

    root.querySelector('.npcb-npc-scene-only')?.addEventListener('change', event => {
        npcSceneOnly = event.target.checked;
        renderDashboard();
    });

    root.querySelector('.npcb-npc-group-filter')?.addEventListener('change', event => {
        npcGroupFilter = event.target.value || 'all';
        renderDashboard();
    });

    root.querySelector('.npcb-npc-faction-filter')?.addEventListener('change', event => {
        npcFactionFilter = event.target.value || 'all';
        renderDashboard();
    });

    root.querySelector('.npcb-side-close')?.addEventListener('click', () => {
        root.classList.add('npcb-side-hidden');
        document.getElementById(TOGGLE_ID)?.classList.add('visible');
    });

    root.querySelectorAll('.npcb-side-character').forEach(row => row.addEventListener('click', event => {
        if (event.target.closest('button, select, input, label')) return;
        openWorkshop(row.dataset.id);
    }));
    root.querySelectorAll('.npcb-side-archive').forEach(button => button.addEventListener('click', openArchive));

    root.querySelectorAll('.npcb-side-scan').forEach(button => {
        button.addEventListener('click', async () => {
            button.disabled = true;
            try { await scanLatestRoleplay({ force: true, manual: true }); }
            finally { button.disabled = false; }
        });
    });

    root.querySelectorAll('[data-theme-color]').forEach(input => {
        input.addEventListener('input', () => {
            saveDashboardPrefs({ [input.dataset.themeColor]: input.value });
            applyThemePrefs();
        });
        input.addEventListener('change', () => renderDashboard());
    });

    root.querySelectorAll('[data-theme-preset]').forEach(button => {
        button.addEventListener('click', () => {
            saveDashboardPrefs({ accentColor: button.dataset.themePreset });
            applyThemePrefs();
            renderDashboard();
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

    root.querySelectorAll('.npcb-resistance-ai').forEach(input => {
        input.addEventListener('change', async () => {
            const id = input.closest('[data-resistance-id]')?.dataset.resistanceId;
            await mutateState(s => {
                const resistance = s.player.resistances?.find(x => x.id === id);
                if (resistance) resistance.aiTrack = input.checked;
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

            if (action === 'theme-reset') {
                saveDashboardPrefs(DEFAULT_THEME);
                applyThemePrefs();
                return renderDashboard();
            }
            if (action === 'open-events') {
                activeTab = 'events';
                return renderDashboard();
            }
            if (action === 'world-edit') {
                const scene = getState().scene;
                const time = prompt('RP time', scene.time);
                if (time === null) return;
                const date = prompt('RP date', scene.date);
                if (date === null) return;
                const day = prompt('Day / weekday', scene.day);
                if (day === null) return;
                const dayPart = prompt('Day part (dawn, morning, afternoon, evening, night...)', scene.dayPart);
                if (dayPart === null) return;
                const weather = prompt('Weather', scene.weather);
                if (weather === null) return;
                const season = prompt('Season', scene.season);
                if (season === null) return;
                const year = prompt('Year', scene.year);
                if (year === null) return;
                const holiday = prompt('Holiday / festival', scene.holiday);
                if (holiday === null) return;

                await mutateState(s => Object.assign(s.scene, {
                    time: time.trim(),
                    date: date.trim(),
                    day: day.trim(),
                    dayPart: dayPart.trim(),
                    weather: weather.trim(),
                    season: season.trim(),
                    year: year.trim(),
                    holiday: holiday.trim(),
                }));
                return renderDashboard();
            }
            if (action === 'npc-group-create') {
                const name = prompt('New NPC group name');
                if (!name?.trim()) return;
                const group = createArchiveGroup(name.trim());
                if (group?.id) npcGroupFilter = group.id;
                return renderDashboard();
            }
            if (action === 'npc-group-assign') {
                const row = button.closest('[data-id]');
                const localId = row?.dataset.id;
                const state = getState();
                const npc = state.characters[localId];
                if (!npc?.archiveId) return;
                const archive = getGlobalArchive();
                const current = archive.npcs?.[npc.archiveId];
                const currentNames = (current?.groupIds || []).map(id => archive.groups?.[id]?.name).filter(Boolean);
                const value = prompt(
                    'NPC groups, comma-separated. You can type new group names too.',
                    currentNames.join(', '),
                );
                if (value === null) return;

                const names = [...new Set(value.split(',').map(x => x.trim()).filter(Boolean))];
                const ids = [];
                let latest = getGlobalArchive();
                for (const name of names) {
                    let group = Object.values(latest.groups || {}).find(g => g.name.toLowerCase() === name.toLowerCase());
                    if (!group) {
                        group = createArchiveGroup(name);
                        latest = getGlobalArchive();
                    }
                    if (group?.id) ids.push(group.id);
                }
                setNpcGroups(npc.archiveId, ids);
                return renderDashboard();
            }
            if (action === 'player-edit') return editPlayer();
            if (action === 'stat-add') return addStat();
            if (action === 'resistance-add') return addResistance();
            if (action === 'item-add') return addItem();
            if (action === 'storage-add') return addStorage();
            if (action === 'skill-add') return addSkill();
            if (action === 'title-add') return addTitle();
            if (action === 'quest-add') return addQuest();
            if (action === 'event-add') return addEvent();

            if (action === 'fund-edit') {
                const kind = button.dataset.fundKind === 'real' ? 'real' : 'system';
                const p = getState().player;
                const fund = p.funds?.[kind] || { amount: 0, currency: kind === 'system' ? 'Gold' : '' };
                const amount = prompt(kind === 'system' ? 'System fund amount' : 'Setting / real-world fund amount', String(fund.amount || 0));
                if (amount === null) return;
                const currency = prompt(
                    kind === 'system' ? 'System currency' : 'Currency used in this story/setting',
                    fund.currency || (kind === 'system' ? 'Gold' : ''),
                );
                if (currency === null) return;
                await mutateState(s => {
                    s.player.funds ||= {
                        system: { amount: 0, currency: 'Gold' },
                        real: { amount: 0, currency: '' },
                    };
                    s.player.funds[kind].amount = Number(amount) || 0;
                    s.player.funds[kind].currency = currency.trim();
                    if (kind === 'system' && !s.player.hasSystem) s.player.funds.system.amount = 0;
                });
                return renderDashboard();
            }

            if (action === 'resistance-edit') {
                const id = button.closest('[data-resistance-id]')?.dataset.resistanceId;
                return editResistance(id);
            }
            if (action === 'resistance-delete') {
                const id = button.closest('[data-resistance-id]')?.dataset.resistanceId;
                await mutateState(s => { s.player.resistances = (s.player.resistances || []).filter(x => x.id !== id); });
                return renderDashboard();
            }
            if (action === 'title-equip') {
                const id = button.closest('[data-title-id]')?.dataset.titleId;
                await mutateState(s => {
                    const next = s.player.equippedTitleId === id ? '' : id;
                    s.player.equippedTitleId = next;
                    for (const title of s.player.titles || []) title.equipped = title.id === next;
                });
                return renderDashboard();
            }
            if (action === 'title-edit') {
                const id = button.closest('[data-title-id]')?.dataset.titleId;
                return editTitle(id);
            }
            if (action === 'title-delete') {
                const id = button.closest('[data-title-id]')?.dataset.titleId;
                await mutateState(s => {
                    s.player.titles = (s.player.titles || []).filter(x => x.id !== id);
                    if (s.player.equippedTitleId === id) s.player.equippedTitleId = '';
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
                const name = prompt('Storage name', storage.name);
                if (name === null) return;
                const cap = prompt('Slot capacity', String(storage.capacity));
                if (cap === null) return;

                await mutateState(s => {
                    const x = s.player.storageLocations.find(v => v.id === activeStorageId);
                    if (!x) return;
                    x.name = name.trim() || x.name;
                    x.capacity = Math.max(1, Number(cap) || x.capacity);
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
    applyThemePrefs();
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
    applyThemePrefs();
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
            <div class="npcb-side-brand"><span>◇</span><strong>${state.player.hasSystem ? 'THE SYSTEM' : 'RPG TRACKER'}</strong></div>
            <div class="npcb-side-status ${statusClass()}">${state.player.hasSystem ? 'SYSTEM ACQUIRED' : escapeHtml(statusLabel())}</div>
            <button class="npcb-side-close" title="Hide System">×</button>
        </div>
        <div class="npcb-side-tabs npcb-system-tabs" title="Drag tabs to reorder">
            ${tabOrder.map(key => `<button draggable="true" data-tab="${key}" class="${activeTab === key ? 'active' : ''}" title="Drag to reorder">${TAB_DEFS[key]}</button>`).join('')}
        </div>
        <div class="npcb-side-body">${body}</div>
        <div class="npcb-side-footer npcb-system-footer">
            <span>${escapeHtml(state.scene.summary || 'Awaiting tracker data')}</span>
            <b>v0.11.4</b>
        </div>
    `;

    applyDashboardGeometry(root);
    bindEvents(root);
}
