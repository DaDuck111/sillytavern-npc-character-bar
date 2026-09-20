import { findByNameOrAlias, getState, makeCharacter, saveState } from './store.js';

function mergeScene(character, update) {
    for (const key of ['location', 'mood', 'action', 'condition', 'clothing', 'thoughts']) {
        if (update[key] !== undefined) character.scene[key] = update[key] ?? '';
    }
    if (update.relationship !== undefined) {
        if (typeof update.relationship === 'string') character.relationship.label = update.relationship;
        else Object.assign(character.relationship, update.relationship || {});
    }
    if (update.status) character.status = update.status;
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

    for (const raw of payload.newCharacters || []) {
        if (!raw?.name) continue;
        let character = findByNameOrAlias(state, raw.name);
        if (!character && state.ui.autoRegisterTrackerNPCs) {
            character = makeCharacter(raw);
            state.characters[character.id] = character;
            state.order.push(character.id);
        }
        if (character) {
            character.aliases = [...new Set([...(character.aliases || []), ...(raw.aliases || [])])];
            if (raw.role) character.role = raw.role;
            if (raw.faction) character.faction = raw.faction;
            mergeScene(character, raw);
            character.updatedAt = new Date().toISOString();
        }
    }

    for (const update of payload.characterUpdates || []) {
        const character = update.id ? state.characters[update.id] : findByNameOrAlias(state, update.name || update.alias);
        if (!character) continue;
        mergeScene(character, update);
        character.updatedAt = new Date().toISOString();
    }

    if (Array.isArray(payload.presentCharacters)) {
        const presentIds = new Set();
        for (const name of payload.presentCharacters) {
            const character = findByNameOrAlias(state, name);
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
