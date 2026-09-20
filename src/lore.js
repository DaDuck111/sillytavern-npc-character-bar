import {
    world_names,
    selected_world_info,
    updateWorldInfoList,
} from '../../../../../scripts/world-info.js';
import { getContext } from './utils.js';

function q(value) {
    return JSON.stringify(String(value ?? ''));
}

function pipeValue(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    return String(result.pipe ?? result.newText ?? result.output ?? '');
}

async function run(command) {
    const ctx = getContext();
    if (typeof ctx.executeSlashCommandsWithOptions !== 'function') {
        throw new Error('This SillyTavern build does not expose executeSlashCommandsWithOptions().');
    }
    const result = await ctx.executeSlashCommandsWithOptions(command, {
        handleParserErrors: true,
        handleExecutionErrors: true,
    });
    return pipeValue(result).trim();
}

export function parseLoreProfile(content = '') {
    const result = {
        aliases: [],
        role: '',
        faction: '',
        profile: {},
        relationship: {},
        knowledge: [],
        memories: [],
        notes: '',
    };

    const labelMap = {
        'role': ['role'],
        'faction': ['faction'],
        'age': ['profile', 'age'],
        'gender': ['profile', 'gender'],
        'appearance': ['profile', 'appearance'],
        'personality': ['profile', 'personality'],
        'background': ['profile', 'background'],
        'goals': ['profile', 'goals'],
        'secrets': ['profile', 'secrets'],
        'relationship to {{user}}': ['relationship', 'label'],
        'relationship details': ['relationship', 'detail'],
        'notes': ['notes'],
    };

    const setPath = (obj, path, value) => {
        if (path.length === 1) {
            obj[path[0]] = value;
            return;
        }
        obj[path[0]] ||= {};
        obj[path[0]][path[1]] = value;
    };

    for (const rawLine of String(content || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('[NPC:')) continue;
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        const label = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (!value) continue;

        if (label === 'aliases') {
            result.aliases = value.split(',').map(x => x.trim()).filter(Boolean);
            continue;
        }
        if (label === 'knowledge / secrets known') {
            result.knowledge = value.split('|').map(x => x.trim()).filter(Boolean);
            continue;
        }
        const path = labelMap[label];
        if (path) setPath(result, path, value);
    }
    return result;
}

export function applyLoreContentToCharacter(character, content, { overwrite = true } = {}) {
    const parsed = parseLoreProfile(content);
    const assign = (target, key, value) => {
        if (!value) return;
        if (overwrite || !target[key]) target[key] = value;
    };

    if (parsed.aliases.length) {
        const merged = new Map();
        for (const alias of [...(character.aliases || []), ...parsed.aliases]) {
            const clean = String(alias || '').trim();
            if (clean) merged.set(clean.toLowerCase(), clean);
        }
        character.aliases = [...merged.values()];
    }

    assign(character, 'role', parsed.role);
    assign(character, 'faction', parsed.faction);
    character.profile ||= {};
    for (const key of ['age', 'gender', 'appearance', 'personality', 'background', 'goals', 'secrets']) {
        assign(character.profile, key, parsed.profile?.[key]);
    }

    character.relationship ||= {};
    assign(character.relationship, 'label', parsed.relationship?.label);
    assign(character.relationship, 'detail', parsed.relationship?.detail);

    if (parsed.knowledge.length) {
        character.knowledge = [...new Set([...(character.knowledge || []), ...parsed.knowledge])];
    }
    return character;
}

export function buildLoreContent(character) {
    const lines = [];
    const add = (label, value) => {
        const text = String(value || '').trim();
        if (text) lines.push(`${label}: ${text}`);
    };

    lines.push(`[NPC: ${character.name}]`);
    if (character.aliases?.length) add('Aliases', character.aliases.join(', '));
    add('Role', character.role);
    add('Faction', character.faction);
    add('Age', character.profile?.age);
    add('Gender', character.profile?.gender);
    add('Appearance', character.profile?.appearance);
    add('Personality', character.profile?.personality);
    add('Background', character.profile?.background);
    add('Goals', character.profile?.goals);
    add('Secrets', character.profile?.secrets);
    add('Relationship to {{user}}', character.relationship?.label);
    add('Relationship details', character.relationship?.detail);
    if (character.knowledge?.length) add('Knowledge / secrets known', character.knowledge.join(' | '));

    if (character.lore?.includeScene) {
        add('Current location', character.scene?.location);
        add('Current condition', character.scene?.condition);
        add('Current mood', character.scene?.mood);
        add('Current activity', character.scene?.action);
        add('Current clothing', character.scene?.clothing);
    }

    return lines.join('\n');
}

const LORE_META_KEY = 'npc_character_bar_lore_meta_v1';

function loreMetaRoot() {
    const ctx = getContext();
    ctx.extensionSettings ||= {};
    if (!ctx.extensionSettings[LORE_META_KEY] || typeof ctx.extensionSettings[LORE_META_KEY] !== 'object') {
        ctx.extensionSettings[LORE_META_KEY] = { books: {} };
    }
    ctx.extensionSettings[LORE_META_KEY].books ||= {};
    return ctx.extensionSettings[LORE_META_KEY];
}

function saveLoreMeta() {
    getContext().saveSettingsDebounced?.();
}

export function getLorebookCatalog() {
    const meta = loreMetaRoot();
    return getLorebookNames().map(name => ({
        name,
        active: (selected_world_info || []).includes(name),
        group: String(meta.books?.[name]?.group || ''),
        tags: Array.isArray(meta.books?.[name]?.tags) ? [...meta.books[name].tags] : [],
    }));
}

export function updateLorebookMeta(name, patch = {}) {
    const clean = String(name || '').trim();
    if (!clean) return false;
    const meta = loreMetaRoot();
    meta.books[clean] ||= { group: '', tags: [] };
    if (patch.group !== undefined) meta.books[clean].group = String(patch.group || '').trim();
    if (patch.tags !== undefined) {
        meta.books[clean].tags = [...new Set((Array.isArray(patch.tags) ? patch.tags : [])
            .map(tag => String(tag || '').trim().replace(/^#/, ''))
            .filter(Boolean))];
    }
    saveLoreMeta();
    return true;
}

export function getLorebookGroups() {
    return [...new Set(getLorebookCatalog().map(book => book.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function getLorebookTags() {
    return [...new Set(getLorebookCatalog().flatMap(book => book.tags || []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export async function setLorebookActive(name, active) {
    const clean = String(name || '').trim();
    if (!clean) return false;
    const list = selected_world_info || [];
    const index = list.indexOf(clean);

    if (active && index < 0) list.push(clean);
    if (!active && index >= 0) list.splice(index, 1);

    await updateWorldInfoList();
    if (typeof window.$ === 'function') window.$('#world_info').trigger('change');
    else getContext().saveSettingsDebounced?.();

    return true;
}

export function getLorebookNames() {
    return [...new Set(Array.isArray(world_names) ? world_names.filter(Boolean).map(String) : [])]
        .sort((a, b) => a.localeCompare(b));
}

export async function findLoreEntry(book, character) {
    const names = [character.name, ...(character.aliases || [])].filter(Boolean);
    for (const name of names) {
        const uid = await run(`/findentry file=${q(book)} field=key ${q(name)}`);
        if (uid) return String(uid).trim();
    }
    return '';
}

export async function syncLore(character, { book = character.lore?.book || '', createIfMissing = true } = {}) {
    const resolvedBook = String(book || '').trim() || await getChatBook();
    if (!resolvedBook) throw new Error('Could not resolve a Lorebook.');

    let uid = String(character.lore?.uid || '').trim();
    if (!uid || resolvedBook !== String(character.lore?.book || '').trim()) {
        uid = await findLoreEntry(resolvedBook, character);
    }

    let content = '';
    if (uid) {
        content = await run(`/getentryfield file=${q(resolvedBook)} field=content ${q(uid)}`);
        return {
            book: resolvedBook,
            uid,
            content,
            lastSync: new Date().toISOString(),
            created: false,
        };
    }

    if (!createIfMissing) {
        return {
            book: resolvedBook,
            uid: '',
            content: '',
            lastSync: new Date().toISOString(),
            created: false,
        };
    }

    content = buildLoreContent(character);
    uid = await run(`/createentry file=${q(resolvedBook)} key=${q([character.name, ...(character.aliases || [])].filter(Boolean).join(','))} ${q(content)}`);
    if (!uid) throw new Error('Could not create Lorebook entry.');

    await run(`/setentryfield file=${q(resolvedBook)} uid=${q(uid)} field=comment ${q(`NPC — ${character.name}`)}`);

    return {
        book: resolvedBook,
        uid: String(uid).trim(),
        content,
        lastSync: new Date().toISOString(),
        created: true,
    };
}

export async function getChatBook() {
    return run('/getchatbook');
}

export async function pushLore(character, { rebuild = false } = {}) {
    const book = character.lore?.book?.trim() || await getChatBook();
    if (!book) throw new Error('Could not resolve a chat Lorebook.');

    const keys = [character.name, ...(character.aliases || [])].filter(Boolean).join(',');
    const content = rebuild || !character.lore?.content?.trim()
        ? buildLoreContent(character)
        : character.lore.content.trim();

    let entryUid = String(character.lore?.uid || '').trim();
    if (!entryUid) {
        entryUid = await run(`/createentry file=${q(book)} key=${q(keys)} ${q(content)}`);
        if (!entryUid) throw new Error('Lorebook entry was not created.');
    }

    await run(`/setentryfield file=${q(book)} uid=${q(entryUid)} field=comment ${q(`NPC — ${character.name}`)}`);
    await run(`/setentryfield file=${q(book)} uid=${q(entryUid)} field=key ${q(keys)}`);
    await run(`/setentryfield file=${q(book)} uid=${q(entryUid)} field=content ${q(content)}`);

    return {
        book,
        uid: entryUid,
        content,
        lastSync: new Date().toISOString(),
    };
}

export async function pullLore(character) {
    const book = character.lore?.book?.trim() || await getChatBook();
    const entryUid = String(character.lore?.uid || '').trim();
    if (!book || !entryUid) throw new Error('Set a Lorebook and entry UID first.');

    const content = await run(`/getentryfield file=${q(book)} field=content ${q(entryUid)}`);
    const keys = await run(`/getentryfield file=${q(book)} field=key ${q(entryUid)}`);

    return {
        book,
        uid: entryUid,
        content,
        keys,
        lastSync: new Date().toISOString(),
    };
}
