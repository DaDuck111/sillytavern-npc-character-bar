import { escapeHtml, getContext } from './utils.js';

const SHELL_ID = 'npcb-character-library-shell';
const DETAIL_ID = 'npcb-character-library-detail';
let installed = false;
let selectedChid = '';
let requestSerial = 0;
const chatCache = new Map();

function currentContext() {
    try { return getContext(); } catch { return null; }
}

function characterById(chid) {
    const ctx = currentContext();
    if (!ctx) return null;
    const chars = Array.isArray(ctx.characters) ? ctx.characters : Object.values(ctx.characters || {});
    return chars[Number(chid)] || null;
}

function avatarUrl(character, card = null) {
    const cardSrc = card?.querySelector('img')?.src;
    if (cardSrc) return cardSrc;
    const ctx = currentContext();
    if (character?.avatar && typeof ctx?.getThumbnailUrl === 'function') {
        return ctx.getThumbnailUrl('avatar', character.avatar);
    }
    return '';
}

function compactText(value, max = 260) {
    const text = String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (text.length <= max) return text;
    return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function characterDescription(character) {
    return compactText(
        character?.data?.creator_notes
        || character?.data?.description
        || character?.description
        || '',
        420,
    );
}

function characterVersion(character) {
    return String(character?.data?.character_version || character?.data?.version || '').trim();
}

function formatTimestamp(value) {
    if (value === undefined || value === null || value === '') return 'Unknown date';
    let date;
    if (typeof value === 'number') date = new Date(value);
    else if (/^\d+$/.test(String(value))) date = new Date(Number(value));
    else date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    try {
        return new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(date);
    } catch {
        return date.toLocaleString();
    }
}

function chatTitle(chat) {
    const meta = chat?.chat_metadata || {};
    return String(
        meta.chat_name
        || meta.name
        || chat.file_id
        || String(chat.file_name || '').replace(/\.jsonl$/i, '')
        || 'Untitled Chat',
    );
}

function isBulkMode() {
    const list = document.getElementById('rm_print_characters_block');
    return Boolean(list?.classList.contains('bulk_select') || list?.classList.contains('group_overlay_mode_select'));
}

function ensureShell() {
    const list = document.getElementById('rm_print_characters_block');
    if (!list) return null;

    let shell = document.getElementById(SHELL_ID);
    if (!shell) {
        shell = document.createElement('div');
        shell.id = SHELL_ID;
        list.parentNode?.insertBefore(shell, list);
        shell.appendChild(list);

        const detail = document.createElement('aside');
        detail.id = DETAIL_ID;
        shell.appendChild(detail);
        renderEmptyDetail();
    } else if (list.parentNode !== shell) {
        shell.prepend(list);
    }

    ensureHeading();
    enhanceCards();
    return shell;
}

function ensureHeading() {
    const pagination = document.getElementById('rm_print_characters_pagination');
    if (!pagination || document.getElementById('npcb-character-library-heading')) return;

    const heading = document.createElement('div');
    heading.id = 'npcb-character-library-heading';
    heading.innerHTML = `
        <div>
            <small>CHARACTER LIBRARY</small>
            <strong>Choose a character, then choose a chat</strong>
            <span>Single-click previews. Your chats stay exactly where SillyTavern stores them.</span>
        </div>
    `;
    pagination.parentNode?.insertBefore(heading, pagination);
}

function renderEmptyDetail() {
    const detail = document.getElementById(DETAIL_ID);
    if (!detail) return;
    detail.innerHTML = `
        <div class="npcb-char-library-empty">
            <div class="npcb-char-library-empty-icon">◇</div>
            <strong>Select a character</strong>
            <span>Its profile and chat history will appear here. Nothing opens until you choose a chat.</span>
        </div>
    `;
}

function markSelectedCard() {
    document.querySelectorAll('#rm_print_characters_block .character_select').forEach(card => {
        card.classList.toggle('npcb-library-selected', String(card.dataset.chid) === String(selectedChid));
    });
}

function enhanceCards() {
    document.querySelectorAll('#rm_print_characters_block .character_select').forEach(card => {
        const chid = card.dataset.chid ?? card.getAttribute('data-chid');
        if (chid === null || chid === undefined) return;
        card.dataset.npcbLibraryReady = '1';
        card.setAttribute('aria-label', `${card.querySelector('.ch_name')?.textContent || 'Character'} — click to view chats`);
        card.setAttribute('title', 'Click to view character and chats');
    });
    markSelectedCard();
}

async function fetchCharacterChats(chid, { force = false } = {}) {
    const character = characterById(chid);
    if (!character?.avatar) return [];

    const key = String(character.avatar);
    const cached = chatCache.get(key);
    if (!force && cached && Date.now() - cached.time < 30000) return cached.data;

    const ctx = currentContext();
    const response = await fetch('/api/characters/chats', {
        method: 'POST',
        headers: ctx?.getRequestHeaders?.() || { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            avatar_url: character.avatar,
            metadata: true,
        }),
        cache: 'no-cache',
    });

    if (!response.ok) throw new Error(`Chat list request failed (${response.status})`);
    const payload = await response.json();
    const chats = Array.isArray(payload) ? payload.filter(chat => chat?.file_id || chat?.file_name) : [];
    chats.sort((a, b) => {
        const av = Number(new Date(a.last_mes).getTime()) || Number(a.last_mes) || 0;
        const bv = Number(new Date(b.last_mes).getTime()) || Number(b.last_mes) || 0;
        return bv - av;
    });

    chatCache.set(key, { time: Date.now(), data: chats });
    return chats;
}

function renderLoading(character, card) {
    const detail = document.getElementById(DETAIL_ID);
    if (!detail) return;

    const avatar = avatarUrl(character, card);
    detail.innerHTML = `
        <div class="npcb-char-library-hero">
            <div class="npcb-char-library-avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : '<span>?</span>'}</div>
            <div class="npcb-char-library-identity">
                <small>CHARACTER</small>
                <strong>${escapeHtml(character?.name || 'Unknown')}</strong>
                <span>Loading chats…</span>
            </div>
        </div>
        <div class="npcb-char-library-loading">
            <i></i><span>Reading SillyTavern chat history…</span>
        </div>
    `;
}

function cardTags(card) {
    return [...(card?.querySelectorAll('.tags .tag') || [])]
        .map(tag => String(tag.textContent || '').trim())
        .filter(Boolean)
        .slice(0, 12);
}

function renderCharacterDetail(chid, chats, card) {
    const detail = document.getElementById(DETAIL_ID);
    const character = characterById(chid);
    if (!detail || !character) return;

    const ctx = currentContext();
    const avatar = avatarUrl(character, card);
    const description = characterDescription(character);
    const version = characterVersion(character);
    const tags = cardTags(card);
    const currentChatId = String(ctx?.getCurrentChatId?.() || ctx?.chatId || '');
    const isCurrentCharacter = String(ctx?.characterId) === String(chid);

    detail.innerHTML = `
        <div class="npcb-char-library-detail-scroll">
            <div class="npcb-char-library-hero">
                <div class="npcb-char-library-avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(character.name || '')}">` : '<span>?</span>'}</div>
                <div class="npcb-char-library-identity">
                    <small>CHARACTER</small>
                    <strong>${escapeHtml(character.name || 'Unknown')}</strong>
                    <span>${version ? `Version ${escapeHtml(version)} · ` : ''}${chats.length} chat${chats.length === 1 ? '' : 's'}</span>
                </div>
            </div>

            ${description ? `<p class="npcb-char-library-description">${escapeHtml(description)}</p>` : ''}

            ${tags.length ? `
                <div class="npcb-char-library-tags">
                    ${tags.map(tag => `<i>${escapeHtml(tag)}</i>`).join('')}
                </div>
            ` : ''}

            <div class="npcb-char-library-actions">
                <button type="button" data-char-action="open-current">OPEN LAST / CURRENT CHAT</button>
                <button type="button" data-char-action="refresh">↻ REFRESH CHATS</button>
            </div>

            <div class="npcb-char-library-chat-head">
                <div>
                    <small>CHAT HISTORY</small>
                    <strong>Choose where to continue</strong>
                </div>
                <input type="search" class="npcb-char-chat-search" placeholder="Search chats…">
            </div>

            <div class="npcb-char-chat-list">
                ${chats.length ? chats.map((chat, index) => {
                    const fileId = String(chat.file_id || String(chat.file_name || '').replace(/\.jsonl$/i, ''));
                    const current = isCurrentCharacter && fileId === currentChatId;
                    const preview = compactText(chat.mes, 180);
                    return `
                        <article class="npcb-char-chat-card ${current ? 'current' : ''}" data-chat-index="${index}" data-search-text="${escapeHtml((chatTitle(chat) + ' ' + preview).toLowerCase())}">
                            <div class="npcb-char-chat-main">
                                <div class="npcb-char-chat-titleline">
                                    <strong>${escapeHtml(chatTitle(chat))}</strong>
                                    ${current ? '<span>CURRENT</span>' : ''}
                                </div>
                                <p>${escapeHtml(preview || '[Empty chat]')}</p>
                                <div class="npcb-char-chat-meta">
                                    <span>◷ ${escapeHtml(formatTimestamp(chat.last_mes))}</span>
                                    <span>☰ ${Number(chat.chat_items || 0)} messages</span>
                                    ${chat.file_size ? `<span>▣ ${escapeHtml(chat.file_size)}</span>` : ''}
                                </div>
                            </div>
                            <button type="button" data-open-chat="${index}">OPEN CHAT</button>
                        </article>
                    `;
                }).join('') : `
                    <div class="npcb-char-library-no-chats">
                        <strong>No saved chats yet</strong>
                        <span>Open the character to begin its first chat.</span>
                    </div>
                `}
            </div>
        </div>
    `;

    const openExactChat = async chat => {
        const latestCtx = currentContext();
        if (!latestCtx) return;
        const fileId = String(chat.file_id || String(chat.file_name || '').replace(/\.jsonl$/i, ''));
        if (!fileId) return;

        try {
            if (String(latestCtx.characterId) !== String(chid)) {
                await latestCtx.selectCharacterById?.(Number(chid), { switchMenu: false });
            }
            await currentContext()?.openCharacterChat?.(fileId);
            chatCache.delete(String(character.avatar || ''));
        } catch (error) {
            console.error('[NPC Character Bar] Could not open character chat:', error);
        }
    };

    detail.querySelectorAll('[data-open-chat]').forEach(button => {
        button.addEventListener('click', async () => {
            const chat = chats[Number(button.dataset.openChat)];
            if (chat) await openExactChat(chat);
        });
    });

    detail.querySelector('[data-char-action="open-current"]')?.addEventListener('click', async () => {
        try {
            if (chats[0]) {
                await openExactChat(chats[0]);
            } else {
                await currentContext()?.selectCharacterById?.(Number(chid));
            }
        } catch (error) {
            console.error('[NPC Character Bar] Could not open character:', error);
        }
    });

    detail.querySelector('[data-char-action="refresh"]')?.addEventListener('click', async buttonEvent => {
        buttonEvent.currentTarget.disabled = true;
        try {
            chatCache.delete(String(character.avatar || ''));
            await selectCharacterPreview(chid, card, { force: true });
        } finally {
            buttonEvent.currentTarget.disabled = false;
        }
    });

    detail.querySelector('.npcb-char-chat-search')?.addEventListener('input', event => {
        const needle = String(event.target.value || '').trim().toLowerCase();
        detail.querySelectorAll('.npcb-char-chat-card').forEach(row => {
            row.hidden = Boolean(needle) && !String(row.dataset.searchText || '').includes(needle);
        });
    });
}

async function selectCharacterPreview(chid, card = null, { force = false } = {}) {
    const character = characterById(chid);
    if (!character) return;

    selectedChid = String(chid);
    markSelectedCard();
    renderLoading(character, card);

    const serial = ++requestSerial;
    try {
        const chats = await fetchCharacterChats(chid, { force });
        if (serial !== requestSerial || String(selectedChid) !== String(chid)) return;
        renderCharacterDetail(chid, chats, card || document.querySelector(`#rm_print_characters_block .character_select[data-chid="${CSS.escape(String(chid))}"]`));
    } catch (error) {
        if (serial !== requestSerial) return;
        const detail = document.getElementById(DETAIL_ID);
        if (detail) {
            detail.innerHTML = `
                <div class="npcb-char-library-error">
                    <strong>Could not load chats</strong>
                    <span>${escapeHtml(error.message || String(error))}</span>
                    <button type="button">TRY AGAIN</button>
                </div>
            `;
            detail.querySelector('button')?.addEventListener('click', () => selectCharacterPreview(chid, card, { force: true }));
        }
    }
}

function handleCharacterClick(event) {
    const card = event.target.closest?.('#rm_print_characters_block .character_select');
    if (!card) return;
    if (isBulkMode()) return;

    // Leave native controls/tags/context affordances alone.
    if (event.target.closest('input, label, button, a, .tag, .bulk_select_checkbox, .ch_fav_icon')) return;

    const chid = card.dataset.chid ?? card.getAttribute('data-chid');
    if (chid === undefined || chid === null || chid === '') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    selectCharacterPreview(chid, card);
}

function handleKeyboard(event) {
    if (!['Enter', ' '].includes(event.key)) return;
    const card = event.target.closest?.('#rm_print_characters_block .character_select');
    if (!card || isBulkMode()) return;
    const chid = card.dataset.chid;
    if (chid === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    selectCharacterPreview(chid, card);
}

export function refreshCharacterLibrary() {
    const shell = ensureShell();
    if (!shell) return;

    if (selectedChid) {
        const card = document.querySelector(`#rm_print_characters_block .character_select[data-chid="${CSS.escape(String(selectedChid))}"]`);
        if (!characterById(selectedChid)) {
            selectedChid = '';
            renderEmptyDetail();
        } else {
            markSelectedCard();
            if (card) card.classList.add('npcb-library-selected');
        }
    }
}

export function mountCharacterLibrary() {
    ensureShell();
    if (installed) return;
    installed = true;

    document.addEventListener('click', handleCharacterClick, true);
    document.addEventListener('keydown', handleKeyboard, true);

    const ctx = currentContext();
    const events = ctx?.eventTypes || {};
    if (events.CHARACTER_PAGE_LOADED) {
        ctx.eventSource?.on?.(events.CHARACTER_PAGE_LOADED, () => setTimeout(refreshCharacterLibrary, 0));
    }
    if (events.CHAT_CHANGED) {
        ctx.eventSource?.on?.(events.CHAT_CHANGED, () => {
            const current = currentContext();
            if (selectedChid && String(current?.characterId) === String(selectedChid)) {
                chatCache.delete(String(characterById(selectedChid)?.avatar || ''));
                setTimeout(() => {
                    const card = document.querySelector(`#rm_print_characters_block .character_select[data-chid="${CSS.escape(String(selectedChid))}"]`);
                    if (card) selectCharacterPreview(selectedChid, card, { force: true });
                }, 150);
            }
        });
    }

    const observer = new MutationObserver(() => {
        if (document.getElementById('rm_print_characters_block')) refreshCharacterLibrary();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
