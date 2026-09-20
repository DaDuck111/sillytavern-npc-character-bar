import { deleteWorldInfo, reloadEditor } from '../../../../../scripts/world-info.js';
import {
    createLorebookFolder,
    deleteLorebookFolder,
    deleteLorebookMeta,
    getLorebookCatalog,
    getLorebookGroups,
    getLorebookTags,
    moveLorebooksToFolder,
    renameLorebookFolder,
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
let contextMenu = null;
let contextMenuOutsideHandler = null;
const selectedBooks = new Set();

function filteredCatalog() {
    const needle = search.trim().toLowerCase();
    return getLorebookCatalog().filter(book => {
        if (activeFilter === 'active' && !book.active) return false;
        if (activeFilter === 'inactive' && book.active) return false;
        if (groupFilter === 'ungrouped' && book.group) return false;
        if (groupFilter !== 'all' && groupFilter !== 'ungrouped' && (book.group || '') !== groupFilter) return false;
        if (tagFilter !== 'all' && !(book.tags || []).includes(tagFilter)) return false;
        if (needle) {
            const hay = [book.name, book.group, ...(book.tags || [])].join(' ').toLowerCase();
            if (!hay.includes(needle)) return false;
        }
        return true;
    });
}

function cleanSelection() {
    const names = new Set(getLorebookCatalog().map(book => book.name));
    for (const name of [...selectedBooks]) {
        if (!names.has(name)) selectedBooks.delete(name);
    }
}

function removeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
    if (contextMenuOutsideHandler) {
        document.removeEventListener('mousedown', contextMenuOutsideHandler, true);
        contextMenuOutsideHandler = null;
    }
}

function selectedOr(name) {
    if (selectedBooks.has(name)) return [...selectedBooks];
    selectedBooks.clear();
    selectedBooks.add(name);
    return [name];
}

function moveSelectionTo(folder, fallbackName = '') {
    const names = fallbackName ? selectedOr(fallbackName) : [...selectedBooks];
    if (!names.length) return;
    moveLorebooksToFolder(names, folder);
    render();
}

function showMoveContextMenu(event, bookName) {
    event.preventDefault();
    event.stopPropagation();
    removeContextMenu();

    const names = selectedOr(bookName);
    render();

    const folders = getLorebookGroups();
    const menu = document.createElement('div');
    menu.className = 'npcb-lore-context-menu';
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 260)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 340)}px`;
    menu.innerHTML = `
        <div class="npcb-lore-context-title">${names.length} selected</div>
        <button type="button" data-folder="">Move to Ungrouped</button>
        ${folders.map(folder => `<button type="button" data-folder="${escapeHtml(folder)}">Move to ▱ ${escapeHtml(folder)}</button>`).join('')}
        <div class="npcb-lore-context-sep"></div>
        <button type="button" data-action="tags">Edit tags for selected</button>
        <button type="button" data-action="delete" class="danger">Delete selected</button>
    `;
    document.body.appendChild(menu);
    contextMenu = menu;

    menu.querySelectorAll('[data-folder]').forEach(button => {
        button.addEventListener('click', () => {
            moveLorebooksToFolder(names, button.dataset.folder || '');
            removeContextMenu();
            render();
        });
    });

    menu.querySelector('[data-action="tags"]')?.addEventListener('click', () => {
        const catalog = getLorebookCatalog();
        const shared = names.length === 1 ? (catalog.find(book => book.name === names[0])?.tags || []).join(', ') : '';
        const value = prompt('Tags for selected Lorebooks, comma-separated', shared);
        if (value === null) return;
        const tags = value.split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean);
        for (const name of names) updateLorebookMeta(name, { tags });
        removeContextMenu();
        render();
    });

    menu.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        removeContextMenu();
        await deleteSelectedBooks(names);
    });

    contextMenuOutsideHandler = event => {
        if (contextMenu?.contains(event.target)) return;
        removeContextMenu();
    };
    setTimeout(() => {
        if (contextMenuOutsideHandler) document.addEventListener('mousedown', contextMenuOutsideHandler, true);
    }, 0);
}

async function deleteSelectedBooks(names = [...selectedBooks]) {
    if (!names.length) return;
    const preview = names.slice(0, 8).join('\n');
    const more = names.length > 8 ? `\n… and ${names.length - 8} more` : '';
    if (!confirm(`Delete ${names.length} Lorebook${names.length === 1 ? '' : 's'}?\n\n${preview}${more}\n\nThis deletes the actual SillyTavern Lorebook files and cannot be undone.`)) return;

    for (const name of names) {
        try {
            const deleted = await deleteWorldInfo(name);
            if (deleted) {
                deleteLorebookMeta(name);
                selectedBooks.delete(name);
            }
        } catch (error) {
            console.error('[NPC Character Bar] Failed to delete Lorebook:', name, error);
        }
    }
    render();
}

function folderCount(catalog, folder) {
    if (folder === 'all') return catalog.length;
    if (folder === 'ungrouped') return catalog.filter(book => !book.group).length;
    return catalog.filter(book => book.group === folder).length;
}

function render() {
    const root = document.getElementById(ID);
    if (!root) return;

    cleanSelection();
    removeContextMenu();

    const catalog = getLorebookCatalog();
    const books = filteredCatalog();
    const folders = getLorebookGroups();
    const tags = getLorebookTags();
    const activeCount = catalog.filter(book => book.active).length;
    const visibleNames = books.map(book => book.name);
    const allVisibleSelected = Boolean(visibleNames.length) && visibleNames.every(name => selectedBooks.has(name));

    root.innerHTML = `
        <div class="npcb-native-lore-head">
            <div>
                <small>NPC CHARACTER BAR · SHARED LIBRARY</small>
                <strong>LOREBOOK ORGANIZER</strong>
                <span>${activeCount} active · ${catalog.length} total · ${selectedBooks.size} selected</span>
            </div>
            <button type="button" class="npcb-native-lore-collapse">⌃</button>
        </div>
        <div class="npcb-native-lore-body">
            <div class="npcb-native-lore-tools">
                <input type="search" class="npcb-native-lore-search" placeholder="Search Lorebooks, folders or tags…" value="${escapeHtml(search)}">
                <select class="npcb-native-lore-active">
                    <option value="all" ${activeFilter === 'all' ? 'selected' : ''}>All books</option>
                    <option value="active" ${activeFilter === 'active' ? 'selected' : ''}>Active only</option>
                    <option value="inactive" ${activeFilter === 'inactive' ? 'selected' : ''}>Inactive only</option>
                </select>
                <select class="npcb-native-lore-tag">
                    <option value="all">All tags</option>
                    ${tags.map(tag => `<option value="${escapeHtml(tag)}" ${tagFilter === tag ? 'selected' : ''}>#${escapeHtml(tag)}</option>`).join('')}
                </select>
            </div>

            <div class="npcb-lore-folder-layout">
                <aside class="npcb-lore-folder-sidebar">
                    <div class="npcb-lore-folder-sidebar-head">
                        <span>FOLDERS</span>
                        <button type="button" class="npcb-lore-create-folder">＋ CREATE</button>
                    </div>

                    <button type="button" class="npcb-lore-folder-item ${groupFilter === 'all' ? 'active' : ''}" data-folder-filter="all">
                        <span>◇</span><strong>All Lorebooks</strong><b>${folderCount(catalog, 'all')}</b>
                    </button>
                    <button type="button" class="npcb-lore-folder-item npcb-lore-folder-drop ${groupFilter === 'ungrouped' ? 'active' : ''}" data-folder-filter="ungrouped" data-drop-folder="">
                        <span>○</span><strong>Ungrouped</strong><b>${folderCount(catalog, 'ungrouped')}</b>
                    </button>

                    <div class="npcb-lore-folder-list">
                        ${folders.map(folder => `
                            <div class="npcb-lore-folder-wrap" data-folder-name="${escapeHtml(folder)}">
                                <button type="button" class="npcb-lore-folder-item npcb-lore-folder-drop ${groupFilter === folder ? 'active' : ''}" data-folder-filter="${escapeHtml(folder)}" data-drop-folder="${escapeHtml(folder)}">
                                    <span>▱</span><strong>${escapeHtml(folder)}</strong><b>${folderCount(catalog, folder)}</b>
                                </button>
                                <button type="button" class="npcb-lore-folder-more" title="Rename or delete folder">⋯</button>
                            </div>
                        `).join('')}
                    </div>

                    <div class="npcb-lore-folder-tip">Drag Lorebooks here. You can also tick books, right-click one of them, then move the whole selection.</div>
                </aside>

                <main class="npcb-lore-folder-main">
                    <div class="npcb-native-lore-bulk">
                        <label>
                            <input type="checkbox" class="npcb-lore-select-all" ${allVisibleSelected ? 'checked' : ''}>
                            <span>Select all shown</span>
                        </label>
                        <b>${selectedBooks.size} selected</b>
                        <div class="npcb-spacer"></div>
                        <button type="button" data-bulk="add-tags" ${selectedBooks.size ? '' : 'disabled'}>＋ ADD TAGS</button>
                        <button type="button" data-bulk="replace-tags" ${selectedBooks.size ? '' : 'disabled'}>REPLACE TAGS</button>
                        <button type="button" class="danger" data-bulk="delete" ${selectedBooks.size ? '' : 'disabled'}>DELETE</button>
                    </div>

                    <div class="npcb-native-lore-groups">
                        ${books.length ? `
                            <div class="npcb-native-lore-cards">
                                ${books.map(book => `
                                    <article class="npcb-native-lore-card ${selectedBooks.has(book.name) ? 'selected' : ''}" draggable="true" data-book="${escapeHtml(book.name)}">
                                        <label class="npcb-native-lore-check" title="Select for bulk actions">
                                            <input type="checkbox" ${selectedBooks.has(book.name) ? 'checked' : ''}>
                                            <span>✓</span>
                                        </label>
                                        <button type="button" class="npcb-native-lore-open" title="Open this Lorebook in SillyTavern">
                                            <div>
                                                <strong>${escapeHtml(book.name)}</strong>
                                                <span>${book.group ? `▱ ${escapeHtml(book.group)} · ` : ''}${book.active ? 'ACTIVE IN ALL CHATS' : 'INACTIVE'}</span>
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
                                    </article>
                                `).join('')}
                            </div>
                        ` : '<div class="npcb-native-lore-empty">No Lorebooks match these filters.</div>'}
                    </div>
                    <div class="npcb-native-lore-hint">
                        Tick books for tags/deletion. Folder movement is drag/drop or right-click → Move to folder.
                    </div>
                </main>
            </div>
        </div>
    `;

    bind(root, books);
}

function bind(root, visibleBooks) {
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
    root.querySelector('.npcb-native-lore-tag')?.addEventListener('change', event => { tagFilter = event.target.value; render(); });

    root.querySelector('.npcb-lore-create-folder')?.addEventListener('click', () => {
        const name = prompt('New Lorebook folder name');
        if (!name?.trim()) return;
        if (!createLorebookFolder(name.trim())) {
            alert('That folder already exists or the name is invalid.');
            return;
        }
        groupFilter = name.trim();
        render();
    });

    root.querySelectorAll('[data-folder-filter]').forEach(button => {
        button.addEventListener('click', event => {
            if (event.target.closest('.npcb-lore-folder-more')) return;
            groupFilter = button.dataset.folderFilter || 'all';
            render();
        });
    });

    root.querySelectorAll('.npcb-lore-folder-more').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            const wrap = button.closest('[data-folder-name]');
            const folder = wrap?.dataset.folderName;
            if (!folder) return;
            const action = prompt(`Folder: ${folder}\nType "rename" or "delete"`, 'rename');
            if (!action) return;
            if (action.trim().toLowerCase() === 'rename') {
                const next = prompt('New folder name', folder);
                if (!next?.trim()) return;
                if (!renameLorebookFolder(folder, next.trim())) {
                    alert('Could not rename folder. The new name may already exist.');
                    return;
                }
                if (groupFilter === folder) groupFilter = next.trim();
            } else if (action.trim().toLowerCase() === 'delete') {
                if (!confirm(`Delete folder "${folder}"? Lorebooks inside it will become Ungrouped.`)) return;
                deleteLorebookFolder(folder);
                if (groupFilter === folder) groupFilter = 'all';
            }
            render();
        });
    });

    root.querySelectorAll('.npcb-lore-folder-drop').forEach(folder => {
        folder.addEventListener('dragover', event => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            folder.classList.add('drag-over');
        });
        folder.addEventListener('dragleave', () => folder.classList.remove('drag-over'));
        folder.addEventListener('drop', event => {
            event.preventDefault();
            folder.classList.remove('drag-over');
            const dragged = event.dataTransfer.getData('text/npcb-lorebook');
            if (!dragged) return;
            const names = selectedBooks.has(dragged) ? [...selectedBooks] : [dragged];
            moveLorebooksToFolder(names, folder.dataset.dropFolder || '');
            render();
        });
    });

    root.querySelector('.npcb-lore-select-all')?.addEventListener('change', event => {
        for (const book of visibleBooks) {
            if (event.target.checked) selectedBooks.add(book.name);
            else selectedBooks.delete(book.name);
        }
        render();
    });

    root.querySelector('[data-bulk="add-tags"]')?.addEventListener('click', () => {
        const value = prompt('Tags to ADD to selected Lorebooks, comma-separated');
        if (value === null) return;
        const additions = value.split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean);
        const catalog = getLorebookCatalog();
        for (const name of selectedBooks) {
            const book = catalog.find(x => x.name === name);
            if (!book) continue;
            updateLorebookMeta(name, { tags: [...new Set([...(book.tags || []), ...additions])] });
        }
        render();
    });

    root.querySelector('[data-bulk="replace-tags"]')?.addEventListener('click', () => {
        const value = prompt('Replace selected Lorebook tags with these tags, comma-separated', '');
        if (value === null) return;
        const nextTags = value.split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean);
        for (const name of selectedBooks) updateLorebookMeta(name, { tags: nextTags });
        render();
    });

    root.querySelector('[data-bulk="delete"]')?.addEventListener('click', async () => {
        await deleteSelectedBooks();
    });

    root.querySelectorAll('.npcb-native-lore-card').forEach(card => {
        const name = card.dataset.book;

        card.addEventListener('contextmenu', event => showMoveContextMenu(event, name));

        card.addEventListener('dragstart', event => {
            if (event.target.closest('input, label')) {
                event.preventDefault();
                return;
            }
            if (!selectedBooks.has(name)) {
                selectedBooks.clear();
                selectedBooks.add(name);
            }
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/npcb-lorebook', name);
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));

        card.querySelector('.npcb-native-lore-check input')?.addEventListener('change', event => {
            event.stopPropagation();
            if (event.target.checked) selectedBooks.add(name);
            else selectedBooks.delete(name);
            render();
        });

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
