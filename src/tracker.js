import { CORE_ATTRIBUTES, findByNameOrAlias, getState, makeCharacter, saveState } from './store.js';
import { normalizeName, uid } from './utils.js';

function mergeScene(character, update) {
    for (const key of ['location', 'mood', 'action', 'condition', 'clothing', 'thoughts']) {
        if (update[key] !== undefined && update[key] !== null && update[key] !== '') {
            character.scene[key] = String(update[key]);
        }
    }

    if (update.relationship !== undefined && update.relationship !== null && update.relationship !== '') {
        if (typeof update.relationship === 'string') character.relationship.label = update.relationship;
        else Object.assign(character.relationship, update.relationship || {});
    }

    if (update.relationshipValue !== undefined && update.relationshipValue !== null && update.relationshipValue !== '') {
        character.relationship.value = Math.max(-100, Math.min(100, Number(update.relationshipValue) || 0));
    }

    if (update.status) character.status = update.status;
}

function mergeNpcVitals(character, update, trackVitals = true) {
    if (!trackVitals) return;

    if (update.maxHp !== undefined && update.maxHp !== null && update.maxHp !== '') {
        character.vitals.maxHp = Math.max(1, Number(update.maxHp) || character.vitals.maxHp || 100);
    }
    if (update.hp !== undefined && update.hp !== null && update.hp !== '') {
        character.vitals.hp = Math.max(0, Math.min(Number(update.hp) || 0, character.vitals.maxHp));
    } else if (update.hpDelta !== undefined && update.hpDelta !== null && update.hpDelta !== '') {
        character.vitals.hp = Math.max(0, Math.min(
            (Number(character.vitals.hp) || 0) + (Number(update.hpDelta) || 0),
            character.vitals.maxHp,
        ));
    }

    if (update.maxFatigue !== undefined && update.maxFatigue !== null && update.maxFatigue !== '') {
        character.vitals.maxFatigue = Math.max(1, Number(update.maxFatigue) || character.vitals.maxFatigue || 100);
    }
    if (update.fatigue !== undefined && update.fatigue !== null && update.fatigue !== '') {
        character.vitals.fatigue = Math.max(0, Math.min(Number(update.fatigue) || 0, character.vitals.maxFatigue));
    } else if (update.fatigueDelta !== undefined && update.fatigueDelta !== null && update.fatigueDelta !== '') {
        character.vitals.fatigue = Math.max(0, Math.min(
            (Number(character.vitals.fatigue) || 0) + (Number(update.fatigueDelta) || 0),
            character.vitals.maxFatigue,
        ));
    }
}

function applyAttributePatch(target, raw = {}) {
    target.attributes ||= {};
    for (const key of CORE_ATTRIBUTES) {
        if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
            target.attributes[key] = Math.max(0, Number(raw[key]) || 0);
        }
    }
}

function mergeNpcSystem(character, update) {
    const incomingHasSystem = update.hasSystem ?? update.system?.hasSystem;

    if (incomingHasSystem === true && !character.system.hasSystem) {
        character.system.hasSystem = true;
        character.system.level = Math.max(1, Number(update.level ?? update.system?.level) || 1);
        character.system.xp = 0;
        character.system.xpToNext = Math.max(1, Number(update.xpToNext ?? update.system?.xpToNext) || 100);
        if (CORE_ATTRIBUTES.every(key => !Number(character.system.attributes?.[key]))) {
            character.system.attributes = Object.fromEntries(CORE_ATTRIBUTES.map(key => [key, 10]));
        }
    }

    if (incomingHasSystem === false) {
        character.system.hasSystem = false;
        character.system.level = 0;
        character.system.xp = 0;
        character.system.xpToNext = 0;
        character.system.attributes = Object.fromEntries(CORE_ATTRIBUTES.map(key => [key, 0]));
        character.system.stats = [];
        return;
    }

    if (!character.system.hasSystem) return;

    if (update.level !== undefined && update.level !== null && update.level !== '') {
        character.system.level = Math.max(1, Number(update.level) || character.system.level || 1);
    }
    if (update.xp !== undefined && update.xp !== null && update.xp !== '') {
        character.system.xp = Math.max(0, Number(update.xp) || 0);
    } else if (update.xpDelta !== undefined && update.xpDelta !== null && update.xpDelta !== '') {
        character.system.xp = Math.max(0, (Number(character.system.xp) || 0) + (Number(update.xpDelta) || 0));
    }
    if (update.xpToNext !== undefined && update.xpToNext !== null && update.xpToNext !== '') {
        character.system.xpToNext = Math.max(1, Number(update.xpToNext) || character.system.xpToNext || 100);
    }

    applyAttributePatch(character.system, update.attributes || update.system?.attributes || {});

    const statUpdates = update.systemStats || update.system?.stats || [];
    if (Array.isArray(statUpdates)) {
        for (const raw of statUpdates) {
            if (!raw?.name) continue;
            let stat = character.system.stats.find(x => normalizeName(x.name) === normalizeName(raw.name));
            if (!stat) {
                stat = {
                    id: uid('npcstat'),
                    name: String(raw.name),
                    value: Number(raw.value) || 0,
                    max: Math.max(1, Number(raw.max) || 100),
                    unit: String(raw.unit || ''),
                    aiTrack: true,
                };
                character.system.stats.push(stat);
            } else {
                if (raw.max !== undefined && raw.max !== '') stat.max = Math.max(1, Number(raw.max) || stat.max);
                if (raw.value !== undefined && raw.value !== '') stat.value = Math.max(0, Math.min(Number(raw.value) || 0, stat.max));
                else if (raw.delta !== undefined && raw.delta !== '') stat.value = Math.max(0, Math.min((Number(stat.value) || 0) + (Number(raw.delta) || 0), stat.max));
                if (raw.unit !== undefined) stat.unit = String(raw.unit || '');
            }
        }
    }
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

function findItem(player, name, locationType = '', storageId = '') {
    const needle = normalizeName(name);
    return player.inventory.find(item => {
        if (normalizeName(item.name) !== needle) return false;
        if (locationType && item.locationType !== locationType) return false;
        if (locationType === 'stored' && storageId && item.storageId !== storageId) return false;
        return true;
    }) || null;
}

function findSkill(player, name) {
    const needle = normalizeName(name);
    return player.skills.find(skill => normalizeName(skill.name) === needle) || null;
}

function findStorage(player, nameOrId) {
    const needle = normalizeName(nameOrId);
    return player.storageLocations.find(storage =>
        storage.id === nameOrId || normalizeName(storage.name) === needle) || null;
}

function ensureStorage(player, raw) {
    if (!raw?.name) return null;
    let storage = findStorage(player, raw.id || raw.name);
    if (storage) return storage;
    if (raw.systemOnly && !player.hasSystem) return null;

    storage = {
        id: raw.id || uid('storage'),
        name: String(raw.name),
        capacity: Math.max(1, Number(raw.capacity) || player.inventoryLimits.defaultStorage || 30),
        type: String(raw.type || 'location'),
        systemOnly: Boolean(raw.systemOnly),
        description: String(raw.description || ''),
    };
    player.storageLocations.push(storage);
    return storage;
}

function activatePlayerSystem(player, update) {
    if (player.hasSystem) return;
    player.hasSystem = true;
    player.level = Math.max(1, Number(update.level) || 1);
    player.xp = 0;
    player.xpToNext = Math.max(1, Number(update.xpToNext) || 100);
    player.statPoints = Math.max(0, Number(update.statPoints) || 0);
    if (CORE_ATTRIBUTES.every(key => !Number(player.attributes?.[key]))) {
        player.attributes = Object.fromEntries(CORE_ATTRIBUTES.map(key => [key, 10]));
    }
}

function disablePlayerSystem(player) {
    player.hasSystem = false;
    player.level = 0;
    player.xp = 0;
    player.xpToNext = 0;
    player.statPoints = 0;
    player.attributes = Object.fromEntries(CORE_ATTRIBUTES.map(key => [key, 0]));
}

function applyPlayerUpdate(state, update = {}) {
    const player = state.player;
    const tracker = state.tracker || {};

    if (update.hasSystem === true) activatePlayerSystem(player, update);
    if (update.hasSystem === false) disablePlayerSystem(player);

    for (const key of ['name', 'title', 'className', 'currency', 'currentLocation', 'homeLocation', 'homeDescription', 'condition']) {
        if (update[key] !== undefined && update[key] !== null && String(update[key]).trim() !== '') {
            player[key] = String(update[key]);
        }
    }

    if (player.hasSystem) {
        const oldLevel = Math.max(1, Number(player.level) || 1);
        if (update.level !== undefined && update.level !== null && update.level !== '') {
            const newLevel = Math.max(1, Number(update.level) || oldLevel);
            if (newLevel > oldLevel) {
                player.statPoints += (newLevel - oldLevel) * Math.max(0, Number(player.statPointsPerLevel) || 5);
            }
            player.level = newLevel;
        }

        if (update.xpToNext !== undefined && update.xpToNext !== null && update.xpToNext !== '') {
            player.xpToNext = Math.max(1, Number(update.xpToNext) || player.xpToNext || 100);
        }
        if (update.xp !== undefined && update.xp !== null && update.xp !== '') {
            player.xp = Math.max(0, Number(update.xp) || 0);
        } else if (update.xpDelta !== undefined && update.xpDelta !== null && update.xpDelta !== '') {
            player.xp = Math.max(0, (Number(player.xp) || 0) + (Number(update.xpDelta) || 0));
        }

        if (update.statPoints !== undefined && update.statPoints !== null && update.statPoints !== '') {
            player.statPoints = Math.max(0, Number(update.statPoints) || 0);
        } else if (update.statPointsDelta !== undefined && update.statPointsDelta !== null && update.statPointsDelta !== '') {
            player.statPoints = Math.max(0, (Number(player.statPoints) || 0) + (Number(update.statPointsDelta) || 0));
        }

        applyAttributePatch(player, update.attributes || {});
    } else {
        player.level = 0;
        player.xp = 0;
        player.xpToNext = 0;
        player.statPoints = 0;
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
            if (raw.max !== undefined && raw.max !== null && raw.max !== '') stat.max = Math.max(1, Number(raw.max) || stat.max || 100);
            if (raw.unit !== undefined && raw.unit !== null) stat.unit = String(raw.unit);
            if (raw.value !== undefined && raw.value !== null && raw.value !== '') stat.value = Number(raw.value) || 0;
            else if (raw.delta !== undefined && raw.delta !== null && raw.delta !== '') stat.value = (Number(stat.value) || 0) + (Number(raw.delta) || 0);
            if (Number.isFinite(Number(stat.max)) && Number(stat.max) > 0) {
                stat.value = Math.max(0, Math.min(Number(stat.value) || 0, Number(stat.max)));
            }
        }
    }

    if (tracker.trackInventory !== false) {
        for (const raw of update.storageLocationsAdd || []) ensureStorage(player, raw);

        for (const raw of update.inventoryAdd || []) {
            if (!raw?.name) continue;

            let locationType = ['person', 'clothing', 'stored'].includes(raw.locationType) ? raw.locationType : 'person';
            let storageId = '';

            if (locationType === 'stored') {
                let storage = findStorage(player, raw.storageId || raw.storageName || '');
                if (!storage && raw.storageName && raw.createStorage === true) {
                    storage = ensureStorage(player, {
                        name: raw.storageName,
                        capacity: raw.storageCapacity || player.inventoryLimits.defaultStorage,
                        systemOnly: Boolean(raw.systemOnly),
                    });
                }
                if (!storage) locationType = 'person';
                else storageId = storage.id;
            }

            let item = findItem(player, raw.name, locationType, storageId);
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
                    locationType,
                    storageId,
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

            if (['person', 'clothing', 'stored'].includes(raw.locationType)) {
                item.locationType = raw.locationType;
                item.storageId = '';
                if (raw.locationType === 'stored') {
                    const storage = findStorage(player, raw.storageId || raw.storageName || '');
                    if (storage) item.storageId = storage.id;
                    else item.locationType = 'person';
                }
            }
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

        for (const title of update.titlesAdd || []) {
            const clean = String(title || '').trim();
            if (clean && !player.titles.some(x => normalizeName(x) === normalizeName(clean))) player.titles.push(clean);
        }
    }

    if (!player.currentLocation && state.scene?.location) player.currentLocation = state.scene.location;
}

function findQuest(state, raw) {
    if (raw?.id) {
        const exact = state.quests.find(q => q.id === raw.id);
        if (exact) return exact;
    }
    const needle = normalizeName(raw?.title || '');
    return state.quests.find(q => normalizeName(q.title) === needle) || null;
}

function applyQuestUpdates(state, payload) {
    if (state.tracker.trackQuests === false) return;

    for (const raw of payload.questsAdd || []) {
        if (!raw?.title) continue;
        if (String(raw.type || '').toLowerCase() === 'system' && !state.player.hasSystem) continue;
        let quest = findQuest(state, raw);
        if (!quest) {
            quest = {
                id: uid('quest'),
                title: String(raw.title),
                type: String(raw.type || 'story'),
                status: ['active', 'completed', 'failed', 'hidden'].includes(raw.status) ? raw.status : 'active',
                description: String(raw.description || ''),
                objectives: Array.isArray(raw.objectives)
                    ? raw.objectives.map(obj => ({
                        id: uid('objective'),
                        text: String(obj?.text || obj || ''),
                        complete: Boolean(obj?.complete),
                    })).filter(obj => obj.text)
                    : [],
                reward: String(raw.reward || ''),
                source: String(raw.source || ''),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            state.quests.push(quest);
        }
    }

    for (const raw of payload.questsUpdate || []) {
        const quest = findQuest(state, raw);
        if (!quest) continue;
        if (raw.status && ['active', 'completed', 'failed', 'hidden'].includes(raw.status)) quest.status = raw.status;
        if (raw.description !== undefined && raw.description !== '') quest.description = String(raw.description);
        if (raw.reward !== undefined && raw.reward !== '') quest.reward = String(raw.reward);
        if (raw.source !== undefined && raw.source !== '') quest.source = String(raw.source);

        if (Array.isArray(raw.objectives)) {
            for (const obj of raw.objectives) {
                if (!obj?.text) continue;
                const existing = quest.objectives.find(x => normalizeName(x.text) === normalizeName(obj.text));
                if (existing) {
                    if (obj.complete !== undefined) existing.complete = Boolean(obj.complete);
                } else {
                    quest.objectives.push({ id: uid('objective'), text: String(obj.text), complete: Boolean(obj.complete) });
                }
            }
        }
        quest.updatedAt = new Date().toISOString();
    }
}

function applyEvents(state, payload) {
    if (state.tracker.trackEvents === false) return;
    for (const raw of payload.eventsAdd || []) {
        if (!raw?.title && !raw?.description) continue;
        const title = String(raw.title || 'Event');
        const description = String(raw.description || '');
        const recentDuplicate = state.events.slice(-10).some(event =>
            normalizeName(event.title) === normalizeName(title)
            && normalizeName(event.description) === normalizeName(description));
        if (recentDuplicate) continue;

        state.events.push({
            id: uid('event'),
            type: String(raw.type || 'story'),
            title,
            description,
            location: String(raw.location || state.scene?.location || ''),
            participants: Array.isArray(raw.participants) ? raw.participants.filter(Boolean).map(String) : [],
            importance: ['minor', 'normal', 'major', 'critical'].includes(raw.importance) ? raw.importance : 'normal',
            createdAt: new Date().toISOString(),
        });
    }
    state.events = state.events.slice(-100);
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

    applyQuestUpdates(state, payload);
    applyEvents(state, payload);

    for (const raw of payload.newCharacters || []) {
        if (!raw?.name) continue;
        let character = resolveFromRaw(state, raw);
        if (!character) character = createFromRaw(state, raw);
        if (character) {
            mergePersistent(character, raw);
            mergeScene(character, raw);
            mergeNpcVitals(character, raw, state.tracker.trackNpcVitals !== false);
            mergeNpcSystem(character, raw);
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
        mergeNpcVitals(character, update, state.tracker.trackNpcVitals !== false);
        mergeNpcSystem(character, update);
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
