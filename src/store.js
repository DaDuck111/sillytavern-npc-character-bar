import { deepClone, getContext, normalizeName, uid } from './utils.js';

export const META_KEY = 'npc_character_bar_v1';

export const STATUS = ['present', 'nearby', 'away', 'unknown', 'missing', 'dead', 'inactive'];

export const DEFAULT_STATE = Object.freeze({
    version: 2,
    characters: {},
    order: [],
    scene: {
        location: '',
        time: '',
        summary: '',
    },
    tracker: {
        autoRead: true,
        contextDepth: 6,
    },
    ui: {
        showAwayOnBar: false,
        compact: false,
        autoRegisterTrackerNPCs: true,
        position: 'above-input',
    },
});

export function makeCharacter(seed = {}) {
    const now = new Date().toISOString();
    return {
        id: seed.id || uid('npc'),
        name: seed.name || 'Unnamed NPC',
        aliases: Array.isArray(seed.aliases) ? seed.aliases : [],
        portrait: seed.portrait || '',
        role: seed.role || '',
        faction: seed.faction || '',
        status: STATUS.includes(seed.status) ? seed.status : 'present',
        relationship: {
            label: seed.relationship?.label || seed.relationship || 'Unknown',
            detail: seed.relationship?.detail || '',
        },
        profile: {
            age: seed.profile?.age || seed.age || '',
            gender: seed.profile?.gender || seed.gender || '',
            appearance: seed.profile?.appearance || seed.appearance || '',
            personality: seed.profile?.personality || seed.personality || '',
            background: seed.profile?.background || seed.background || '',
            goals: seed.profile?.goals || seed.goals || '',
            secrets: seed.profile?.secrets || seed.secrets || '',
        },
        scene: {
            location: seed.scene?.location || seed.location || '',
            mood: seed.scene?.mood || seed.mood || '',
            action: seed.scene?.action || seed.action || '',
            condition: seed.scene?.condition || seed.condition || '',
            clothing: seed.scene?.clothing || seed.clothing || '',
            thoughts: seed.scene?.thoughts || seed.thoughts || '',
        },
        knowledge: Array.isArray(seed.knowledge) ? seed.knowledge : [],
        memories: Array.isArray(seed.memories) ? seed.memories : [],
        notes: seed.notes || '',
        lore: {
            book: seed.lore?.book || '',
            uid: String(seed.lore?.uid || ''),
            content: seed.lore?.content || '',
            includeScene: Boolean(seed.lore?.includeScene),
            lastSync: seed.lore?.lastSync || '',
        },
        createdAt: seed.createdAt || now,
        updatedAt: now,
    };
}

function normalizeCharacter(raw = {}) {
    const base = makeCharacter(raw);
    return {
        ...base,
        ...raw,
        aliases: Array.isArray(raw.aliases) ? raw.aliases.filter(Boolean) : base.aliases,
        relationship: { ...base.relationship, ...(typeof raw.relationship === 'object' ? raw.relationship : {}) },
        profile: { ...base.profile, ...(raw.profile || {}) },
        scene: { ...base.scene, ...(raw.scene || {}) },
        lore: { ...base.lore, ...(raw.lore || {}) },
        knowledge: Array.isArray(raw.knowledge) ? raw.knowledge : [],
        memories: Array.isArray(raw.memories) ? raw.memories : [],
    };
}

export function getState() {
    const ctx = getContext();
    const raw = ctx.chatMetadata?.[META_KEY];
    const state = deepClone(raw || DEFAULT_STATE);
    state.version = 2;
    state.characters ||= {};
    state.order ||= [];
    state.scene = { ...DEFAULT_STATE.scene, ...(state.scene || {}) };
    state.tracker = { ...DEFAULT_STATE.tracker, ...(state.tracker || {}) };
    state.ui = { ...DEFAULT_STATE.ui, ...(state.ui || {}) };

    for (const [id, character] of Object.entries(state.characters)) {
        state.characters[id] = normalizeCharacter({ ...character, id });
    }

    state.order = state.order.filter(id => state.characters[id]);
    for (const id of Object.keys(state.characters)) {
        if (!state.order.includes(id)) state.order.push(id);
    }
    return state;
}

export async function saveState(state) {
    const ctx = getContext();
    ctx.chatMetadata[META_KEY] = deepClone(state);
    await ctx.saveMetadata();
    return state;
}

export async function mutateState(mutator) {
    const state = getState();
    await mutator(state);
    return saveState(state);
}

function coreName(value) {
    return normalizeName(value)
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .replace(/^the\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function findByNameOrAlias(state, value) {
    const needle = normalizeName(value);
    if (!needle) return null;
    const core = coreName(value);

    return Object.values(state.characters).find(character => {
        const candidates = [character.name, ...(character.aliases || [])]
            .filter(Boolean);
        const normalized = candidates.map(normalizeName);
        if (normalized.includes(needle)) return true;
        return candidates.some(candidate => core && coreName(candidate) === core);
    }) || null;
}

export async function addCharacter(seed = {}) {
    let created;
    await mutateState(state => {
        const existing = seed.name ? findByNameOrAlias(state, seed.name) : null;
        if (existing) {
            created = existing;
            return;
        }
        created = makeCharacter(seed);
        state.characters[created.id] = created;
        state.order.push(created.id);
    });
    return created;
}

export async function updateCharacter(id, patchOrUpdater) {
    let updated;
    await mutateState(state => {
        const current = state.characters[id];
        if (!current) return;
        if (typeof patchOrUpdater === 'function') patchOrUpdater(current, state);
        else Object.assign(current, patchOrUpdater);
        current.updatedAt = new Date().toISOString();
        updated = current;
    });
    return updated;
}

export async function deleteCharacter(id) {
    return mutateState(state => {
        delete state.characters[id];
        state.order = state.order.filter(x => x !== id);
    });
}

export async function importRoster(payload) {
    const incoming = payload?.characters ? payload : { characters: payload };
    return mutateState(state => {
        const list = Array.isArray(incoming.characters)
            ? incoming.characters
            : Object.values(incoming.characters || {});
        for (const raw of list) {
            if (!raw?.name) continue;
            const existing = findByNameOrAlias(state, raw.name);
            if (existing) {
                const merged = normalizeCharacter({ ...existing, ...raw, id: existing.id });
                state.characters[existing.id] = merged;
                continue;
            }
            const character = makeCharacter(raw);
            state.characters[character.id] = character;
            state.order.push(character.id);
        }
        if (incoming.scene) state.scene = { ...state.scene, ...incoming.scene };
        if (incoming.tracker) state.tracker = { ...state.tracker, ...incoming.tracker };
        if (incoming.ui) state.ui = { ...state.ui, ...incoming.ui };
    });
}
