import { deepClone, getContext, normalizeName, uid } from './utils.js';
import { getCurrentChatRef, syncArchiveFromState, unlinkArchiveFromChat } from './globalArchive.js';

export const META_KEY = 'npc_character_bar_v1';

export const STATUS = ['present', 'nearby', 'away', 'unknown', 'missing', 'dead', 'inactive'];
export const CORE_ATTRIBUTES = ['STR', 'DEX', 'INT', 'STA', 'SEN'];

const DEFAULT_ATTRIBUTES = Object.freeze({
    STR: 0,
    DEX: 0,
    INT: 0,
    STA: 0,
    SEN: 0,
});

export const DEFAULT_PLAYER = Object.freeze({
    name: '',
    title: '',
    className: '',
    hasSystem: false,
    level: 0,
    xp: 0,
    xpToNext: 0,
    statPoints: 0,
    statPointsPerLevel: 5,
    attributes: DEFAULT_ATTRIBUTES,
    money: 0,
    currency: 'Gold',
    currentLocation: '',
    homeLocation: '',
    homeDescription: '',
    condition: '',
    stats: [
        { id: 'stat_hp', name: 'Health', value: 100, max: 100, unit: '', aiTrack: true },
        { id: 'stat_fatigue', name: 'Fatigue', value: 0, max: 100, unit: '%', aiTrack: true },
    ],
    inventoryLimits: {
        onPerson: 12,
        clothing: 8,
        defaultStorage: 30,
    },
    storageLocations: [],
    inventory: [],
    skills: [],
    titles: [],
});

export const DEFAULT_STATE = Object.freeze({
    version: 4,
    characters: {},
    order: [],
    scene: {
        location: '',
        time: '',
        summary: '',
    },
    player: DEFAULT_PLAYER,
    quests: [],
    events: [],
    tracker: {
        autoRead: true,
        contextDepth: 6,
        trackPlayer: true,
        trackInventory: true,
        trackStats: true,
        trackSkills: true,
        trackMoney: true,
        trackQuests: true,
        trackEvents: true,
        trackNpcVitals: true,
    },
    ui: {
        showAwayOnBar: false,
        compact: false,
        autoRegisterTrackerNPCs: true,
        position: 'above-input',
    },
});

function normalizeAttributes(raw = {}) {
    const result = {};
    for (const key of CORE_ATTRIBUTES) {
        result[key] = Math.max(0, Number(raw?.[key]) || 0);
    }
    return result;
}

function normalizeStat(raw, index = 0) {
    return {
        id: raw?.id || uid('stat'),
        name: String(raw?.name || `Stat ${index + 1}`),
        value: Number.isFinite(Number(raw?.value)) ? Number(raw.value) : 0,
        max: Number.isFinite(Number(raw?.max)) ? Number(raw.max) : 100,
        unit: String(raw?.unit ?? ''),
        aiTrack: raw?.aiTrack !== false,
    };
}

function normalizeStorage(raw = {}) {
    return {
        id: raw.id || uid('storage'),
        name: String(raw.name || 'Storage'),
        capacity: Math.max(1, Number(raw.capacity) || 30),
        type: String(raw.type || 'location'),
        systemOnly: Boolean(raw.systemOnly),
        description: String(raw.description || ''),
    };
}

function normalizeInventoryItem(raw = {}) {
    const locationType = ['person', 'clothing', 'stored'].includes(raw.locationType) ? raw.locationType : 'person';
    return {
        id: raw.id || uid('item'),
        name: String(raw.name || 'Item'),
        quantity: Math.max(0, Number(raw.quantity ?? raw.qty ?? 1) || 0),
        type: String(raw.type || ''),
        description: String(raw.description || ''),
        equipped: Boolean(raw.equipped),
        value: Number.isFinite(Number(raw.value)) ? Number(raw.value) : 0,
        locationType,
        storageId: locationType === 'stored' ? String(raw.storageId || '') : '',
    };
}

function normalizeSkill(raw = {}) {
    return {
        id: raw.id || uid('skill'),
        name: String(raw.name || 'Skill'),
        rank: String(raw.rank || raw.level || ''),
        description: String(raw.description || ''),
        source: String(raw.source || ''),
    };
}

function normalizeQuest(raw = {}) {
    return {
        id: raw.id || uid('quest'),
        title: String(raw.title || 'Untitled Quest'),
        type: String(raw.type || 'story'),
        status: ['active', 'completed', 'failed', 'hidden'].includes(raw.status) ? raw.status : 'active',
        description: String(raw.description || ''),
        objectives: Array.isArray(raw.objectives)
            ? raw.objectives.map(obj => ({
                id: obj?.id || uid('objective'),
                text: String(obj?.text || obj || ''),
                complete: Boolean(obj?.complete),
            })).filter(obj => obj.text)
            : [],
        reward: String(raw.reward || ''),
        source: String(raw.source || ''),
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || new Date().toISOString(),
    };
}

function normalizeEvent(raw = {}) {
    return {
        id: raw.id || uid('event'),
        type: String(raw.type || 'story'),
        title: String(raw.title || 'Event'),
        description: String(raw.description || ''),
        location: String(raw.location || ''),
        participants: Array.isArray(raw.participants) ? raw.participants.filter(Boolean).map(String) : [],
        importance: ['minor', 'normal', 'major', 'critical'].includes(raw.importance) ? raw.importance : 'normal',
        createdAt: raw.createdAt || new Date().toISOString(),
    };
}

function normalizePlayer(raw = {}) {
    const ctx = getContext();
    const base = deepClone(DEFAULT_PLAYER);
    const hasSystem = Boolean(raw.hasSystem);
    const merged = {
        ...base,
        ...raw,
        name: raw.name || ctx.name1 || '',
        hasSystem,
        attributes: normalizeAttributes(raw.attributes || {}),
        stats: Array.isArray(raw.stats) ? raw.stats.map(normalizeStat) : base.stats.map(normalizeStat),
        storageLocations: Array.isArray(raw.storageLocations) ? raw.storageLocations.map(normalizeStorage) : [],
        inventory: Array.isArray(raw.inventory) ? raw.inventory.map(normalizeInventoryItem) : [],
        skills: Array.isArray(raw.skills) ? raw.skills.map(normalizeSkill) : [],
        titles: Array.isArray(raw.titles) ? raw.titles.filter(Boolean).map(String) : [],
        inventoryLimits: { ...base.inventoryLimits, ...(raw.inventoryLimits || {}) },
    };

    merged.statPointsPerLevel = Math.max(0, Number(merged.statPointsPerLevel) || 5);
    merged.statPoints = Math.max(0, Number(merged.statPoints) || 0);
    merged.money = Number(merged.money) || 0;

    if (!hasSystem) {
        merged.level = 0;
        merged.xp = 0;
        merged.xpToNext = 0;
        merged.statPoints = 0;
        merged.attributes = normalizeAttributes({});
    } else {
        merged.level = Math.max(1, Number(merged.level) || 1);
        merged.xp = Math.max(0, Number(merged.xp) || 0);
        merged.xpToNext = Math.max(1, Number(merged.xpToNext) || 100);
    }

    return merged;
}

export function makeCharacter(seed = {}) {
    const now = new Date().toISOString();
    const hasSystem = Boolean(seed.system?.hasSystem ?? seed.hasSystem);
    return {
        id: seed.id || uid('npc'),
        archiveId: seed.archiveId || '',
        name: seed.name || 'Unnamed NPC',
        aliases: Array.isArray(seed.aliases) ? seed.aliases : [],
        portrait: seed.portrait || '',
        role: seed.role || '',
        faction: seed.faction || '',
        status: STATUS.includes(seed.status) ? seed.status : 'present',
        relationship: {
            label: seed.relationship?.label || seed.relationship || 'Unknown',
            detail: seed.relationship?.detail || '',
            value: Number.isFinite(Number(seed.relationship?.value)) ? Number(seed.relationship.value) : 0,
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
        vitals: {
            hp: Number.isFinite(Number(seed.vitals?.hp)) ? Number(seed.vitals.hp) : 100,
            maxHp: Math.max(1, Number(seed.vitals?.maxHp) || 100),
            fatigue: Math.max(0, Number(seed.vitals?.fatigue) || 0),
            maxFatigue: Math.max(1, Number(seed.vitals?.maxFatigue) || 100),
        },
        system: {
            hasSystem,
            level: hasSystem ? Math.max(1, Number(seed.system?.level) || 1) : 0,
            xp: hasSystem ? Math.max(0, Number(seed.system?.xp) || 0) : 0,
            xpToNext: hasSystem ? Math.max(1, Number(seed.system?.xpToNext) || 100) : 0,
            attributes: hasSystem ? normalizeAttributes(seed.system?.attributes || {}) : normalizeAttributes({}),
            stats: hasSystem && Array.isArray(seed.system?.stats) ? seed.system.stats.map(normalizeStat) : [],
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
    const hasSystem = Boolean(raw.system?.hasSystem);
    return {
        ...base,
        ...raw,
        archiveId: raw.archiveId || '',
        aliases: Array.isArray(raw.aliases) ? raw.aliases.filter(Boolean) : base.aliases,
        relationship: {
            ...base.relationship,
            ...(typeof raw.relationship === 'object' ? raw.relationship : {}),
            value: Number.isFinite(Number(raw.relationship?.value)) ? Number(raw.relationship.value) : base.relationship.value,
        },
        profile: { ...base.profile, ...(raw.profile || {}) },
        scene: { ...base.scene, ...(raw.scene || {}) },
        vitals: {
            ...base.vitals,
            ...(raw.vitals || {}),
            hp: Number.isFinite(Number(raw.vitals?.hp)) ? Number(raw.vitals.hp) : base.vitals.hp,
            maxHp: Math.max(1, Number(raw.vitals?.maxHp) || base.vitals.maxHp),
            fatigue: Math.max(0, Number(raw.vitals?.fatigue) || 0),
            maxFatigue: Math.max(1, Number(raw.vitals?.maxFatigue) || base.vitals.maxFatigue),
        },
        system: {
            ...base.system,
            ...(raw.system || {}),
            hasSystem,
            level: hasSystem ? Math.max(1, Number(raw.system?.level) || 1) : 0,
            xp: hasSystem ? Math.max(0, Number(raw.system?.xp) || 0) : 0,
            xpToNext: hasSystem ? Math.max(1, Number(raw.system?.xpToNext) || 100) : 0,
            attributes: hasSystem ? normalizeAttributes(raw.system?.attributes || {}) : normalizeAttributes({}),
            stats: hasSystem && Array.isArray(raw.system?.stats) ? raw.system.stats.map(normalizeStat) : [],
        },
        lore: { ...base.lore, ...(raw.lore || {}) },
        knowledge: Array.isArray(raw.knowledge) ? raw.knowledge : [],
        memories: Array.isArray(raw.memories) ? raw.memories : [],
    };
}

export function getState() {
    const ctx = getContext();
    const raw = ctx.chatMetadata?.[META_KEY];
    const state = deepClone(raw || DEFAULT_STATE);
    state.version = 4;
    state.characters ||= {};
    state.order ||= [];
    state.scene = { ...DEFAULT_STATE.scene, ...(state.scene || {}) };
    state.player = normalizePlayer(state.player || {});
    state.quests = Array.isArray(state.quests) ? state.quests.map(normalizeQuest) : [];
    state.events = Array.isArray(state.events) ? state.events.map(normalizeEvent).slice(-100) : [];
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
    state.player = normalizePlayer(state.player || {});
    state.quests = Array.isArray(state.quests) ? state.quests.map(normalizeQuest) : [];
    state.events = Array.isArray(state.events) ? state.events.map(normalizeEvent).slice(-100) : [];
    syncArchiveFromState(state);
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
        const candidates = [character.name, ...(character.aliases || [])].filter(Boolean);
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
            if (seed.archiveId && !existing.archiveId) existing.archiveId = seed.archiveId;
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
    const current = getState().characters[id];
    if (current?.archiveId) unlinkArchiveFromChat(current.archiveId, getCurrentChatRef().id);
    return mutateState(state => {
        delete state.characters[id];
        state.order = state.order.filter(x => x !== id);
    });
}

export async function importRoster(payload) {
    const incoming = payload?.characters ? payload : { characters: payload };
    return mutateState(state => {
        const list = Array.isArray(incoming.characters) ? incoming.characters : Object.values(incoming.characters || {});
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
        if (incoming.player) state.player = normalizePlayer({ ...state.player, ...incoming.player });
        if (incoming.quests) state.quests = incoming.quests.map(normalizeQuest);
        if (incoming.events) state.events = incoming.events.map(normalizeEvent);
        if (incoming.tracker) state.tracker = { ...state.tracker, ...incoming.tracker };
        if (incoming.ui) state.ui = { ...state.ui, ...incoming.ui };
    });
}
