import { reloadEditor } from '../../../../../scripts/world-info.js';
import {
    getLorebookCatalog,
    getLorebookGroups,
    getLorebookTags,
    setLorebookActive,
    updateLorebookMeta,
} from './lore.js';
import { escapeHtml, getContext } from './utils.js';

const ID = 'npcb-native-lore-library';
let search = '';
let activeFilter = 'all';
let groupFilter = 'all';
let tagFilter = 'all';
let installed = false;

function filteredCatalog() {
    const needle = search.trim().toLowerCase();
    return getLorebookCatalog().filter(book => {
        if (activeFilter === 'active' && !book.active) return false;
        if (activeFilter === 'inactive' && book.active) return false;
        if (groupFilter !== 'all' && (book.group || '') !== groupFilter) return false;
        if (tagFilter !== 'all' && !(book.tags || []).includes(tagFilter)) return false;
        if (needle) {
            const hay = [book.name, book.group, ...(book.tags || [])].join(' ').toLowerCase();
            if (!hay.includes(needle)) return false;
        }
        return true;
    });
}

function render() {
    const root = document.getElementById(ID);
    if (!root) return;

    const books = filteredCatalog();
    const groups = getLorebookGroups();
    const tags = getLorebookTags();
    const activeCount = getLorebookCatalog().filter(book => book.active).length;

    const grouped = Object.entries(books.reduce((acc, book) => {
        const key = book.group || 'Ungrouped';
        (acc[key] ||= []).push(book);
        return acc;
    }, {})).sort(([a], [b]) => {
        if (a === 'Ungrouped') return 1;
        if (b === 'Ungrouped') return -1;
        return a.localeCompare(b);
    });

    root.innerHTML = `
        <div class="npcb-native-lore-head">
            <div>
                <small>NPC CHARACTER BAR · SHARED LIBRARY</small>
                <strong>LOREBOOK ORGANIZER</strong>
                <span>${activeCount} active · ${getLorebookCatalog().length} total</span>
            </div>
            <button type="button" class="npcb-native-lore-collapse">⌃</button>
        </div>
        <div class="npcb-native-lore-body">
            <div class="npcb-native-lore-tools">
                <input type="search" class="npcb-native-lore-search" placeholder="Search Lorebooks, groups or tags…" value="${escapeHtml(search)}">
                <select class="npcb-native-lore-active">
                    <option value="all" ${activeFilter === 'all' ? 'selected' : ''}>All books</option>
                    <option value="active" ${activeFilter === 'active' ? 'selected' : ''}>Active only</option>
                    <option value="inactive" ${activeFilter === 'inactive' ? 'selected' : ''}>Inactive only</option>
                </select>
                <select class="npcb-native-lore-group">
                    <option value="all">All groups</option>
                    ${groups.map(group => `<option value="${escapeHtml(group)}" ${groupFilter === group ? 'selected' : ''}>${escapeHtml(group)}</option>`).join('')}
                </select>
                <select class="npcb-native-lore-tag">
                    <option value="all">All tags</option>
                    ${tags.map(tag => `<option value="${escapeHtml(tag)}" ${tagFilter === tag ? 'selected' : ''}>#${escapeHtml(tag)}</option>`).join('')}
                </select>
            </div>
            <div class="npcb-native-lore-groups">
                ${grouped.length ? grouped.map(([groupName, list]) => `
                    <section class="npcb-native-lore-group-section">
                        <div class="npcb-native-lore-group-head"><span>◇ ${escapeHtml(groupName)}</span><b>${list.length}</b></div>
                        <div class="npcb-native-lore-cards">
                            ${list.map(book => `
                                <article class="npcb-native-lore-card" data-book="${escapeHtml(book.name)}">
                                    <button type="button" class="npcb-native-lore-open" title="Open this Lorebook in SillyTavern">
                                        <div>
                                            <strong>${escapeHtml(book.name)}</strong>
                                            <span>${book.active ? 'ACTIVE IN ALL CHATS' : 'INACTIVE'}</span>
                                        </div>
                                        <i>OPEN</i>
                                    </button>
                                    <div class="npcb-native-lore-card-tags">
                                        ${(book.tags || []).length ? book.tags.map(tag => `<em>#${escapeHtml(tag)}</em>`).join('') : '<small>No tags</small>'}
                                    </div>
                                    <label class="npcb-native-lore-switch">
                                        <input type="checkbox" ${book.active ? 'checked' : ''}>
                                        <span>${book.active ? 'ACTIVE' : 'OFF'}</span>
                                    </label>
                                    <button type="button" class="npcb-native-lore-organize">GROUP / TAG</button>
                                </article>
                            `).join('')}
                        </div>
                    </section>
                `).join('') : '<div class="npcb-native-lore-empty">No Lorebooks match these filters.</div>'}
            </div>
            <div class="npcb-native-lore-hint">
                These groups/tags are the same ones shown inside NPC → Lorebook. SillyTavern entries themselves are untouched.
            </div>
        </div>
    `;

    bind(root);
}

function bind(root) {
    const body = root.querySelector('.npcb-native-lore-body');
    root.querySelector('.npcb-native-lore-collapse')?.addEventListener('click', buttonEvent => {
        root.classList.toggle('collapsed');
        buttonEvent.currentTarget.textContent = root.classList.contains('collapsed') ? '⌄' : '⌃';
    });

    root.querySelector('.npcb-native-lore-search')?.addEventListener('input', event => {
        search = event.target.value;
        const caret = event.target.selectionStart;
        render();
        requestAnimationFrame(() => {
            const input = document.querySelector('#npcb-native-lore-library .npcb-native-lore-search');
            input?.focus();
            input?.setSelectionRange?.(caret, caret);
        });
    });
    root.querySelector('.npcb-native-lore-active')?.addEventListener('change', event => { activeFilter = event.target.value; render(); });
    root.querySelector('.npcb-native-lore-group')?.addEventListener('change', event => { groupFilter = event.target.value; render(); });
    root.querySelector('.npcb-native-lore-tag')?.addEventListener('change', event => { tagFilter = event.target.value; render(); });

    root.querySelectorAll('.npcb-native-lore-card').forEach(card => {
        const name = card.dataset.book;
        card.querySelector('.npcb-native-lore-open')?.addEventListener('click', async () => {
            try {
                await reloadEditor(name, true);
            } catch (error) {
                console.warn('[NPC Character Bar] Could not open Lorebook:', error);
            }
        });
        card.querySelector('.npcb-native-lore-switch input')?.addEventListener('change', async event => {
            await setLorebookActive(name, event.target.checked);
            render();
        });
        card.querySelector('.npcb-native-lore-organize')?.addEventListener('click', () => {
            const book = getLorebookCatalog().find(x => x.name === name);
            if (!book) return;
            const group = prompt('Lorebook group / folder (blank = ungrouped)', book.group || '');
            if (group === null) return;
            const tags = prompt('Tags, comma-separated', (book.tags || []).join(', '));
            if (tags === null) return;
            updateLorebookMeta(name, {
                group: group.trim(),
                tags: tags.split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean),
            });
            render();
        });
    });
}

export function renderWorldInfoEnhancer() {
    const worldInfo = document.getElementById('WorldInfo');
    if (!worldInfo) return null;

    let root = document.getElementById(ID);
    if (!root) {
        root = document.createElement('section');
        root.id = ID;
        const holder = worldInfo.querySelector('#wi-holder');
        if (holder?.parentNode) holder.parentNode.insertBefore(root, holder);
        else worldInfo.appendChild(root);
    }
    render();
    return root;
}

export function mountWorldInfoEnhancer() {
    renderWorldInfoEnhancer();
    if (installed) return;
    installed = true;

    const ctx = getContext();
    const events = ctx.eventTypes || ctx.event_types || {};
    for (const key of ['WORLDINFO_UPDATED', 'WORLDINFO_SETTINGS_UPDATED']) {
        if (events[key]) ctx.eventSource?.on?.(events[key], () => setTimeout(renderWorldInfoEnhancer, 80));
    }
    document.getElementById('WIDrawerIcon')?.addEventListener('click', () => setTimeout(renderWorldInfoEnhancer, 80));
    document.getElementById('world_refresh')?.addEventListener('click', () => setTimeout(renderWorldInfoEnhancer, 180));
    window.addEventListener('npcb:lore-meta-changed', renderWorldInfoEnhancer);

    const observer = new MutationObserver(() => {
        if (!document.getElementById(ID) && document.getElementById('WorldInfo')) renderWorldInfoEnhancer();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
