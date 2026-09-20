import { findByNameOrAlias, getState, makeCharacter, saveState } from './store.js';

function mergeScene(character, update) {
    for (const key of ['location', 'mood', 'action', 'condition', 'clothing', 'thoughts']) {
        if (update[key] !== undefined && update[key] !== null) {
            character.scene[key] = String(update[key]);
        }
    }
    if (update.relationship !== undefined && update.relationship !== null && update.relationship !== '') {
        if (typeof update.relationship === 'string') character.relationship.label = update.relationship;
        else Object.assign(character.relationship, update.relationship || {});
    }
    if (update.status) character.status = update.status;
}

function mergePersistent(character, update) {
    if (Array.isArray(update.aliases)) {
        const seen = new Set((character.aliases || []).map(x => String(x).trim().toLowerCase()));
        for (const alias of update.aliases) {
            const clean = String(alias || '').trim();
            if (!clean || clean.toLowerCase() === character.name.toLowerCase()) continue;
            if (!seen.has(clean.toLowerCase())) {
                character.aliases.push(clean);
                seen.add(clean.toLowerCase());
            }
        }
    }

    if (!character.role && update.role) character.role = String(update.role);
    if (!character.faction && update.faction) character.faction = String(update.faction);

    const profileMap = ['age', 'gender', 'appearance', 'personality', 'background', 'goals', 'secrets'];
    for (const key of profileMap) {
        const value = update.profile?.[key] ?? update[key];
        if (!character.profile[key] && value) character.profile[key] = String(value);
    }

    const memory = String(update.memory || '').trim();
    if (memory) {
        const exists = character.memories.some(m => String(m?.text ?? m).trim().toLowerCase() === memory.toLowerCase());
        if (!exists) character.memories.push({ date: '', text: memory });
    }
}

function resolveFromRaw(state, raw) {
    if (!raw) return null;
    if (raw.id && state.characters[raw.id]) return state.characters[raw.id];
    const names = [raw.name, raw.alias, ...(raw.aliases || [])].filter(Boolean);
    for (const name of names) {
        const found = findByNameOrAlias(state, name);
        if (found) return found;
    }
    return null;
}

function createFromRaw(state, raw) {
    if (!raw?.name || state.ui.autoRegisterTrackerNPCs === false) return null;
    const character = makeCharacter(raw);
    state.characters[character.id] = character;
    state.order.push(character.id);
    return character;
}

export async function applyTrackerPayload(payload = {}) {
    if (Array.isArray(payload)) {
        payload = {
            presentCharacters: payload.map(x => typeof x === 'string' ? x : x?.name).filter(Boolean),
            characterUpdates: payload.filter(x => x && typeof x === 'object').map(x => ({
                name: x.name,
                mood: x.mood || x.details?.mood,
                action: x.action || x.details?.action || x.details?.activity,
                location: x.location || x.details?.location,
                condition: x.condition || x.details?.condition,
                thoughts: x.thoughts?.content || x.thoughts || x.ThoughtsContent,
                relationship: x.relationship?.status || x.relationship || x.Relationship,
                role: x.role || x.details?.role,
                faction: x.faction || x.details?.faction,
                aliases: x.aliases || [],
            })),
            newCharacters: payload.filter(x => x && typeof x === 'object').map(x => ({
                name: x.name,
                aliases: x.aliases || [],
                role: x.role || x.details?.role || '',
                faction: x.faction || x.details?.faction || '',
            })),
            replacePresent: true,
        };
    }

    const state = getState();

    if (payload.scene && typeof payload.scene === 'object') {
        for (const key of ['location', 'time', 'summary']) {
            if (payload.scene[key] !== undefined && payload.scene[key] !== null && payload.scene[key] !== '') {
                state.scene[key] = String(payload.scene[key]);
            }
        }
    }

    for (const raw of payload.newCharacters || []) {
        if (!raw?.name) continue;
        let character = resolveFromRaw(state, raw);
        if (!character) character = createFromRaw(state, raw);
        if (character) {
            mergePersistent(character, raw);
            mergeScene(character, raw);
            character.updatedAt = new Date().toISOString();
        }
    }

    for (const update of payload.characterUpdates || []) {
        if (!update?.name && !update?.id && !update?.alias) continue;
        let character = resolveFromRaw(state, update);
        if (!character) character = createFromRaw(state, update);
        if (!character) continue;
        mergePersistent(character, update);
        mergeScene(character, update);
        character.updatedAt = new Date().toISOString();
    }

    if (Array.isArray(payload.presentCharacters)) {
        const presentIds = new Set();
        for (const item of payload.presentCharacters) {
            const raw = typeof item === 'string' ? { name: item } : item;
            if (!raw?.name) continue;
            let character = resolveFromRaw(state, raw);
            if (!character) character = createFromRaw(state, raw);
            if (character) presentIds.add(character.id);
        }

        for (const character of Object.values(state.characters)) {
            if (presentIds.has(character.id)) character.status = 'present';
            else if (payload.replacePresent !== false && character.status === 'present') character.status = 'away';
        }
    }

    await saveState(state);
    window.dispatchEvent(new CustomEvent('npcb:state-changed'));
    return state;
}

export function installTrackerBridge() {
    window.addEventListener('npcb:tracker-update', event => {
        applyTrackerPayload(event.detail || {}).catch(console.error);
    });
}
