import { escapeHtml, getContext } from './utils.js';

const SHELL_ID = 'npcb-character-library-shell';
const DETAIL_ID = 'npcb-character-library-detail';
const ACTIVITY_KEY = 'npc_character_bar_daily_activity_v1';
let installed = false;
let selectedChid = '';
let requestSerial = 0;
const chatCache = new Map();

function currentContext() {
    try { return getContext(); } catch { return null; }
}

function activityRoot() {
    const ctx = currentContext();
    if (!ctx) return { chats: {} };
    ctx.extensionSettings ||= {};
    if (!ctx.extensionSettings[ACTIVITY_KEY] || typeof ctx.extensionSettings[ACTIVITY_KEY] !== 'object') {
        ctx.extensionSettings[ACTIVITY_KEY] = { chats: {}, favoriteChats: {} };
    }
    const root = ctx.extensionSettings[ACTIVITY_KEY];
    root.chats ||= {};
    root.favoriteChats ||= {};
    return root;
}

function localDayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function dayOrdinal(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!match) return NaN;
    return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

function streakFromDays(days = []) {
    const ordinals = [...new Set(days.map(dayOrdinal).filter(Number.isFinite))].sort((a, b) => a - b);
    if (!ordinals.length) return 0;

    const today = dayOrdinal(localDayKey());
    const last = ordinals.at(-1);
    if (last < today - 1 || last > today) return 0;

    let streak = 1;
    for (let i = ordinals.length - 1; i > 0; i--) {
        if (ordinals[i] - ordinals[i - 1] !== 1) break;
        streak++;
    }
    return streak;
}

function chatActivityKey(avatar, chatId) {
    return `${String(avatar || '')}::${String(chatId || '')}`;
}

function getChatStreak(avatar, chatId) {
    const record = activityRoot().chats?.[chatActivityKey(avatar, chatId)];
    return streakFromDays(record?.days || []);
}

function getCharacterStreak(avatar) {
    const cleanAvatar = String(avatar || '');
    if (!cleanAvatar) return 0;
    let best = 0;
    for (const record of Object.values(activityRoot().chats || {})) {
        if (String(record?.avatar || '') !== cleanAvatar) continue;
        best = Math.max(best, streakFromDays(record.days || []));
    }
    return best;
}

function isFavoriteChat(avatar, chatId) {
    const root = activityRoot();
    const key = String(avatar || '');
    return (root.favoriteChats?.[key] || []).includes(String(chatId || ''));
}

function toggleFavoriteChat(avatar, chatId) {
    const root = activityRoot();
    const key = String(avatar || '');
    const id = String(chatId || '');
    root.favoriteChats ||= {};
    const set = new Set(root.favoriteChats[key] || []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    root.favoriteChats[key] = [...set];
    currentContext()?.saveSettingsDebounced?.();
    return set.has(id);
}

function backfillCurrentChatActivity() {
    const ctx = currentContext();
    const character = characterById(ctx?.characterId);
    const chatId = String(ctx?.getCurrentChatId?.() || ctx?.chatId || '');
    const avatar = String(character?.avatar || '');
    if (!avatar || !chatId || !Array.isArray(ctx?.chat)) return false;

    const historicalDays = ctx.chat
        .filter(message => message?.is_user && message?.send_date)
        .map(message => {
            const date = new Date(message.send_date);
            return Number.isNaN(date.getTime()) ? '' : localDayKey(date);
        })
        .filter(Boolean);

    if (!historicalDays.length) return false;

    const root = activityRoot();
    const key = chatActivityKey(avatar, chatId);
    const record = root.chats[key] ||= {
        avatar,
        chatId,
        characterName: String(character?.name || ''),
        days: [],
    };

    const before = JSON.stringify(record.days || []);
    record.avatar = avatar;
    record.chatId = chatId;
    record.characterName = String(character?.name || record.characterName || '');
    record.days = [...new Set([...(record.days || []), ...historicalDays])]
        .filter(day => Number.isFinite(dayOrdinal(day)))
        .sort()
        .slice(-400);
    record.lastBackfill = new Date().toISOString();

    if (JSON.stringify(record.days) !== before) {
        ctx?.saveSettingsDebounced?.();
        return true;
    }
    return false;
}

function recordCurrentChatActivity() {
    const ctx = currentContext();
    const character = characterById(ctx?.characterId);
    const chatId = String(ctx?.getCurrentChatId?.() || ctx?.chatId || '');
    const avatar = String(character?.avatar || '');
    if (!avatar || !chatId) return false;

    const root = activityRoot();
    const key = chatActivityKey(avatar, chatId);
    const record = root.chats[key] ||= {
        avatar,
        chatId,
        characterName: String(character?.name || ''),
        days: [],
    };

    const today = localDayKey();
    record.avatar = avatar;
    record.chatId = chatId;
    record.characterName = String(character?.name || record.characterName || '');
    record.days = [...new Set([...(record.days || []), today])]
        .filter(day => Number.isFinite(dayOrdinal(day)))
        .sort()
        .slice(-400);
    record.lastActive = new Date().toISOString();

    ctx?.saveSettingsDebounced?.();
    return true;
}

function decorateHotswap() {
    const ctx = currentContext();
    document.querySelectorAll('#right-nav-panel .hotswap .avatar[data-chid]').forEach(avatarEl => {
        const chid = avatarEl.dataset.chid;
        const character = characterById(chid);
        if (!character) return;

        const streak = getCharacterStreak(character.avatar);
        avatarEl.classList.toggle('npcb-hotswap-current', String(ctx?.characterId) === String(chid));

        let badge = avatarEl.querySelector('.npcb-hotswap-streak');
        if (streak > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'npcb-hotswap-streak';
                avatarEl.appendChild(badge);
            }
            badge.textContent = `🔥${streak}`;
        } else {
            badge?.remove();
        }

        if (!avatarEl.dataset.npcbBaseTitle) avatarEl.dataset.npcbBaseTitle = avatarEl.getAttribute('title') || character.name || '';
        avatarEl.setAttribute('title', streak > 0
            ? `${avatarEl.dataset.npcbBaseTitle}\n🔥 ${streak}-day chat streak`
            : avatarEl.dataset.npcbBaseTitle);
    });
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

    document.getElementById('npcb-character-library-heading')?.remove();
    enhanceNativeCharacterEditor();
    enhanceCards();
    return shell;
}

function renderEmptyDetail() {
    const detail = document.getElementById(DETAIL_ID);
    const shell = document.getElementById(SHELL_ID);
    shell?.classList.remove('has-selection');
    if (!detail) return;
    detail.innerHTML = '';
}

function markSelectedCard() {
    document.querySelectorAll('#rm_print_characters_block .character_select').forEach(card => {
        card.classList.toggle('npcb-library-selected', String(card.dataset.chid) === String(selectedChid));
    });
}

function enhanceNativeCharacterEditor() {
    const back = document.getElementById('rm_button_back');
    if (back) {
        back.setAttribute('title', 'Back to Characters');
        back.setAttribute('aria-label', 'Back to Characters');
        back.dataset.npcbBackReady = '1';
    }

    const editor = document.getElementById('rm_ch_create_block');
    if (editor) editor.classList.add('npcb-native-character-editor');
}

function enhanceCards() {
    document.querySelectorAll('#rm_print_characters_block .character_select').forEach(card => {
        const chid = card.dataset.chid ?? card.getAttribute('data-chid');
        if (chid === null || chid === undefined) return;
        card.dataset.npcbLibraryReady = '1';
        card.setAttribute('aria-label', `${card.querySelector('.ch_name')?.textContent || 'Character'} — click to view chats`);
        card.setAttribute('title', 'Click to view chats');
        const character = characterById(chid);
        const streak = getCharacterStreak(character?.avatar);
        let streakBadge = card.querySelector('.npcb-character-streak');
        if (streak > 0) {
            if (!streakBadge) {
                streakBadge = document.createElement('span');
                streakBadge.className = 'npcb-character-streak';
                card.appendChild(streakBadge);
            }
            streakBadge.textContent = `🔥 ${streak} DAY${streak === 1 ? '' : 'S'}`;
            streakBadge.title = `${streak}-day activity streak across this character's chats`;
        } else {
            streakBadge?.remove();
        }

        if (!card.querySelector('.npcb-character-openhint')) {
            const hint = document.createElement('span');
            hint.className = 'npcb-character-openhint';
            hint.textContent = 'VIEW CHATS ›';
            card.appendChild(hint);
        }
    });
    markSelectedCard();
    decorateHotswap();
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
        const aId = String(a.file_id || String(a.file_name || '').replace(/\.jsonl$/i, ''));
        const bId = String(b.file_id || String(b.file_name || '').replace(/\.jsonl$/i, ''));
        const favDiff = Number(isFavoriteChat(character.avatar, bId)) - Number(isFavoriteChat(character.avatar, aId));
        if (favDiff) return favDiff;

        const av = Number(new Date(a.last_mes).getTime()) || Number(a.last_mes) || 0;
        const bv = Number(new Date(b.last_mes).getTime()) || Number(b.last_mes) || 0;
        return bv - av;
    });

    chatCache.set(key, { time: Date.now(), data: chats });
    return chats;
}

function backToCharacterList() {
    selectedChid = '';
    markSelectedCard();
    renderEmptyDetail();
}

function renderLoading(character, card) {
    const detail = document.getElementById(DETAIL_ID);
    if (!detail) return;

    const avatar = avatarUrl(character, card);
    detail.innerHTML = `
        <div class="npcb-char-library-detail-scroll">
        <button type="button" class="npcb-char-library-back">← BACK TO CHARACTERS</button>
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
        </div>
    `;
    detail.querySelector('.npcb-char-library-back')?.addEventListener('click', backToCharacterList);
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
            <button type="button" class="npcb-char-library-back">← BACK TO CHARACTERS</button>
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
                <button type="button" data-char-action="open-current">OPEN MOST RECENT CHAT</button>
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
                    const favorite = isFavoriteChat(character.avatar, fileId);
                    const preview = compactText(chat.mes, 180);
                    return `
                        <article class="npcb-char-chat-card ${current ? 'current' : ''} ${favorite ? 'favorite' : ''}" data-chat-index="${index}" data-search-text="${escapeHtml((chatTitle(chat) + ' ' + preview).toLowerCase())}">
                            <button type="button" class="npcb-chat-favorite ${favorite ? 'active' : ''}" data-favorite-chat="${index}" title="${favorite ? 'Remove from favorite chats' : 'Favorite this chat'}" aria-label="${favorite ? 'Remove from favorite chats' : 'Favorite this chat'}">★</button>
                            <div class="npcb-char-chat-main">
                                <div class="npcb-char-chat-titleline">
                                    <strong>${escapeHtml(chatTitle(chat))}</strong>
                                    ${current ? '<span class="npcb-chat-current">CURRENT</span>' : ''}
                                    ${getChatStreak(character.avatar, fileId) > 0 ? `<span class="npcb-chat-streak">🔥 ${getChatStreak(character.avatar, fileId)} DAY${getChatStreak(character.avatar, fileId) === 1 ? '' : 'S'}</span>` : ''}
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

    detail.querySelector('.npcb-char-library-back')?.addEventListener('click', backToCharacterList);

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

    detail.querySelectorAll('[data-favorite-chat]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            const chat = chats[Number(button.dataset.favoriteChat)];
            if (!chat) return;
            const fileId = String(chat.file_id || String(chat.file_name || '').replace(/\.jsonl$/i, ''));
            toggleFavoriteChat(character.avatar, fileId);
            chatCache.delete(String(character.avatar || ''));
            selectCharacterPreview(chid, card, { force: true });
        });
    });

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
    document.getElementById(SHELL_ID)?.classList.add('has-selection');
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
                <div class="npcb-char-library-detail-scroll">
                    <button type="button" class="npcb-char-library-back">← BACK TO CHARACTERS</button>
                    <div class="npcb-char-library-error">
                        <strong>Could not load chats</strong>
                        <span>${escapeHtml(error.message || String(error))}</span>
                        <button type="button" class="npcb-char-library-retry">TRY AGAIN</button>
                    </div>
                </div>
            `;
            detail.querySelector('.npcb-char-library-back')?.addEventListener('click', backToCharacterList);
            detail.querySelector('.npcb-char-library-retry')?.addEventListener('click', () => selectCharacterPreview(chid, card, { force: true }));
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
    enhanceNativeCharacterEditor();
    if (!shell) return;

    decorateHotswap();

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
    setTimeout(() => {
        if (backfillCurrentChatActivity()) {
            enhanceCards();
            decorateHotswap();
        }
    }, 250);
    if (installed) return;
    installed = true;

    document.addEventListener('click', handleCharacterClick, true);
    document.addEventListener('keydown', handleKeyboard, true);

    const ctx = currentContext();
    const events = ctx?.eventTypes || {};
    if (events.CHARACTER_PAGE_LOADED) {
        ctx.eventSource?.on?.(events.CHARACTER_PAGE_LOADED, () => setTimeout(refreshCharacterLibrary, 0));
    }
    if (events.MESSAGE_SENT) {
        ctx.eventSource?.on?.(events.MESSAGE_SENT, () => {
            if (!recordCurrentChatActivity()) return;
            requestAnimationFrame(() => {
                enhanceCards();
                decorateHotswap();
                if (selectedChid && String(currentContext()?.characterId) === String(selectedChid)) {
                    const card = document.querySelector(`#rm_print_characters_block .character_select[data-chid="${CSS.escape(String(selectedChid))}"]`);
                    if (card) selectCharacterPreview(selectedChid, card);
                }
            });
        });
    }
    if (events.CHARACTER_EDITED) {
        ctx.eventSource?.on?.(events.CHARACTER_EDITED, () => setTimeout(() => {
            enhanceCards();
            decorateHotswap();
        }, 80));
    }
    if (events.CHAT_CHANGED) {
        ctx.eventSource?.on?.(events.CHAT_CHANGED, () => {
            setTimeout(() => {
                backfillCurrentChatActivity();
                enhanceCards();
                decorateHotswap();
            }, 180);
            decorateHotswap();
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

    let refreshQueued = false;
    const scheduleRefresh = () => {
        if (refreshQueued) return;
        refreshQueued = true;
        requestAnimationFrame(() => {
            refreshQueued = false;
            try {
                refreshCharacterLibrary();
            } catch (error) {
                console.error('[NPC Character Bar] Character Library refresh failed:', error);
            }
        });
    };

    const observeTarget = document.getElementById('rm_characters_block');
    if (observeTarget) {
        const observer = new MutationObserver(mutations => {
            const relevant = mutations.some(mutation => {
                const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
                return nodes.some(node => {
                    if (!(node instanceof Element)) return false;
                    if (node.matches?.('.character_select, .group_select, .bogus_folder_select, #rm_print_characters_block')) return true;
                    return Boolean(node.querySelector?.('.character_select, .group_select, .bogus_folder_select, #rm_print_characters_block'));
                });
            });
            if (relevant) scheduleRefresh();
        });
        observer.observe(observeTarget, { childList: true, subtree: true });
    }
}
