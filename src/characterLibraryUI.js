import { escapeHtml, getContext } from './utils.js';

const SHELL_ID = 'npcb-character-library-shell';
const DETAIL_ID = 'npcb-character-library-detail';
const MODAL_ID = 'npcb-character-chat-modal';
const MODAL_CONTENT_ID = 'npcb-character-chat-modal-content';
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
        const character = characterById(chid, avatarEl.closest?.('.character_select') || null);
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

function characterList() {
    const ctx = currentContext();
    if (!ctx) return [];
    return Array.isArray(ctx.characters) ? ctx.characters : Object.values(ctx.characters || {});
}

function cardChid(card) {
    return String(
        card?.dataset?.chid
        ?? card?.getAttribute?.('data-chid')
        ?? card?.getAttribute?.('chid')
        ?? '',
    );
}

function characterFromCard(card) {
    if (!card) return null;

    const name = String(card.querySelector?.('.ch_name')?.textContent || '').trim() || 'Unknown';
    const avatarTitle = String(card.querySelector?.('.avatar')?.getAttribute?.('title') || '');
    const fileMatch = /(?:^|\n)File:\s*(.+)$/m.exec(avatarTitle);
    const avatar = String(fileMatch?.[1] || '').trim();

    if (!avatar) return null;
    return { name, avatar, data: {} };
}

function characterById(chid, card = null) {
    const chars = characterList();
    const numericId = Number(chid);

    if (Number.isInteger(numericId) && numericId >= 0 && chars[numericId]) {
        return chars[numericId];
    }

    // SillyTavern normally gives us a numeric data-chid, but themes/extensions
    // can rebuild the card. Resolve by avatar/name before giving up.
    const visibleName = String(card?.querySelector?.('.ch_name')?.textContent || '').trim();
    const avatarTitle = String(card?.querySelector?.('.avatar')?.getAttribute?.('title') || '');
    const fileMatch = /(?:^|\n)File:\s*(.+)$/m.exec(avatarTitle);
    const avatarFile = String(fileMatch?.[1] || '').trim();

    if (avatarFile) {
        const byAvatar = chars.find(character => String(character?.avatar || '') === avatarFile);
        if (byAvatar) return byAvatar;
    }

    if (visibleName) {
        const byName = chars.find(character => String(character?.name || '').trim() === visibleName);
        if (byName) return byName;
    }

    // Last-resort descriptor made entirely from the DOM. This is enough to
    // query /api/characters/chats even if getContext().characters is stale.
    return characterFromCard(card);
}

function characterIndex(character, fallbackChid = '') {
    const chars = characterList();
    const numericId = Number(fallbackChid);

    // The DOM's data-chid is SillyTavern's canonical index. Prefer it even
    // when character came from the DOM fallback above.
    if (Number.isInteger(numericId) && numericId >= 0 && numericId < chars.length) {
        return numericId;
    }

    return chars.indexOf(character);
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

function ensureChatModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="npcb-character-chat-modal-backdrop" data-npcb-modal-close></div>
        <section class="npcb-character-chat-modal-panel" role="dialog" aria-modal="true" aria-label="Character chats">
            <div id="${MODAL_CONTENT_ID}"></div>
        </section>
    `;

    document.body.appendChild(modal);

    // Keep all modal pointer/click events from bubbling into SillyTavern's
    // drawer handlers. Without this, closing the modal can also close the
    // Character Management drawer behind it.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
        modal.addEventListener(type, event => {
            event.stopPropagation();
        });
    }

    modal.addEventListener('click', event => {
        if (event.target.closest?.('[data-npcb-modal-close]')) closeChatModal();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    });

    return modal;
}

function chatDetailHost() {
    ensureChatModal();
    return document.getElementById(MODAL_CONTENT_ID);
}

function openChatModal() {
    const modal = ensureChatModal();
    const rightPanel = document.getElementById('right-nav-panel');

    // Remember whether Character Management was open before previewing.
    modal.dataset.npcbKeepRightDrawerOpen = rightPanel?.classList.contains('openDrawer') ? '1' : '0';

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
}

function restoreCharacterDrawerIfNeeded(modal) {
    if (modal?.dataset?.npcbKeepRightDrawerOpen !== '1') return;

    const rightPanel = document.getElementById('right-nav-panel');
    if (!rightPanel || rightPanel.classList.contains('openDrawer')) return;

    // SillyTavern's own toggle is #unimportantYes. Use it instead of forcing
    // CSS classes so its internal drawer state stays in sync.
    document.getElementById('unimportantYes')?.click();
}

function closeChatModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    selectedChid = '';
    markSelectedCard();

    // Fail-safe: if another extension/SillyTavern closed the drawer anyway,
    // reopen it on the next turn using SillyTavern's native toggle.
    setTimeout(() => restoreCharacterDrawerIfNeeded(modal), 0);
    setTimeout(() => restoreCharacterDrawerIfNeeded(modal), 180);
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
        const chid = cardChid(card);
        if (!chid) return;
        card.dataset.npcbLibraryReady = '1';
        card.setAttribute('role', 'button');
        if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `${card.querySelector('.ch_name')?.textContent || 'Character'} — click to view chats`);
        card.setAttribute('title', 'Click to view chats');
        const character = characterById(chid, card);
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

        let hint = card.querySelector('.npcb-character-openhint');
        if (!hint || hint.tagName !== 'BUTTON') {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'npcb-character-openhint';
            button.textContent = 'VIEW CHATS ›';
            if (hint) hint.replaceWith(button);
            else card.appendChild(button);
            hint = button;
        }
        hint.setAttribute('aria-label', `View chats for ${card.querySelector('.ch_name')?.textContent || 'character'}`);

    });
    markSelectedCard();
    decorateHotswap();
}

async function fetchCharacterChats(chid, { force = false, character: suppliedCharacter = null, card = null } = {}) {
    const character = suppliedCharacter || characterById(chid, card);
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
    closeChatModal();
}

function renderLoading(character, card) {
    const detail = chatDetailHost();
    if (!detail) return;

    openChatModal();

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

function renderCharacterDetail(chid, chats, card, suppliedCharacter = null) {
    const detail = chatDetailHost();
    const character = suppliedCharacter || characterById(chid, card);
    if (!detail || !character) return;

    const resolvedIndex = characterIndex(character, chid);

    const ctx = currentContext();
    const avatar = avatarUrl(character, card);
    const description = characterDescription(character);
    const version = characterVersion(character);
    const tags = cardTags(card);
    const currentChatId = String(ctx?.getCurrentChatId?.() || ctx?.chatId || '');
    const isCurrentCharacter = resolvedIndex >= 0 && String(ctx?.characterId) === String(resolvedIndex);

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
            if (resolvedIndex >= 0 && String(latestCtx.characterId) !== String(resolvedIndex)) {
                await latestCtx.selectCharacterById?.(resolvedIndex, { switchMenu: false });
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
                if (resolvedIndex >= 0) await currentContext()?.selectCharacterById?.(resolvedIndex);
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

async function selectCharacterPreview(chid, card = null, { force = false, character: suppliedCharacter = null } = {}) {
    const character = suppliedCharacter || characterById(chid, card);
    if (!character) {
        console.warn('[NPC Character Bar] Could not resolve clicked character card.', { chid, card });
        return false;
    }

    selectedChid = String(chid);
    markSelectedCard();
    renderLoading(character, card);

    const serial = ++requestSerial;
    try {
        const chats = await fetchCharacterChats(chid, { force, character, card });
        if (serial !== requestSerial || String(selectedChid) !== String(chid)) return true;
        renderCharacterDetail(
            chid,
            chats,
            card || document.querySelector(`#rm_print_characters_block .character_select[data-chid="${CSS.escape(String(chid))}"]`),
            character,
        );
    } catch (error) {
        if (serial !== requestSerial) return;
        const detail = chatDetailHost();
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
            detail.querySelector('.npcb-char-library-retry')?.addEventListener('click', () => selectCharacterPreview(chid, card, { force: true, character }));
        }
    }
    return true;
}

function beginPreviewFromCard(card, { force = false } = {}) {
    if (!card) return false;

    const chid = cardChid(card);
    if (!chid) return false;

    const character = characterById(chid, card);
    if (!character) {
        console.warn('[NPC Character Bar] Character card could not be matched.', { chid, card });
        return false;
    }

    ensureChatModal();
    void selectCharacterPreview(chid, card, { force, character });
    return true;
}

function cardFromEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const node of path) {
        if (node instanceof Element && node.matches?.('#rm_print_characters_block .character_select')) {
            return node;
        }
    }
    return event.target?.closest?.('#rm_print_characters_block .character_select') || null;
}

function handleWindowCharacterClick(event) {
    const card = cardFromEvent(event);
    if (!card) return;

    const ownButton = event.target?.closest?.('.npcb-character-openhint');
    const nativeControl = event.target?.closest?.('input, label, button, a, .tag, .bulk_select_checkbox, .ch_fav_icon');

    // Explicit VIEW CHATS always wins. Whole-card click is disabled only while
    // SillyTavern is in one of its bulk-selection modes.
    if (!ownButton && nativeControl) return;
    if (!ownButton && isBulkMode()) return;

    if (!beginPreviewFromCard(card)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
}

function handleWindowCharacterKeydown(event) {
    if (!['Enter', ' '].includes(event.key)) return;
    const card = cardFromEvent(event);
    if (!card || event.target !== card || isBulkMode()) return;
    if (!beginPreviewFromCard(card)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
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

    // Capture at window level so the character browser still receives the
    // click before SillyTavern or another extension can swallow it on document.
    window.addEventListener('click', handleWindowCharacterClick, true);
    window.addEventListener('keydown', handleWindowCharacterKeydown, true);

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
