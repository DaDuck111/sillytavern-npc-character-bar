import { getState, mutateState } from './store.js';
import { scanLatestRoleplay } from './autoTracker.js';
import { openArchive, openWorkshop, renderBar } from './ui.js';
import { escapeHtml, uid } from './utils.js';

const ID = 'npcb-dashboard';
const TOGGLE_ID = 'npcb-dashboard-toggle';
let activeTab = 'status';
let trackerStatus = { status: 'idle', message: 'Waiting for roleplay.' };
let listenersInstalled = false;

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

function playerTitle(player) {
    return player.title || player.className || 'AWAKENED';
}

function renderStatus(state) {
    const p = state.player;
    const xpPct = pct(p.xp, p.xpToNext);
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
                <label title="Allow the AI tracker to update this stat"><input class="npcb-stat-ai" type="checkbox" ${stat.aiTrack !== false ? 'checked' : ''}> AI</label>
                <button data-action="stat-edit">Edit</button>
                <button data-action="stat-delete">×</button>
            </div>
        </div>`;
    }).join('');

    return `
        <div class="npcb-player-card">
            <div class="npcb-player-rank">LV. ${escapeHtml(p.level)}</div>
            <div class="npcb-player-ident">
                <small>PLAYER</small>
                <strong>${escapeHtml(p.name || 'Player')}</strong>
                <span>${escapeHtml(playerTitle(p))}</span>
            </div>
            <button class="npcb-system-mini" data-action="player-edit">EDIT</button>
        </div>

        <div class="npcb-system-xp">
            <div><span>EXPERIENCE</span><strong>${escapeHtml(p.xp)} / ${escapeHtml(p.xpToNext)}</strong></div>
            <div class="npcb-system-bar xp"><i style="width:${xpPct}%"></i></div>
        </div>

        <div class="npcb-system-resource-grid">
            <div><small>FUNDS</small><strong>${escapeHtml(p.money.toLocaleString?.() ?? p.money)} <em>${escapeHtml(p.currency)}</em></strong></div>
            <div><small>LOCATION</small><strong>${escapeHtml(p.currentLocation || state.scene.location || 'Unknown')}</strong></div>
        </div>

        <div class="npcb-system-section-head"><span>ATTRIBUTES</span><button data-action="stat-add">＋ ADD STAT</button></div>
        <div class="npcb-system-stats">${stats || '<div class="npcb-side-empty">No stats configured.</div>'}</div>

        ${p.condition ? `<div class="npcb-system-condition"><small>CONDITION</small><span>${escapeHtml(p.condition)}</span></div>` : ''}
    `;
}

function renderInventory(state) {
    const p = state.player;
    const items = [...(p.inventory || [])].sort((a, b) => Number(b.equipped) - Number(a.equipped) || a.name.localeCompare(b.name));
    return `
        <div class="npcb-system-section-head"><span>INVENTORY</span><button data-action="item-add">＋ ADD ITEM</button></div>
        <div class="npcb-inventory-money">
            <span>AVAILABLE FUNDS</span>
            <strong>${escapeHtml(p.money.toLocaleString?.() ?? p.money)} ${escapeHtml(p.currency)}</strong>
            <button data-action="money-edit">EDIT</button>
        </div>
        <div class="npcb-system-list">
            ${items.length ? items.map(item => `
                <div class="npcb-system-list-row ${item.equipped ? 'equipped' : ''}" data-item-id="${escapeHtml(item.id)}">
                    <div class="npcb-system-list-icon">◇</div>
                    <div class="npcb-system-list-main">
                        <strong>${escapeHtml(item.name)} ${item.quantity > 1 ? `×${escapeHtml(item.quantity)}` : ''}</strong>
                        <span>${escapeHtml(item.type || item.description || (item.equipped ? 'Equipped' : 'Item'))}</span>
                    </div>
                    <div class="npcb-system-row-actions">
                        <button data-action="item-minus">−</button>
                        <button data-action="item-plus">＋</button>
                        <button data-action="item-equip">${item.equipped ? 'UNEQUIP' : 'EQUIP'}</button>
                        <button data-action="item-delete">×</button>
                    </div>
                </div>
            `).join('') : '<div class="npcb-side-empty">Inventory empty. Items acquired in RP can be added automatically.</div>'}
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
                    <div>
                        <button data-action="skill-edit">EDIT</button>
                        <button data-action="skill-delete">×</button>
                    </div>
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
            <span>Home is persistent player data and does not change just because the scene moves.</span>
        </div>
        <label class="npcb-system-field">
            <span>CURRENT LOCATION</span>
            <input data-player-field="currentLocation" value="${escapeHtml(p.currentLocation || state.scene.location || '')}" placeholder="Where the player is now">
        </label>
        <label class="npcb-system-field">
            <span>HOME / BASE LOCATION</span>
            <input data-player-field="homeLocation" value="${escapeHtml(p.homeLocation)}" placeholder="Apartment, guild hall, estate…">
        </label>
        <label class="npcb-system-field">
            <span>HOME DETAILS</span>
            <textarea data-player-field="homeDescription" rows="6" placeholder="Rooms, facilities, storage, NPC residents, upgrades…">${escapeHtml(p.homeDescription)}</textarea>
        </label>
        <label class="npcb-system-field">
            <span>CURRENT CONDITION</span>
            <textarea data-player-field="condition" rows="4" placeholder="Injured, exhausted, buffed…">${escapeHtml(p.condition)}</textarea>
        </label>
    `;
}

function characterRows(state) {
    const chars = state.order.map(id => state.characters[id]).filter(Boolean);
    const rank = { present: 0, nearby: 1, away: 2, unknown: 3, missing: 4, inactive: 5, dead: 6 };
    chars.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.name.localeCompare(b.name));

    if (!chars.length) {
        return '<div class="npcb-side-empty">No NPCs saved yet.<br>The System will register named characters from roleplay.</div>';
    }

    return chars.map(c => {
        const portrait = c.portrait
            ? `<img src="${escapeHtml(c.portrait)}" alt="">`
            : `<div class="npcb-side-avatar-fallback">${escapeHtml(c.name.trim().slice(0, 2).toUpperCase() || '?')}</div>`;
        const detail = c.scene?.action || c.scene?.mood || c.role || c.faction || 'Saved character';
        return `<button class="npcb-side-character status-${escapeHtml(c.status)}" data-id="${escapeHtml(c.id)}">
            <div class="npcb-side-avatar">${portrait}<span class="npcb-side-presence"></span></div>
            <div class="npcb-side-character-text">
                <strong>${escapeHtml(c.name)}</strong>
                <span>${escapeHtml(detail)}</span>
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
        <div class="npcb-side-section-title"><span>CHARACTERS IN SYSTEM</span><small>${present} active · ${state.order.length} linked</small></div>
        <div class="npcb-side-character-list">${characterRows(state)}</div>
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

        ${toggle('tracker.autoRead', t.autoRead !== false, 'Auto-read roleplay', 'Run one separate System extraction after assistant replies.')}
        ${toggle('tracker.trackPlayer', t.trackPlayer !== false, 'Track player state', 'Allow System extraction to update the player HUD.')}
        ${toggle('tracker.trackStats', t.trackStats !== false, 'Track stats', 'Update AI-enabled custom stats when RP clearly changes them.')}
        ${toggle('tracker.trackInventory', t.trackInventory !== false, 'Track inventory', 'Add/remove/equip items established in RP.')}
        ${toggle('tracker.trackSkills', t.trackSkills !== false, 'Track skills & titles', 'Record newly acquired skills, ranks and titles.')}
        ${toggle('tracker.trackMoney', t.trackMoney !== false, 'Track money', 'Update funds only when spending/rewards are explicit.')}
        ${toggle('ui.autoRegisterTrackerNPCs', state.ui.autoRegisterTrackerNPCs !== false, 'Auto-register NPCs', 'Save newly detected named NPCs to the archive.')}
        ${toggle('ui.showAwayOnBar', Boolean(state.ui.showAwayOnBar), 'Show away NPC covers', 'Keep absent characters on the cover shelf.')}
        ${toggle('ui.compact', Boolean(state.ui.compact), 'Compact NPC covers', 'Use smaller portrait covers above the input.')}

        <label class="npcb-side-number">
            <div><strong>System context depth</strong><span>Recent messages sent to the extractor (2–20).</span></div>
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
    const level = prompt('Level', String(p.level)) ?? String(p.level);
    const xp = prompt('Current XP', String(p.xp)) ?? String(p.xp);
    const xpToNext = prompt('XP needed for next level', String(p.xpToNext)) ?? String(p.xpToNext);
    await mutateState(s => Object.assign(s.player, {
        name: name.trim(),
        title: title.trim(),
        className: className.trim(),
        level: Math.max(1, Number(level) || 1),
        xp: Math.max(0, Number(xp) || 0),
        xpToNext: Math.max(1, Number(xpToNext) || 100),
    }));
    renderDashboard();
}

async function addStat() {
    const name = prompt('Stat name (example: Health, Mana, Sanity)');
    if (!name?.trim()) return;
    const value = Number(prompt('Starting value', '100') ?? 100);
    const max = Number(prompt('Maximum value', '100') ?? 100);
    const unit = prompt('Unit (%, points, etc.)', '%') ?? '';
    await mutateState(s => s.player.stats.push({
        id: uid('stat'), name: name.trim(), value: Number.isFinite(value) ? value : 0,
        max: Number.isFinite(max) && max > 0 ? max : 100, unit: unit.trim(), aiTrack: true,
    }));
    renderDashboard();
}

async function editStat(id) {
    const state = getState();
    const stat = state.player.stats.find(x => x.id === id);
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
    const name = prompt('Item name');
    if (!name?.trim()) return;
    const quantity = Math.max(1, Number(prompt('Quantity', '1') ?? 1) || 1);
    const type = prompt('Type (weapon, armor, consumable, quest…)', '') ?? '';
    const description = prompt('Description', '') ?? '';
    await mutateState(s => s.player.inventory.push({
        id: uid('item'), name: name.trim(), quantity, type: type.trim(), description: description.trim(),
        equipped: false, value: 0,
    }));
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

function bindEvents(root) {
    root.querySelectorAll('.npcb-side-tabs button').forEach(button => {
        button.addEventListener('click', () => {
            activeTab = button.dataset.tab;
            renderDashboard();
        });
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

    root.querySelectorAll('[data-action]').forEach(button => {
        button.addEventListener('click', async event => {
            event.stopPropagation();
            const action = button.dataset.action;
            if (action === 'player-edit') return editPlayer();
            if (action === 'stat-add') return addStat();
            if (action === 'item-add') return addItem();
            if (action === 'skill-add') return addSkill();
            if (action === 'money-edit') {
                const p = getState().player;
                const money = prompt('Money / funds', String(p.money));
                if (money === null) return;
                const currency = prompt('Currency name', p.currency) ?? p.currency;
                await mutateState(s => { s.player.money = Number(money) || 0; s.player.currency = currency.trim() || s.player.currency; });
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
}

export function mountDashboard() {
    if (!document.getElementById(ID)) {
        const panel = document.createElement('aside');
        panel.id = ID;
        document.body.appendChild(panel);
    }

    if (!document.getElementById(TOGGLE_ID)) {
        const toggle = document.createElement('button');
        toggle.id = TOGGLE_ID;
        toggle.type = 'button';
        toggle.title = 'Open System';
        toggle.innerHTML = '◇';
        toggle.addEventListener('click', () => {
            document.getElementById(ID)?.classList.remove('npcb-side-hidden');
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
            if (activeTab === 'characters') renderDashboard();
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
        skills: renderSkills,
        home: renderHome,
        characters: renderCharacters,
        tracker: renderTrackerSettings,
    };
    const body = (renders[activeTab] || renderStatus)(state);

    root.innerHTML = `
        <div class="npcb-side-header npcb-system-header">
            <div class="npcb-side-brand"><span>◇</span><strong>THE SYSTEM</strong></div>
            <div class="npcb-side-status ${statusClass()}">${escapeHtml(statusLabel())}</div>
            <button class="npcb-side-close" title="Hide System">×</button>
        </div>
        <div class="npcb-side-tabs npcb-system-tabs">
            ${[
                ['status','STATUS'], ['inventory','ITEMS'], ['skills','SKILLS'],
                ['home','HOME'], ['characters','NPC'], ['tracker','SYSTEM'],
            ].map(([key,label]) => `<button data-tab="${key}" class="${activeTab === key ? 'active' : ''}">${label}</button>`).join('')}
        </div>
        <div class="npcb-side-body">${body}</div>
        <div class="npcb-side-footer npcb-system-footer">
            <span>QUEST LOG // ${escapeHtml(state.scene.summary || 'Awaiting System data')}</span>
            <b>v0.3.0</b>
        </div>
    `;

    bindEvents(root);
}
