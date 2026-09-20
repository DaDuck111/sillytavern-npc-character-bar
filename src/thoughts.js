import { getState } from './store.js';
import { escapeHtml, getContext } from './utils.js';

const ID = 'npcb-thoughts-panel';
const PREF_KEY = 'npc_character_bar_thoughts_v1';

function prefs() {
    const ctx = getContext();
    ctx.extensionSettings ||= {};
    const raw = ctx.extensionSettings[PREF_KEY] || {};
    return {
        visible: Boolean(raw.visible),
        left: Number(raw.left) || Math.max(12, window.innerWidth - 390),
        top: Number(raw.top) || 120,
        width: Math.max(280, Number(raw.width) || 370),
        height: Math.max(220, Number(raw.height) || 360),
        fontSize: Math.max(9, Math.min(20, Number(raw.fontSize) || 12)),
    };
}

function savePrefs(patch) {
    const ctx = getContext();
    ctx.extensionSettings ||= {};
    ctx.extensionSettings[PREF_KEY] = { ...prefs(), ...patch };
    ctx.saveSettingsDebounced?.();
}

function presentThoughts() {
    const state = getState();
    return state.order
        .map(id => state.characters[id])
        .filter(Boolean)
        .filter(c => ['present', 'nearby'].includes(c.status))
        .filter(c => String(c.scene?.thoughts || '').trim());
}

function clamp(panel, left, top) {
    const rect = panel.getBoundingClientRect();
    return {
        left: Math.max(6, Math.min(left, window.innerWidth - rect.width - 6)),
        top: Math.max(6, Math.min(top, window.innerHeight - rect.height - 6)),
    };
}

function installResizePersistence(panel) {
    if (panel._npcbResizeObserver || typeof ResizeObserver === 'undefined') return;
    let ready = false;
    let timer = null;
    const observer = new ResizeObserver(() => {
        if (!ready) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            const rect = panel.getBoundingClientRect();
            savePrefs({ width: rect.width, height: rect.height, left: rect.left, top: rect.top });
        }, 180);
    });
    observer.observe(panel);
    panel._npcbResizeObserver = observer;
    requestAnimationFrame(() => { ready = true; });
}

function installDrag(panel) {
    const head = panel.querySelector('.npcb-thoughts-head');
    if (!head) return;
    head.onpointerdown = event => {
        if (event.button !== 0 || event.target.closest('button')) return;
        const rect = panel.getBoundingClientRect();
        const sx = event.clientX;
        const sy = event.clientY;
        const sl = rect.left;
        const st = rect.top;
        head.setPointerCapture?.(event.pointerId);

        const move = e => {
            const next = clamp(panel, sl + e.clientX - sx, st + e.clientY - sy);
            panel.style.left = `${next.left}px`;
            panel.style.top = `${next.top}px`;
        };
        const up = e => {
            head.releasePointerCapture?.(e.pointerId);
            head.removeEventListener('pointermove', move);
            head.removeEventListener('pointerup', up);
            head.removeEventListener('pointercancel', up);
            const r = panel.getBoundingClientRect();
            savePrefs({ left: r.left, top: r.top });
        };

        head.addEventListener('pointermove', move);
        head.addEventListener('pointerup', up);
        head.addEventListener('pointercancel', up);
        event.preventDefault();
    };
}

export function mountThoughts() {
    let panel = document.getElementById(ID);
    if (!panel) {
        panel = document.createElement('section');
        panel.id = ID;
        document.body.appendChild(panel);
    }
    renderThoughts();
    return panel;
}

export function toggleThoughts(force) {
    const next = typeof force === 'boolean' ? force : !prefs().visible;
    savePrefs({ visible: next });
    renderThoughts();
    return next;
}

export function renderThoughts() {
    let panel = document.getElementById(ID);
    if (!panel) {
        panel = document.createElement('section');
        panel.id = ID;
        document.body.appendChild(panel);
    }

    const p = prefs();
    const list = presentThoughts();
    panel.classList.toggle('visible', p.visible);
    panel.style.left = `${p.left}px`;
    panel.style.top = `${p.top}px`;
    panel.style.width = `${Math.min(p.width, Math.max(280, window.innerWidth - 12))}px`;
    panel.style.height = `${Math.min(p.height, Math.max(220, window.innerHeight - 12))}px`;
    panel.style.setProperty('--npcb-thought-font', `${p.fontSize}px`);

    panel.innerHTML = `
        <div class="npcb-thoughts-head" title="Drag thoughts panel">
            <span>💭</span>
            <strong>NPC THOUGHTS</strong>
            <small>${list.length}</small>
            <div class="npcb-thought-font-controls">
                <button type="button" data-font="-1" title="Smaller text">A−</button>
                <button type="button" data-font="1" title="Larger text">A＋</button>
            </div>
            <button type="button" class="npcb-thought-close" title="Hide thoughts">×</button>
        </div>
        <div class="npcb-thoughts-list">
            ${list.length ? list.map(c => `
                <article>
                    <div class="npcb-thought-avatar">
                        ${c.portrait ? `<img src="${escapeHtml(c.portrait)}" alt="">` : `<b>${escapeHtml(c.name.slice(0,2).toUpperCase())}</b>`}
                    </div>
                    <div>
                        <strong>${escapeHtml(c.name)}</strong>
                        <p>${escapeHtml(c.scene.thoughts)}</p>
                    </div>
                </article>
            `).join('') : '<div class="npcb-side-empty">No explicit NPC thoughts are currently available.</div>'}
        </div>
    `;

    panel.querySelector('.npcb-thought-close')?.addEventListener('click', () => toggleThoughts(false));
    panel.querySelectorAll('[data-font]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            const next = Math.max(9, Math.min(20, p.fontSize + Number(button.dataset.font || 0)));
            savePrefs({ fontSize: next });
            renderThoughts();
        });
    });
    installDrag(panel);
    installResizePersistence(panel);

    requestAnimationFrame(() => {
        if (!p.visible) return;
        const next = clamp(panel, p.left, p.top);
        panel.style.left = `${next.left}px`;
        panel.style.top = `${next.top}px`;
        if (next.left !== p.left || next.top !== p.top) savePrefs(next);
    });
}
