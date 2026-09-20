import { applyTrackerPayload } from './tracker.js';
import { getState } from './store.js';
import { getContext, toast } from './utils.js';

let lastProcessedKey = '';
let pendingTimer = null;
let running = false;

function emitStatus(status, message = '') {
    window.dispatchEvent(new CustomEvent('npcb:tracker-status', {
        detail: { status, message, at: Date.now() },
    }));
}

function extractText(response) {
    if (!response) return '';
    if (typeof response === 'string') return response;
    if (Array.isArray(response)) {
        const text = response
            .filter(x => x && x.type === 'text' && typeof x.text === 'string')
            .map(x => x.text)
            .join('\n');
        return text || JSON.stringify(response);
    }
    if (typeof response.content === 'string') return response.content;
    if (Array.isArray(response.content)) {
        const text = response.content
            .filter(x => x && x.type === 'text' && typeof x.text === 'string')
            .map(x => x.text)
            .join('\n');
        if (text) return text;
    }
    const choice = response.choices?.[0]?.message?.content;
    if (typeof choice === 'string') return choice;
    if (typeof response.text === 'string') return response.text;
    if (typeof response.message === 'string') return response.message;
    return JSON.stringify(response);
}

function parseJsonObject(text) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('Tracker returned an empty response.');

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const source = fenced?.[1]?.trim() || raw;
    try {
        return JSON.parse(source);
    } catch {
        const start = source.indexOf('{');
        const end = source.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
        throw new Error('Tracker response did not contain valid JSON.');
    }
}

function cleanMessage(message) {
    return String(message?.mes ?? message?.message ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function makeMessageKey(ctx, message, index) {
    const swipe = message?.swipe_id ?? 0;
    const text = cleanMessage(message);
    return `${ctx.getCurrentChatId?.() ?? ''}:${index}:${swipe}:${text.length}:${text.slice(-80)}`;
}

function summarizeRoster(state) {
    return state.order.map(id => state.characters[id]).filter(Boolean).map(c => {
        const profileMissing = ['age','gender','appearance','personality','background','goals','secrets']
            .filter(key => !String(c.profile?.[key] || '').trim());
        const active = ['present', 'nearby'].includes(c.status);

        const row = {
            name: c.name,
            aliases: (c.aliases || []).slice(0, 5),
            role: c.role || '',
            faction: c.faction || '',
            status: c.status,
            rel: c.relationship?.value ?? 0,
            profileMissing,
        };

        if (profileMissing.length && c.lore?.content) {
            row.loreHint = String(c.lore.content).replace(/\s+/g, ' ').trim().slice(0, 320);
        }

        if (active) {
            row.vitals = c.vitals || {};
            row.mind = {
                personality: String(c.profile?.personality || '').slice(0, 180),
                goals: String(c.profile?.goals || '').slice(0, 140),
                mood: String(c.scene?.mood || '').slice(0, 80),
                relationship: String(c.relationship?.label || '').slice(0, 80),
            };
            row.visual = {
                age: String(c.profile?.age || '').slice(0, 60),
                gender: String(c.profile?.gender || '').slice(0, 60),
                appearance: String(c.profile?.appearance || '').slice(0, 220),
                clothing: String(c.scene?.clothing || '').slice(0, 180),
                condition: String(c.scene?.condition || '').slice(0, 120),
            };
            row.system = c.system?.hasSystem ? {
                hasSystem: true,
                level: c.system.level,
                xp: c.system.xp,
                xpToNext: c.system.xpToNext,
                attributes: c.system.attributes,
            } : { hasSystem: false };
        } else if (c.system?.hasSystem) {
            row.system = { hasSystem: true, level: c.system.level };
        }

        return row;
    });
}

function buildPrompt(ctx, state, latestIndex) {
    const depth = Math.max(2, Math.min(20, Number(state.tracker?.contextDepth || 6)));
    const history = ctx.chat
        .slice(Math.max(0, latestIndex - depth + 1), latestIndex + 1)
        .filter(m => m && !m.is_system)
        .map(m => ({
            speaker: m.is_user ? (ctx.name1 || '{{user}}') : (m.name || ctx.name2 || 'Assistant'),
            role: m.is_user ? 'user' : 'assistant',
            text: cleanMessage(m),
        }))
        .filter(m => m.text);

    const p = state.player || {};
    const playerSummary = {
        name: p.name || ctx.name1 || '{{user}}',
        title: p.title || '',
        className: p.className || '',
        hasSystem: Boolean(p.hasSystem),
        level: p.level || 0,
        xp: p.xp || 0,
        xpToNext: p.xpToNext || 0,
        statPoints: p.statPoints || 0,
        attributes: p.attributes || {},
        funds: p.funds || {
            system: { amount: 0, currency: 'Gold' },
            real: { amount: 0, currency: '' },
        },
        currentLocation: p.currentLocation || '',
        homeLocation: p.homeLocation || '',
        stats: (p.stats || []).map(stat => ({
            name: stat.name,
            value: stat.value,
            max: stat.max,
            unit: stat.unit,
            aiTrack: stat.aiTrack !== false,
        })),
        inventoryLimits: p.inventoryLimits || {},
        storageLocations: (p.storageLocations || []).map(storage => ({
            id: storage.id,
            name: storage.name,
            capacity: storage.capacity,
            type: storage.type,
            systemOnly: storage.systemOnly,
        })),
        inventory: (p.inventory || []).map(item => ({
            name: item.name,
            quantity: item.quantity,
            type: item.type,
            equipped: item.equipped,
            locationType: item.locationType,
            storageId: item.storageId,
        })),
        skills: (p.skills || []).map(skill => ({
            name: skill.name,
            rank: skill.rank,
            type: skill.type,
            description: skill.description,
            cooldown: skill.cooldown,
            remainingCooldown: skill.remainingCooldown,
            cost: skill.cost,
            requirements: skill.requirements,
            modifiers: skill.modifiers,
            effects: skill.effects,
        })),
        effects: (p.effects || []).map(effect => ({
            name: effect.name,
            description: effect.description,
            duration: effect.duration,
            source: effect.source,
            harmful: effect.harmful,
            modifiers: effect.modifiers,
        })),
        resistances: (p.resistances || []).map(resistance => ({
            name: resistance.name,
            value: resistance.value,
            description: resistance.description,
            aiTrack: resistance.aiTrack !== false,
        })),
        titles: (p.titles || []).map(title => ({
            name: title.name,
            equipped: title.id === p.equippedTitleId || title.equipped,
            description: title.description,
            effects: title.effects,
            modifiers: title.modifiers,
        })),
    };

    const questSummary = (state.quests || []).map(q => ({
        title: q.title,
        type: q.type,
        status: q.status,
        description: q.description,
        objectives: q.objectives,
        reward: q.reward,
        source: q.source,
        conditions: q.conditions,
        conditionsMet: Boolean(q.conditionsMet),
    }));

    const recentEvents = (state.events || []).slice(-12).map(e => ({
        type: e.type,
        title: e.title,
        description: e.description,
        location: e.location,
        importance: e.importance,
        status: e.status,
        trigger: e.trigger,
        triggerMet: Boolean(e.triggerMet),
    }));

    const system = `You are a silent RPG state extractor for SillyTavern.
Read the recent roleplay and update the persistent System HUD.
Return ONLY one JSON object. No markdown, no prose outside JSON, no invented facts.

PLAYER SYSTEM RULE:
- The player's System is a story fact, not an always-on mechanic.
- If the player does NOT currently have a System, hasSystem is false, level MUST remain 0, XP MUST remain 0, XP cannot be gained, and STR/DEX/INT/STA/SEN must not be assigned.
- Set playerUpdates.hasSystem=true ONLY if the newest roleplay explicitly grants, awakens, activates, or visibly opens a PERSONAL System/status interface for the player.
- Mentions of "system", quests, ranks, hunters, game-like language, magic, stats belonging to OTHER characters, or this extension's tracker UI are NOT enough.
- If the existing player state says hasSystem=false, preserve false unless that explicit acquisition happens in the newest RP.
- Set hasSystem=false only if the story explicitly removes/destroys/disables that acquired interface.
- When a System user levels up, return the new level. The extension grants allocatable stat points automatically.
- Only output attribute changes when the story/System explicitly changes STR, DEX, INT, STA, or SEN. Do not invent stat growth.

Schema:
{
  "scene": {
    "location": "",
    "time": "",
    "date": "",
    "day": "",
    "dayPart": "",
    "weather": "",
    "season": "",
    "year": "",
    "holiday": "",
    "summary": ""
  },

  "playerUpdates": {
    "hasSystem": "",
    "name": "",
    "title": "",
    "className": "",
    "level": "",
    "xp": "",
    "xpDelta": "",
    "xpToNext": "",
    "statPoints": "",
    "statPointsDelta": "",
    "attributes": {
      "STR": "",
      "DEX": "",
      "INT": "",
      "STA": "",
      "SEN": ""
    },
    "systemFunds": {
      "amount": "",
      "delta": "",
      "currency": "Gold"
    },
    "realFunds": {
      "amount": "",
      "delta": "",
      "currency": ""
    },
    "currentLocation": "",
    "homeLocation": "",
    "homeDescription": "",
    "condition": "",

    "statUpdates": [
      { "name": "Health", "value": "", "delta": "", "max": "", "unit": "" }
    ],
    "resistanceUpdates": [
      { "name": "Fire", "value": "", "delta": "", "description": "" }
    ],

    "storageLocationsAdd": [
      {
        "name": "Player Apartment",
        "capacity": 30,
        "type": "home",
        "systemOnly": false,
        "description": ""
      }
    ],

    "inventoryAdd": [
      {
        "name": "",
        "quantity": 1,
        "type": "",
        "description": "",
        "equipped": false,
        "value": "",
        "locationType": "person | clothing | stored",
        "storageName": "",
        "storageId": "",
        "createStorage": false,
        "storageCapacity": "",
        "systemOnly": false
      }
    ],
    "inventoryRemove": [
      { "name": "", "quantity": 1 }
    ],
    "inventoryUpdate": [
      {
        "name": "",
        "quantity": "",
        "type": "",
        "description": "",
        "equipped": "",
        "value": "",
        "locationType": "",
        "storageName": "",
        "storageId": ""
      }
    ],

    "skillsAdd": [
      {
        "name": "",
        "rank": "",
        "type": "active | passive | toggle",
        "description": "",
        "source": "",
        "cooldown": "",
        "remainingCooldown": "",
        "cost": { "resource": "Mana | Stamina | Health | other", "amount": "" },
        "requirements": {
          "text": "",
          "attributes": { "STR": "", "DEX": "", "INT": "", "STA": "", "SEN": "" }
        },
        "modifiers": { "STR": "", "DEX": "", "INT": "", "STA": "", "SEN": "" },
        "effects": []
      }
    ],
    "skillsUpdate": [
      {
        "name": "",
        "rank": "",
        "description": "",
        "cooldown": "",
        "remainingCooldown": "",
        "cost": { "resource": "", "amount": "" },
        "requirements": { "text": "", "attributes": {} },
        "modifiers": {},
        "effects": []
      }
    ],
    "effectsAdd": [
      {
        "name": "",
        "description": "",
        "duration": "",
        "source": "",
        "harmful": false,
        "modifiers": { "STR": "", "DEX": "", "INT": "", "STA": "", "SEN": "" }
      }
    ],
    "effectsUpdate": [
      { "name": "", "description": "", "duration": "", "source": "", "harmful": "" }
    ],
    "effectsRemove": [],
    "titlesAdd": [
      {
        "name": "",
        "equipped": false,
        "description": "",
        "effects": [],
        "modifiers": { "STR": "", "DEX": "", "INT": "", "STA": "", "SEN": "" }
      }
    ],
    "titlesUpdate": [
      {
        "name": "",
        "equipped": "",
        "description": "",
        "effects": [],
        "modifiers": { "STR": "", "DEX": "", "INT": "", "STA": "", "SEN": "" }
      }
    ]
  },

  "questsAdd": [
    {
      "title": "",
      "type": "main | side | system",
      "status": "active",
      "description": "",
      "objectives": [
        { "text": "", "complete": false }
      ],
      "reward": "",
      "source": "",
      "conditions": {
        "time": "",
        "date": "",
        "day": "",
        "dayPart": "",
        "weather": "",
        "season": "",
        "year": "",
        "holiday": ""
      }
    }
  ],

  "questsUpdate": [
    {
      "title": "",
      "status": "active | completed | failed | hidden",
      "description": "",
      "objectives": [
        { "text": "", "complete": true }
      ],
      "reward": "",
      "source": "",
      "conditions": {
        "time": "",
        "date": "",
        "day": "",
        "dayPart": "",
        "weather": "",
        "season": "",
        "year": "",
        "holiday": ""
      }
    }
  ],

  "eventsAdd": [
    {
      "type": "combat | discovery | social | travel | quest | system | acquisition | story",
      "title": "",
      "description": "",
      "location": "",
      "participants": [],
      "importance": "minor | normal | major | critical",
      "status": "pending | occurred | cancelled",
      "trigger": {
        "time": "",
        "date": "",
        "day": "",
        "dayPart": "",
        "weather": "",
        "season": "",
        "year": "",
        "holiday": ""
      }
    }
  ],

  "eventsUpdate": [
    {
      "title": "",
      "status": "pending | occurred | cancelled",
      "description": "",
      "location": "",
      "participants": [],
      "importance": "",
      "trigger": {
        "time": "",
        "date": "",
        "day": "",
        "dayPart": "",
        "weather": "",
        "season": "",
        "year": "",
        "holiday": ""
      }
    }
  ],

  "presentCharacters": [],

  "newCharacters": [
    {
      "name": "",
      "aliases": [],
      "role": "",
      "faction": "",
      "age": "",
      "gender": "",
      "appearance": "",
      "personality": "",
      "background": "",
      "relationship": "",
      "relationshipValue": "",
      "location": "",
      "mood": "",
      "action": "",
      "condition": "",
      "hp": "",
      "maxHp": "",
      "mana": "",
      "maxMana": "",
      "manaRelative": "",
      "fatigue": "",
      "maxFatigue": "",
      "hasSystem": false,
      "level": "",
      "xp": "",
      "xpToNext": "",
      "attributes": {
        "STR": "",
        "DEX": "",
        "INT": "",
        "STA": "",
        "SEN": ""
      },
      "systemStats": []
    }
  ],

  "characterUpdates": [
    {
      "name": "",
      "aliases": [],
      "role": "",
      "faction": "",
      "relationship": "",
      "relationshipValue": "",
      "location": "",
      "mood": "",
      "action": "",
      "condition": "",
      "clothing": "",
      "thoughts": "",
      "profile": {
        "age": "",
        "gender": "",
        "appearance": "",
        "personality": "",
        "background": "",
        "goals": "",
        "secrets": ""
      },

      "hp": "",
      "hpDelta": "",
      "maxHp": "",
      "mana": "",
      "manaDelta": "",
      "maxMana": "",
      "manaRelative": "",
      "fatigue": "",
      "fatigueDelta": "",
      "maxFatigue": "",

      "hasSystem": "",
      "level": "",
      "xp": "",
      "xpDelta": "",
      "xpToNext": "",
      "attributes": {
        "STR": "",
        "DEX": "",
        "INT": "",
        "STA": "",
        "SEN": ""
      },
      "systemStats": [
        { "name": "", "value": "", "delta": "", "max": "", "unit": "" }
      ]
    }
  ]
}

GENERAL PLAYER RULES:
- Track the user's persona separately. Never create the user as an NPC.
- Only change player level, XP, funds, items, skills, titles, System status, attributes, effects, or stats when the newest roleplay clearly establishes a change.
- Prefer delta fields when only a gain/loss is known.
- systemFunds are System-only currency (normally Gold unless the story says otherwise) and must stay at 0 while the player has no System.
- realFunds are ordinary in-world money. Infer the currency ONLY when the story/setting clearly establishes it (for example KRW in modern Korea, USD when explicitly used, etc.). Do not guess from the user's real location.
- Never invent loot, XP, funds, skills, stat increases, or quest rewards merely because combat happened.
- When a skill is used, update its remainingCooldown and explicit resource cost consequences when established.
- Track temporary status effects/buffs/debuffs in effectsAdd/effectsUpdate/effectsRemove. Keep descriptions compact and gameplay-relevant.
- Vital/custom stat value/max fields MUST be JSON numbers, never strings such as "85%" or "one hundred". Put units separately.
- resistanceUpdates are percentage resistances/vulnerabilities from -100 to 100. Positive = resistance, negative = vulnerability. Only change them from explicit/established mechanics.
- Titles are collectable gameplay objects. Track description/effects/modifiers when established; only equip/unequip a title when the story/System or user clearly chooses it.
- Existing inventory quantities and storage locations are authoritative unless the roleplay changes them.

MAGIC / MANA RULES:
- A character who clearly uses spellcasting, mana, MP, magical energy, or a magic skill should have a Mana pool even without a System.
- If canonical numeric Mana/MP values are established, use those exact values.
- If magic ability is clearly established but no numeric pool exists, initialize a RELATIVE pool at 100/100 with manaRelative=true. This is an abstract reserve percentage, not a claim about canon MP.
- For relative Mana, update conservatively from narration: light use about -5, moderate use about -10 to -20, heavy/ultimate use about -25 to -40; minor rest/recovery about +10, meaningful rest about +20 to +30, full recovery only when clearly stated. Never go below 0 or above 100.
- Apply the same concept to the player by creating/updating a numeric Mana custom stat with max 100 and unit "%" when the player clearly uses magic but the setting gives no canonical MP scale.
- If a known skill already has an explicit Mana cost, use that cost instead of estimating.
- Mana may recover naturally only when the RP establishes rest, recovery, regeneration, a skill/item, or sufficient time passage.

SKILL / STATUS RULES:
- Skills are gameplay state, not decorative labels. Keep description, cost, cooldown, requirements and effects when the story establishes them.
- If the newest reply shows a known tracked skill being used, apply its ALREADY-KNOWN cost and base cooldown even if the narration does not repeat those numbers. Do not charge twice.
- When a known cooldown is turn-based, reduce remainingCooldown as relevant RP turns/actions pass; for time-based cooldowns, update only when enough in-story time clearly passes.
- If a known skill has an explicit numeric tracked effect (for example restores 15 Health or spends 20 Mana), apply that known effect through statUpdates when the skill successfully takes effect. Do not infer numbers from vague prose.
- If a known skill produces a tracked buff/debuff/status effect, reflect it with effectsAdd/effectsUpdate when the use actually applies that effect.
- If an active status effect has an explicit per-turn/per-time resource change and the newest RP clearly advances that interval, apply the known change through statUpdates.
- Passive skill modifiers belong in modifiers; temporary buffs/debuffs belong in player effects.
- Do not invent exact numeric costs/cooldowns/stat requirements when the tracked skill and RP do not establish them. Text requirements are allowed when clear.

INVENTORY LOCATION RULES:
- locationType="person": item is carried on the user's person/bag/pockets.
- locationType="clothing": item is currently worn as clothing/armor/accessory.
- locationType="stored": item is not carried and belongs to a named storage location.
- Only create storageLocationsAdd when the story clearly establishes a usable storage place: apartment, house, locker, guild storage, vehicle trunk, vault, System inventory, etc.
- A System inventory/storage may only exist if the player has a System or the newest reply grants one.
- Do not silently teleport items between storage categories.
- Capacity is a tracking limitation, not permission to invent extra storage.

SCENE SUMMARY RULE:
- scene.summary should be refreshed after every assistant RP reply with ONE compact continuity sentence, ideally under 18 words.
- Summarize the current situation, not prose style or dialogue.

WORLD TIME / WEATHER RULES:
- Track in-world time only from story evidence. Do not use the real user's current date/time.
- Keep the last known RP time/date/weather when the newest reply does not change it.
- time is CLOCK TIME only (for example 10:31, 23:40, around 6 PM). Never put weekday/month/year text into time.
- day is a weekday/day label such as Friday or Day 12. date is the calendar date/month/year such as 25 December 2026 or October 2024.
- If only "Friday, October 2024" is known, use day="Friday" and date="October 2024".
- TIME SHOULD NOT DISAPPEAR merely because the story gives only a daypart. When no exact clock is given but a clear daypart is established, use an approximate clock and prefix it with "~": dawn ~06:00, morning ~09:00, noon ~12:00, afternoon ~15:00, evening ~19:00, night ~22:00, late night ~01:00.
- If a known clock exists and the RP says time passed ("two hours later", "after thirty minutes"), calculate the new story clock.
- Preserve the last known clock when the newest reply does not move time.
- dayPart should be a compact value such as dawn, morning, afternoon, evening, night, late night.
- weather should be short and story-grounded: clear, rain, snow, storm, fog, etc.
- season/year/holiday are optional and only set when established. Holiday may be values such as Christmas, New Year, Lunar New Year, festival names, or fictional holidays.
- If a quest has an explicit time/weather/season/date/holiday requirement, put it in conditions.
- A future event may be tracked as status="pending" with trigger fields. Do not say it occurred until the story actually narrates it.

QUEST RULES:
- Automatically create/update quests from the RP when a durable goal is established: mission, contract, rescue, investigation, promise, survival objective, hunt, delivery, training goal, major personal objective, or explicit System quest.
- Classify central plot-driving objectives as main, optional/parallel/personal objectives as side, and System-issued objectives as system.
- Main and Side quests are allowed without a System. System quests require an actually acquired System.
- Do not output a "story" quest category. If an objective is durable enough to track but is not central, classify it as side.
- Do not create a quest for every casual action, ordinary conversation, or momentary combat move.
- Merge with an existing matching quest instead of creating duplicates.
- Update objectives, rewards, conditions, completion and failure automatically when the newest RP establishes progress.

EVENT RULES:
- Treat the event log as compact continuity memory. After EVERY assistant RP reply that advances the scene, add 1–2 short durable events. Return 0 only when literally no new action, fact, consequence, movement, decision, or relationship/quest/state change occurred.
- Good events include: combat starts/ends or a meaningful hit/injury, arrival/departure, discovery, item/fund/skill acquisition, relationship turning point, promise/agreement, quest progress, System notification, important decision, weather/time-triggered development, or a new threat.
- Event title should be 2–6 words. Description should be ONE short sentence, ideally under 18 words.
- Do not log filler such as breathing, looking around, greetings, or repeated combat motions unless they change the situation.
- Avoid duplicating an event already present in recent events.
- If a pending event already exists and the newest story makes it occur or cancel, use eventsUpdate instead of adding a duplicate.

NPC RULES:
- All recurring/distinct NPCs may track HP, Mana, fatigue, relationship, condition, location, mood, action, and a CURRENT inner thought.
- HP/Mana/Fatigue values should only change when narration makes a change clear. If exact numbers are not available, use delta only when magnitude is clearly implied; otherwise leave blank.
- For each present/nearby named NPC, thoughts may contain ONE brief in-character inner thought about the CURRENT situation, inferred conservatively from established personality, goals, relationship, and what they know. This is ephemeral UI flavor, not canon memory.
- Never use thoughts to reveal secrets the NPC could not reasonably think about in this moment, omniscient facts, or information they do not know.
- relationshipValue is -100 to 100 and should change conservatively.
- You MAY set an NPC's hasSystem=true automatically when the newest roleplay clearly establishes that NPC has/awakens/uses a System, status window, RPG stat interface, or equivalent mechanic. This is not limited to manual user toggles.
- You MAY set hasSystem=false only when the story clearly removes/disables that mechanic.
- NPC detailed level/XP/STR/DEX/INT/STA/SEN/custom System stats are ONLY allowed when that NPC explicitly has a System or equivalent stat interface.
- If NPC hasSystem=false, do not assign detailed RPG attributes/level/XP.
- presentCharacters means NPCs present NOW in the newest assistant reply, not merely mentioned.
- Do not create entries for anonymous crowds/generic guards unless the story treats one as a distinct recurring character.
- Match aliases/titles/translations to existing NPC identities.
- Keep NPC identity/profile facts current. Fill missing age/gender/appearance/personality/background/goals/secrets from supported RP or Lore hints.
- Even when a profile field is already filled, update it when the newest RP explicitly reveals a new persistent fact or corrects an old one (for example age, hair/eye traits, scars, species, build, identity, faction, role).
- Current clothing is LIVE state: replace scene.clothing whenever the outfit/armor/accessories materially change. Do not append old outfits forever.
- Keep persistent appearance separate from temporary clothing/condition. Blood, dirt, wounds and temporary disguises belong in condition/clothing unless they become lasting traits.
- Keep profile patches tiny: age/gender as short values; appearance/personality/background/goals/secrets each at most one compact sentence. Do not write prose biographies.
- Do not repeat already-known profile text in every response.
- Use empty strings/arrays for unchanged or unknown data. Never guess.`;

    return [
        { role: 'system', content: system },
        {
            role: 'user',
            content: `Existing RP world state:\n${JSON.stringify(state.scene || {})}
\nExisting player state:\n${JSON.stringify(playerSummary)}
\nExisting quests:\n${JSON.stringify(questSummary)}
\nRecent tracked events:\n${JSON.stringify(recentEvents)}
\nExisting NPC roster:\n${JSON.stringify(summarizeRoster(state))}
\nRecent roleplay:\n${JSON.stringify(history)}
\nExtract ONLY changes established by the newest assistant reply.`,
        },
    ];
}

export async function scanLatestRoleplay({ force = false, manual = false } = {}) {
    const ctx = getContext();
    const state = getState();

    if (!manual && state.tracker?.autoRead === false) return null;
    if (running) return null;
    if (!Array.isArray(ctx.chat) || !ctx.chat.length) return null;

    let latestIndex = -1;
    for (let i = ctx.chat.length - 1; i >= 0; i--) {
        const msg = ctx.chat[i];
        if (msg && !msg.is_user && !msg.is_system && cleanMessage(msg)) {
            latestIndex = i;
            break;
        }
    }
    if (latestIndex < 0) return null;

    const message = ctx.chat[latestIndex];
    const key = makeMessageKey(ctx, message, latestIndex);
    if (!force && key === lastProcessedKey) return null;

    if (typeof ctx.generateRaw !== 'function') {
        const error = new Error('This SillyTavern build does not expose generateRaw through getContext().');
        emitStatus('error', error.message);
        if (manual) toast('error', error.message);
        throw error;
    }

    running = true;
    emitStatus('scanning', 'Reading latest roleplay…');

    try {
        const prompt = buildPrompt(ctx, state, latestIndex);
        const response = await ctx.generateRaw({ prompt, quietToLoud: false });
        const parsed = parseJsonObject(extractText(response));

        await applyTrackerPayload({
            scene: parsed.scene || {},
            playerUpdates: parsed.playerUpdates && typeof parsed.playerUpdates === 'object' ? parsed.playerUpdates : {},
            questsAdd: Array.isArray(parsed.questsAdd) ? parsed.questsAdd : [],
            questsUpdate: Array.isArray(parsed.questsUpdate) ? parsed.questsUpdate : [],
            eventsAdd: Array.isArray(parsed.eventsAdd) ? parsed.eventsAdd : [],
            eventsUpdate: Array.isArray(parsed.eventsUpdate) ? parsed.eventsUpdate : [],
            presentCharacters: Array.isArray(parsed.presentCharacters) ? parsed.presentCharacters : [],
            replacePresent: true,
            newCharacters: Array.isArray(parsed.newCharacters) ? parsed.newCharacters : [],
            characterUpdates: Array.isArray(parsed.characterUpdates) ? parsed.characterUpdates : [],
        });

        lastProcessedKey = key;
        emitStatus('ready', 'Latest roleplay scanned.');
        if (manual) toast('success', 'Character tracker updated from the latest roleplay.');
        return parsed;
    } catch (error) {
        console.error('[NPC Character Bar] Auto tracker failed:', error);
        emitStatus('error', error?.message || 'Tracker scan failed.');
        if (manual) toast('error', error?.message || 'Tracker scan failed.');
        throw error;
    } finally {
        running = false;
    }
}

export function scheduleAutoTrack(delay = 450) {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
        scanLatestRoleplay().catch(() => {});
    }, delay);
}

export function resetAutoTrackerSession() {
    lastProcessedKey = '';
    clearTimeout(pendingTimer);
    pendingTimer = null;
    running = false;
    emitStatus('idle', 'Waiting for roleplay.');
}
