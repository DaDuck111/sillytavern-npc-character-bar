import { deepClone, getContext, normalizeName, uid } from './utils.js';

const SETTINGS_KEY = 'npc_character_bar_global';

const DEFAULT_ARCHIVE = {
    version: 3,
    groups: {},
    npcs: {},
    deletedNpcIds: [],
    redirects: {},
};

function settingsRoot() {
    const ctx = getContext();
    ctx.extensionSettings ||= {};
    if (!ctx.extensionSettings[SETTINGS_KEY] || typeof ctx.extensionSettings[SETTINGS_KEY] !== 'object') {
        ctx.extensionSettings[SETTINGS_KEY] = deepClone(DEFAULT_ARCHIVE);
    }
    const root = ctx.extensionSettings[SETTINGS_KEY];
    root.version = 3;
    root.groups ||= {};
    root.npcs ||= {};
    root.deletedNpcIds = Array.isArray(root.deletedNpcIds) ? root.deletedNpcIds : [];
    root.redirects ||= {};
    return root;
}

function saveGlobal() {
    const ctx = getContext();
    ctx.saveSettingsDebounced?.();
    window.dispatchEvent(new CustomEvent('npcb:archive-changed'));
}

export function getCurrentChatRef() {
    const ctx = getContext();
    const id = String(ctx.getCurrentChatId?.() || ctx.chatId || 'unknown-chat');
    const groupId = ctx.groupId != null && ctx.groupId !== '' ? String(ctx.groupId) : '';
    const group = groupId ? (ctx.groups || []).find(x => String(x.id) === groupId) : null;
    const characterId = !groupId && ctx.characterId != null ? String(ctx.characterId) : '';
    const character = !groupId && ctx.characters?.[Number(ctx.characterId)] ? ctx.characters[Number(ctx.characterId)] : null;
    const characterName = String(character?.name || '');
    const characterAvatar = String(character?.avatar || '');
    const sourceKey = groupId
        ? `group:${groupId}`
        : `character:${characterAvatar || characterName || characterId || 'unknown'}`;
    const sourceLabel = String(group?.name || characterName || 'Unknown source');
    const label = String(id || 'Current chat');
    return {
        id,
        label,
        kind: groupId ? 'group' : 'chat',
        groupId,
        groupLabel: String(group?.name || ''),
        characterId,
        characterName,
        characterAvatar,
        sourceKey,
        sourceLabel,
    };
}

export function getGlobalArchive() {
    return deepClone(settingsRoot());
}

function snapshotCharacter(character) {
    return {
        name: character.name || 'Unnamed NPC',
        aliases: Array.isArray(character.aliases) ? [...character.aliases] : [],
        portrait: character.portrait || '',
        role: character.role || '',
        faction: character.faction || '',
        relationship: deepClone(character.relationship || { label: 'Unknown', detail: '', value: 0 }),
        profile: deepClone(character.profile || {}),
        vitals: deepClone(character.vitals || {}),
        system: deepClone(character.system || {}),
        knowledge: deepClone(character.knowledge || []),
        memories: [],
        notes: character.notes || '',
        lore: deepClone(character.lore || {}),
        latestScene: deepClone(character.scene || {}),
        status: character.status || 'unknown',
        updatedAt: character.updatedAt || new Date().toISOString(),
    };
}

function resolveRedirect(root, archiveId) {
    let current = String(archiveId || '');
    const seen = new Set();
    while (current && root.redirects?.[current] && !seen.has(current)) {
        seen.add(current);
        current = String(root.redirects[current]);
    }
    return current;
}

function findArchiveMatch(root, character, chatRef) {
    if (character.archiveId) {
        const resolvedId = resolveRedirect(root, character.archiveId);
        if (resolvedId !== character.archiveId) character.archiveId = resolvedId;
        if (root.npcs[resolvedId]) return root.npcs[resolvedId];
        if ((root.deletedNpcIds || []).includes(character.archiveId)) return null;
    }

    const needle = normalizeName(character.name);
    if (!needle) return null;

    const sameIdentity = entry => normalizeName(entry.name) === needle
        || (entry.aliases || []).some(alias => normalizeName(alias) === needle)
        || (character.aliases || []).some(alias =>
            normalizeName(alias) === normalizeName(entry.name)
            || (entry.aliases || []).some(existing => normalizeName(existing) === normalizeName(alias)));

    const candidates = Object.values(root.npcs).filter(sameIdentity);
    const linked = candidates.find(entry => (entry.chatLinks || []).some(link =>
        link.chatId === chatRef.id && (!link.sourceKey || !chatRef.sourceKey || link.sourceKey === chatRef.sourceKey)));
    if (linked) return linked;

    // Same NPC appearing in a new chat under the same SillyTavern character/group
    // should reuse one archive identity even when AUTO-LINK is off.
    const sameSource = candidates.filter(entry => (entry.chatLinks || []).some(link =>
        link.sourceKey && chatRef.sourceKey && link.sourceKey === chatRef.sourceKey));
    if (sameSource.length === 1) return sameSource[0];
    if (sameSource.length > 1) {
        sameSource.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        return sameSource[0];
    }

    // Legacy archive records created before source ownership was stored:
    // if there is only one matching identity and it has no conflicting known source,
    // reuse it rather than creating another duplicate on a fresh chat.
    if (candidates.length === 1) {
        const knownSources = [...new Set((candidates[0].chatLinks || []).map(link => link.sourceKey).filter(Boolean))];
        if (!knownSources.length || knownSources.includes(chatRef.sourceKey)) return candidates[0];
    }

    return candidates.find(entry => {
        if (!entry.autoInsert) return false;
        if (entry.scope === 'global') return true;
        if (entry.scope === 'chat') return entry.scopeRef === chatRef.id;
        if (entry.scope === 'group') return Boolean(chatRef.groupId) && entry.scopeRef === chatRef.groupId;
        return false;
    }) || null;
}

export function syncArchiveFromState(state) {
    const root = settingsRoot();
    const chat = getCurrentChatRef();
    const now = new Date().toISOString();

    for (const character of Object.values(state.characters || {})) {
        const rawArchiveId = String(character.archiveId || '');
        const redirectedId = rawArchiveId ? resolveRedirect(root, rawArchiveId) : '';
        if (redirectedId && redirectedId !== rawArchiveId) character.archiveId = redirectedId;
        if ((rawArchiveId && (root.deletedNpcIds || []).includes(rawArchiveId) && !root.redirects?.[rawArchiveId])
            || (redirectedId && (root.deletedNpcIds || []).includes(redirectedId))) {
            continue;
        }

        let entry = findArchiveMatch(root, character, chat);

        if (!entry) {
            const archiveId = character.archiveId || uid('archive');
            entry = {
                id: archiveId,
                name: character.name || 'Unnamed NPC',
                aliases: [],
                portrait: '',
                role: '',
                faction: '',
                relationship: { label: 'Unknown', detail: '', value: 0 },
                profile: {},
                vitals: {},
                system: {},
                knowledge: [],
                memories: [],
                notes: '',
                lore: {},
                latestScene: {},
                status: character.status || 'unknown',
                groupIds: [],
                tags: [],
                scope: 'global',
                scopeRef: '',
                autoInsert: false,
                chatLinks: [],
                createdAt: now,
                updatedAt: now,
            };
            root.npcs[archiveId] = entry;
        }

        character.archiveId = entry.id;
        Object.assign(entry, snapshotCharacter(character));
        entry.id = character.archiveId;
        entry.groupIds ||= [];
        entry.tags ||= [];
        entry.scope = ['global', 'chat', 'group'].includes(entry.scope) ? entry.scope : 'global';
        entry.scopeRef ||= '';
        entry.autoInsert = Boolean(entry.autoInsert);
        entry.chatLinks ||= [];

        const existingLink = entry.chatLinks.find(link => link.chatId === chat.id);
        const link = {
            chatId: chat.id,
            label: chat.label,
            kind: chat.kind,
            groupId: chat.groupId,
            groupLabel: chat.groupLabel,
            characterId: chat.characterId,
            characterName: chat.characterName,
            characterAvatar: chat.characterAvatar,
            sourceKey: chat.sourceKey,
            sourceLabel: chat.sourceLabel,
            localId: character.id,
            lastSeen: now,
        };
        if (existingLink) Object.assign(existingLink, link);
        else entry.chatLinks.push(link);

        entry.updatedAt = now;
    }

    saveGlobal();
    return state;
}

export function createArchiveGroup(name) {
    const clean = String(name || '').trim();
    if (!clean) return null;
    const root = settingsRoot();
    const id = uid('group');
    root.groups[id] = { id, name: clean, createdAt: new Date().toISOString() };
    saveGlobal();
    return deepClone(root.groups[id]);
}

export function renameArchiveGroup(groupId, name) {
    const root = settingsRoot();
    if (!root.groups[groupId]) return false;
    const clean = String(name || '').trim();
    if (!clean) return false;
    root.groups[groupId].name = clean;
    saveGlobal();
    return true;
}

export function deleteArchiveGroup(groupId) {
    const root = settingsRoot();
    delete root.groups[groupId];
    for (const entry of Object.values(root.npcs)) {
        entry.groupIds = (entry.groupIds || []).filter(id => id !== groupId);
    }
    saveGlobal();
}

export function setNpcGroups(archiveId, groupIds) {
    const root = settingsRoot();
    const entry = root.npcs[archiveId];
    if (!entry) return false;
    entry.groupIds = [...new Set((groupIds || []).filter(id => root.groups[id]))];
    entry.updatedAt = new Date().toISOString();
    saveGlobal();
    return true;
}

export function toggleNpcGroup(archiveId, groupId) {
    const root = settingsRoot();
    const entry = root.npcs[archiveId];
    if (!entry || !root.groups[groupId]) return false;
    const set = new Set(entry.groupIds || []);
    if (set.has(groupId)) set.delete(groupId);
    else set.add(groupId);
    entry.groupIds = [...set];
    entry.updatedAt = new Date().toISOString();
    saveGlobal();
    return true;
}

export function updateArchiveNpcMeta(archiveId, patch = {}) {
    const root = settingsRoot();
    const entry = root.npcs[archiveId];
    if (!entry) return false;

    if (patch.tags !== undefined) {
        entry.tags = [...new Set((Array.isArray(patch.tags) ? patch.tags : [])
            .map(x => String(x || '').trim())
            .filter(Boolean))];
    }
    if (patch.scope !== undefined && ['global', 'chat', 'group'].includes(patch.scope)) {
        entry.scope = patch.scope;
    }
    if (patch.scopeRef !== undefined) entry.scopeRef = String(patch.scopeRef || '');
    if (patch.autoInsert !== undefined) entry.autoInsert = Boolean(patch.autoInsert);

    entry.updatedAt = new Date().toISOString();
    saveGlobal();
    return true;
}

export function addNpcToGroup(archiveId, groupId) {
    const root = settingsRoot();
    const entry = root.npcs[archiveId];
    if (!entry || !root.groups[groupId]) return false;
    entry.groupIds ||= [];
    if (!entry.groupIds.includes(groupId)) entry.groupIds.push(groupId);
    entry.updatedAt = new Date().toISOString();
    saveGlobal();
    return true;
}

export function removeNpcFromGroup(archiveId, groupId) {
    const root = settingsRoot();
    const entry = root.npcs[archiveId];
    if (!entry) return false;
    entry.groupIds = (entry.groupIds || []).filter(id => id !== groupId);
    entry.updatedAt = new Date().toISOString();
    saveGlobal();
    return true;
}

export function unlinkArchiveFromChat(archiveId, chatId) {
    const root = settingsRoot();
    const entry = root.npcs[archiveId];
    if (!entry) return false;
    entry.chatLinks = (entry.chatLinks || []).filter(link => link.chatId !== chatId);
    entry.updatedAt = new Date().toISOString();
    saveGlobal();
    return true;
}

export function removeArchiveNpc(archiveId) {
    const root = settingsRoot();
    if (!root.npcs[archiveId]) return false;
    delete root.npcs[archiveId];
    root.deletedNpcIds ||= [];
    if (!root.deletedNpcIds.includes(archiveId)) root.deletedNpcIds.push(archiveId);
    delete root.redirects?.[archiveId];
    saveGlobal();
    return true;
}

export function removeArchiveNpcs(archiveIds = []) {
    const root = settingsRoot();
    let changed = false;
    root.deletedNpcIds ||= [];
    for (const archiveId of [...new Set(archiveIds.map(String))]) {
        if (!root.npcs[archiveId]) continue;
        delete root.npcs[archiveId];
        if (!root.deletedNpcIds.includes(archiveId)) root.deletedNpcIds.push(archiveId);
        delete root.redirects?.[archiveId];
        changed = true;
    }
    if (changed) saveGlobal();
    return changed;
}

export function bulkUpdateArchiveNpcTags(archiveIds = [], tags = [], { mode = 'replace' } = {}) {
    const root = settingsRoot();
    const cleaned = [...new Set((tags || []).map(x => String(x || '').trim().replace(/^#/, '')).filter(Boolean))];
    let changed = false;
    for (const archiveId of [...new Set(archiveIds.map(String))]) {
        const entry = root.npcs[archiveId];
        if (!entry) continue;
        if (mode === 'add') entry.tags = [...new Set([...(entry.tags || []), ...cleaned])];
        else if (mode === 'remove') entry.tags = (entry.tags || []).filter(tag => !cleaned.includes(tag));
        else entry.tags = cleaned;
        entry.updatedAt = new Date().toISOString();
        changed = true;
    }
    if (changed) saveGlobal();
    return changed;
}

export function mergeArchiveNpcs(archiveIds = [], targetId = '') {
    const root = settingsRoot();
    const ids = [...new Set(archiveIds.map(String))].filter(id => root.npcs[id]);
    if (ids.length < 2) return null;

    const entries = ids.map(id => root.npcs[id]).sort((a, b) =>
        String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const canonical = root.npcs[targetId] && ids.includes(String(targetId))
        ? root.npcs[String(targetId)]
        : entries[0];

    const unionStrings = values => [...new Set(values.map(x => String(x || '').trim()).filter(Boolean))];
    for (const entry of entries) {
        if (entry.id === canonical.id) continue;

        canonical.aliases = unionStrings([...(canonical.aliases || []), entry.name, ...(entry.aliases || [])])
            .filter(alias => normalizeName(alias) !== normalizeName(canonical.name));
        canonical.tags = unionStrings([...(canonical.tags || []), ...(entry.tags || [])]);
        canonical.groupIds = [...new Set([...(canonical.groupIds || []), ...(entry.groupIds || [])])];

        const chatMap = new Map();
        for (const link of [...(canonical.chatLinks || []), ...(entry.chatLinks || [])]) {
            const key = `${link.sourceKey || link.groupId || link.characterAvatar || link.characterName || ''}::${link.chatId}`;
            const existing = chatMap.get(key);
            if (!existing || String(link.lastSeen || '') > String(existing.lastSeen || '')) chatMap.set(key, deepClone(link));
        }
        canonical.chatLinks = [...chatMap.values()];

        canonical.profile ||= {};
        for (const [key, value] of Object.entries(entry.profile || {})) {
            if (!canonical.profile[key] && value) canonical.profile[key] = deepClone(value);
        }
        if (!canonical.role && entry.role) canonical.role = entry.role;
        if (!canonical.faction && entry.faction) canonical.faction = entry.faction;
        if (!canonical.portrait && entry.portrait) canonical.portrait = entry.portrait;
        canonical.knowledge = unionStrings([...(canonical.knowledge || []), ...(entry.knowledge || [])]);

        root.redirects[entry.id] = canonical.id;
        delete root.npcs[entry.id];
        root.deletedNpcIds = (root.deletedNpcIds || []).filter(id => id !== entry.id);
    }

    canonical.updatedAt = new Date().toISOString();
    saveGlobal();
    return deepClone(canonical);
}

export function getArchiveSeed(archiveId) {
    const entry = settingsRoot().npcs[archiveId];
    if (!entry) return null;
    return deepClone({
        archiveId: entry.id,
        name: entry.name,
        aliases: entry.aliases || [],
        portrait: entry.portrait || '',
        role: entry.role || '',
        faction: entry.faction || '',
        relationship: entry.relationship || {},
        profile: entry.profile || {},
        vitals: entry.vitals || {},
        system: entry.system || {},
        knowledge: entry.knowledge || [],
        notes: entry.notes || '',
        lore: entry.lore || {},
        scene: entry.latestScene || {},
        status: 'away',
    });
}
