import { findByNameOrAlias, getState, makeCharacter, saveState } from './store.js';
import { normalizeName, uid } from './utils.js';

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

function findStat(player, name) {
    const needle = normalizeName(name);
    return player.stats.find(stat => normalizeName(stat.name) === needle) || null;
}

function findItem(player, name) {
    const needle = normalizeName(name);
    return player.inventory.find(item => normalizeName(item.name) === needle) || null;
}

function findSkill(player, name) {
    const needle = normalizeName(name);
    return player.skills.find(skill => normalizeName(skill.name) === needle) || null;
}

function applyPlayerUpdate(state, update = {}) {
    const player = state.player;
    const tracker = state.tracker || {};

    for (const key of ['name', 'title', 'className', 'currency', 'currentLocation', 'homeLocation', 'homeDescription', 'condition']) {
        if (update[key] !== undefined && update[key] !== null && String(update[key]).trim() !== '') {
            player[key] = String(update[key]);
        }
    }

    if (update.level !== undefined && update.level !== null && update.level !== '') {
        player.level = Math.max(1, Number(update.level) || player.level || 1);
    }
    if (update.xpToNext !== undefined && update.xpToNext !== null && update.xpToNext !== '') {
        player.xpToNext = Math.max(1, Number(update.xpToNext) || player.xpToNext || 100);
    }
    if (update.xp !== undefined && update.xp !== null && update.xp !== '') {
        player.xp = Math.max(0, Number(update.xp) || 0);
    } else if (update.xpDelta !== undefined && update.xpDelta !== null && update.xpDelta !== '') {
        player.xp = Math.max(0, (Number(player.xp) || 0) + (Number(update.xpDelta) || 0));
    }

    if (tracker.trackMoney !== false) {
        if (update.money !== undefined && update.money !== null && update.money !== '') {
            player.money = Number(update.money) || 0;
        } else if (update.moneyDelta !== undefined && update.moneyDelta !== null && update.moneyDelta !== '') {
            player.money = (Number(player.money) || 0) + (Number(update.moneyDelta) || 0);
        }
    }

    if (tracker.trackStats !== false && Array.isArray(update.statUpdates)) {
        for (const raw of update.statUpdates) {
            if (!raw?.name) continue;
            let stat = findStat(player, raw.name);
            if (!stat) {
                stat = {
                    id: uid('stat'),
                    name: String(raw.name),
                    value: Number(raw.value ?? 0) || 0,
                    max: Number(raw.max ?? 100) || 100,
                    unit: String(raw.unit ?? ''),
                    aiTrack: true,
                };
                player.stats.push(stat);
            }
            if (stat.aiTrack === false) continue;
            if (raw.max !== undefined && raw.max !== null && raw.max !== '') stat.max = Number(raw.max) || stat.max || 100;
            if (raw.unit !== undefined && raw.unit !== null) stat.unit = String(raw.unit);
            if (raw.value !== undefined && raw.value !== null && raw.value !== '') stat.value = Number(raw.value) || 0;
            else if (raw.delta !== undefined && raw.delta !== null && raw.delta !== '') stat.value = (Number(stat.value) || 0) + (Number(raw.delta) || 0);
            if (Number.isFinite(Number(stat.max)) && Number(stat.max) > 0) {
                stat.value = Math.max(0, Math.min(Number(stat.value) || 0, Number(stat.max)));
            }
        }
    }

    if (tracker.trackInventory !== false) {
        for (const raw of update.inventoryAdd || []) {
            if (!raw?.name) continue;
            let item = findItem(player, raw.name);
            const qty = Math.max(1, Number(raw.quantity ?? raw.qty ?? 1) || 1);
            if (!item) {
                item = {
                    id: uid('item'),
                    name: String(raw.name),
                    quantity: qty,
                    type: String(raw.type || ''),
                    description: String(raw.description || ''),
                    equipped: Boolean(raw.equipped),
                    value: Number(raw.value) || 0,
                };
                player.inventory.push(item);
            } else {
                item.quantity = Math.max(0, Number(item.quantity || 0) + qty);
                if (raw.type) item.type = String(raw.type);
                if (raw.description) item.description = String(raw.description);
                if (raw.equipped !== undefined) item.equipped = Boolean(raw.equipped);
                if (raw.value !== undefined && raw.value !== '') item.value = Number(raw.value) || 0;
            }
        }

        for (const raw of update.inventoryRemove || []) {
            if (!raw?.name) continue;
            const item = findItem(player, raw.name);
            if (!item) continue;
            const qty = Math.max(1, Number(raw.quantity ?? raw.qty ?? 1) || 1);
            item.quantity = Math.max(0, Number(item.quantity || 0) - qty);
        }
        player.inventory = player.inventory.filter(item => Number(item.quantity) > 0);

        for (const raw of update.inventoryUpdate || []) {
            if (!raw?.name) continue;
            const item = findItem(player, raw.name);
            if (!item) continue;
            if (raw.quantity !== undefined && raw.quantity !== null && raw.quantity !== '') item.quantity = Math.max(0, Number(raw.quantity) || 0);
            if (raw.type !== undefined && raw.type !== null) item.type = String(raw.type);
            if (raw.description !== undefined && raw.description !== null) item.description = String(raw.description);
            if (raw.equipped !== undefined) item.equipped = Boolean(raw.equipped);
            if (raw.value !== undefined && raw.value !== null && raw.value !== '') item.value = Number(raw.value) || 0;
        }
        player.inventory = player.inventory.filter(item => Number(item.quantity) > 0);
    }

    if (tracker.trackSkills !== false) {
        for (const raw of update.skillsAdd || []) {
            if (!raw?.name) continue;
            let skill = findSkill(player, raw.name);
            if (!skill) {
                skill = {
                    id: uid('skill'),
                    name: String(raw.name),
                    rank: String(raw.rank || raw.level || ''),
                    description: String(raw.description || ''),
                    source: String(raw.source || ''),
                };
                player.skills.push(skill);
            } else {
                if (raw.rank || raw.level) skill.rank = String(raw.rank || raw.level);
                if (raw.description) skill.description = String(raw.description);
                if (raw.source) skill.source = String(raw.source);
            }
        }

        for (const raw of update.skillsUpdate || []) {
            if (!raw?.name) continue;
            const skill = findSkill(player, raw.name);
            if (!skill) continue;
            if (raw.rank !== undefined || raw.level !== undefined) skill.rank = String(raw.rank ?? raw.level ?? '');
            if (raw.description !== undefined) skill.description = String(raw.description || '');
            if (raw.source !== undefined) skill.source = String(raw.source || '');
        }
    }

    for (const title of update.titlesAdd || []) {
        const clean = String(title || '').trim();
        if (clean && !player.titles.some(x => normalizeName(x) === normalizeName(clean))) player.titles.push(clean);
    }

    if (!player.currentLocation && state.scene?.location) player.currentLocation = state.scene.location;
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

    if (payload.playerUpdates && state.tracker?.trackPlayer !== false) {
        applyPlayerUpdate(state, payload.playerUpdates);
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
