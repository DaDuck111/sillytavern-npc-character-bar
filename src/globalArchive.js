import { deepClone, getContext, normalizeName, uid } from './utils.js';

const SETTINGS_KEY = 'npc_character_bar_global';

const DEFAULT_ARCHIVE = {
    version: 2,
    groups: {},
    npcs: {},
};

function settingsRoot() {
    const ctx = getContext();
    ctx.extensionSettings ||= {};
    if (!ctx.extensionSettings[SETTINGS_KEY] || typeof ctx.extensionSettings[SETTINGS_KEY] !== 'object') {
        ctx.extensionSettings[SETTINGS_KEY] = deepClone(DEFAULT_ARCHIVE);
    }
    const root = ctx.extensionSettings[SETTINGS_KEY];
    root.version = 2;
    root.groups ||= {};
    root.npcs ||= {};
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
    const label = String(group?.name || ctx.chatId || id || 'Current chat');
    return {
        id,
        label,
        kind: groupId ? 'group' : 'chat',
        groupId,
        groupLabel: String(group?.name || ''),
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

function findArchiveMatch(root, character, chatRef) {
    if (character.archiveId && root.npcs[character.archiveId]) return root.npcs[character.archiveId];

    const needle = normalizeName(character.name);
    if (!needle) return null;

    const sameIdentity = entry => normalizeName(entry.name) === needle
        || (entry.aliases || []).some(alias => normalizeName(alias) === needle)
        || (character.aliases || []).some(alias =>
            normalizeName(alias) === normalizeName(entry.name)
            || (entry.aliases || []).some(existing => normalizeName(existing) === normalizeName(alias)));

    const candidates = Object.values(root.npcs).filter(sameIdentity);
    const linked = candidates.find(entry => (entry.chatLinks || []).some(link => link.chatId === chatRef.id));
    if (linked) return linked;

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
    saveGlobal();
    return true;
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
