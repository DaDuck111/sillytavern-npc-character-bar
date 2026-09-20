import { getState, mutateState } from './store.js';
import { scanLatestRoleplay } from './autoTracker.js';
import { openArchive, openWorkshop, renderBar } from './ui.js';
import { escapeHtml } from './utils.js';

const ID = 'npcb-dashboard';
const TOGGLE_ID = 'npcb-dashboard-toggle';
let activeTab = 'characters';
let trackerStatus = { status: 'idle', message: 'Waiting for roleplay.' };
let listenersInstalled = false;

function statusLabel() {
    if (trackerStatus.status === 'scanning') return 'SCANNING';
    if (trackerStatus.status === 'error') return 'ERROR';
    if (trackerStatus.status === 'ready') return 'AUTO READY';
    return 'AUTO TRACKER';
}

function statusClass() {
    return trackerStatus.status === 'error' ? 'error'
        : trackerStatus.status === 'scanning' ? 'scanning'
            : trackerStatus.status === 'ready' ? 'ready'
                : '';
}

function characterRows(state) {
    const chars = state.order.map(id => state.characters[id]).filter(Boolean);
    const rank = { present: 0, nearby: 1, away: 2, unknown: 3, missing: 4, inactive: 5, dead: 6 };
    chars.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.name.localeCompare(b.name));

    if (!chars.length) {
        return '<div class="npcb-side-empty">No characters saved yet.<br>The auto tracker will create them after the next RP reply.</div>';
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
            <button class="npcb-side-archive">Archive</button>
        </div>
        <div class="npcb-side-section-title"><span>Present Characters</span><small>${present} active · ${state.order.length} known</small></div>
        <div class="npcb-side-character-list">${characterRows(state)}</div>
    `;
}

function renderScene(state) {
    const scene = state.scene || {};
    const presentNames = state.order
        .map(id => state.characters[id])
        .filter(c => c && c.status === 'present')
        .map(c => c.name);

    return `
        <div class="npcb-scene-card">
            <div class="npcb-scene-icon">⌖</div>
            <div><small>LOCATION</small><strong>${escapeHtml(scene.location || 'Unknown')}</strong></div>
        </div>
        <div class="npcb-scene-card">
            <div class="npcb-scene-icon">◷</div>
            <div><small>TIME</small><strong>${escapeHtml(scene.time || 'Unknown')}</strong></div>
        </div>
        <div class="npcb-side-section-title"><span>Current Scene</span></div>
        <div class="npcb-scene-summary">${escapeHtml(scene.summary || 'The tracker has not summarized this scene yet.')}</div>
        <div class="npcb-side-section-title"><span>In Scene</span></div>
        <div class="npcb-scene-pills">${presentNames.length ? presentNames.map(n => `<span>${escapeHtml(n)}</span>`).join('') : '<em>None detected</em>'}</div>
    `;
}

function renderTrackerSettings(state) {
    const t = state.tracker || {};
    return `
        <div class="npcb-tracker-state ${statusClass()}">
            <div class="npcb-tracker-dot"></div>
            <div>
                <strong>${escapeHtml(statusLabel())}</strong>
                <span>${escapeHtml(trackerStatus.message || '')}</span>
            </div>
        </div>

        <label class="npcb-side-setting">
            <div><strong>Auto-read roleplay</strong><span>Run a separate tracker generation after assistant replies.</span></div>
            <input type="checkbox" data-setting="tracker.autoRead" ${t.autoRead !== false ? 'checked' : ''}>
        </label>

        <label class="npcb-side-setting">
            <div><strong>Auto-register new NPCs</strong><span>Create persistent character records when the tracker finds new named characters.</span></div>
            <input type="checkbox" data-setting="ui.autoRegisterTrackerNPCs" ${state.ui.autoRegisterTrackerNPCs !== false ? 'checked' : ''}>
        </label>

        <label class="npcb-side-setting">
            <div><strong>Show away characters on bar</strong><span>Keep absent characters visible in the lower portrait shelf.</span></div>
            <input type="checkbox" data-setting="ui.showAwayOnBar" ${state.ui.showAwayOnBar ? 'checked' : ''}>
        </label>

        <label class="npcb-side-setting">
            <div><strong>Compact portrait cards</strong><span>Use smaller cards in the lower shelf.</span></div>
            <input type="checkbox" data-setting="ui.compact" ${state.ui.compact ? 'checked' : ''}>
        </label>

        <label class="npcb-side-number">
            <div><strong>Tracker context depth</strong><span>Recent messages sent to the extractor (2–20).</span></div>
            <input type="number" min="2" max="20" step="1" data-setting="tracker.contextDepth" value="${Number(t.contextDepth || 6)}">
        </label>

        <button class="npcb-side-scan npcb-side-scan-large">↻ Refresh tracker now</button>
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

    root.querySelectorAll('.npcb-side-character').forEach(row => {
        row.addEventListener('click', () => openWorkshop(row.dataset.id));
    });

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
        toggle.title = 'Open NPC Companion';
        toggle.innerHTML = '◈';
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
    }

    renderDashboard();
}

export function renderDashboard() {
    const root = document.getElementById(ID);
    if (!root) return;
    const state = getState();

    const body = activeTab === 'scene'
        ? renderScene(state)
        : activeTab === 'tracker'
            ? renderTrackerSettings(state)
            : renderCharacters(state);

    root.innerHTML = `
        <div class="npcb-side-header">
            <div class="npcb-side-brand"><span>◈</span><strong>NPC Companion</strong></div>
            <div class="npcb-side-status ${statusClass()}">${escapeHtml(statusLabel())}</div>
            <button class="npcb-side-close" title="Hide panel">×</button>
        </div>
        <div class="npcb-side-tabs">
            <button data-tab="characters" class="${activeTab === 'characters' ? 'active' : ''}">Characters</button>
            <button data-tab="scene" class="${activeTab === 'scene' ? 'active' : ''}">Scene</button>
            <button data-tab="tracker" class="${activeTab === 'tracker' ? 'active' : ''}">Tracker</button>
        </div>
        <div class="npcb-side-body">${body}</div>
        <div class="npcb-side-footer">
            <button class="npcb-side-archive">Character Archive</button>
            <span>v0.2.0</span>
        </div>
    `;

    bindEvents(root);
}
