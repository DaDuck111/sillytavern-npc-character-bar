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
        money: p.money || 0,
        currency: p.currency || 'Gold',
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
        })),
        titles: p.titles || [],
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
- Set playerUpdates.hasSystem=true ONLY if the newest roleplay clearly grants/awakens/activates a System or equivalent RPG status interface for the player.
- Set hasSystem=false only if the story explicitly removes/destroys/disables that System.
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
    "money": "",
    "moneyDelta": "",
    "currency": "",
    "currentLocation": "",
    "homeLocation": "",
    "homeDescription": "",
    "condition": "",

    "statUpdates": [
      { "name": "Health", "value": "", "delta": "", "max": "", "unit": "" }
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
      { "name": "", "rank": "", "description": "", "source": "" }
    ],
    "skillsUpdate": [
      { "name": "", "rank": "", "description": "", "source": "" }
    ],
    "titlesAdd": []
  },

  "questsAdd": [
    {
      "title": "",
      "type": "story | main | side | system",
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
- Only change player level, XP, money, items, skills, titles, System status, attributes, or stats when the newest roleplay clearly establishes a change.
- Prefer delta fields when only a gain/loss is known.
- Never invent loot, XP, money, skills, stat increases, or quest rewards merely because combat happened.
- Existing inventory quantities and storage locations are authoritative unless the roleplay changes them.

INVENTORY LOCATION RULES:
- locationType="person": item is carried on the user's person/bag/pockets.
- locationType="clothing": item is currently worn as clothing/armor/accessory.
- locationType="stored": item is not carried and belongs to a named storage location.
- Only create storageLocationsAdd when the story clearly establishes a usable storage place: apartment, house, locker, guild storage, vehicle trunk, vault, System inventory, etc.
- A System inventory/storage may only exist if the player has a System or the newest reply grants one.
- Do not silently teleport items between storage categories.
- Capacity is a tracking limitation, not permission to invent extra storage.

WORLD TIME / WEATHER RULES:
- Track in-world time only from story evidence. Do not use the real user's current date/time.
- Keep the last known RP time/date/weather when the newest reply does not change it.
- dayPart should be a compact value such as dawn, morning, afternoon, evening, night, late night.
- weather should be short and story-grounded: clear, rain, snow, storm, fog, etc.
- season/year/holiday are optional and only set when established. Holiday may be values such as Christmas, New Year, Lunar New Year, festival names, or fictional holidays.
- If a quest has an explicit time/weather/season/date/holiday requirement, put it in conditions.
- A future event may be tracked as status="pending" with trigger fields. Do not say it occurred until the story actually narrates it.

QUEST RULES:
- Add a quest when the story clearly establishes a goal, assignment, contract, mission, promise, investigation, survival objective, or explicit System quest.
- Story quests are allowed even without a System.
- System quests require an actual System.
- Do not create a quest for every casual action.
- Update objective completion/status only when the newest reply establishes progress, completion, or failure.

EVENT RULES:
- Record meaningful developments useful for continuity: combat outcome, discovery, arrival/departure, major social development, acquisition, System event, quest turning point.
- Skip trivial conversational beats.
- Avoid duplicating an event already present in recent events.
- If a pending event already exists and the newest story makes it occur or cancel, use eventsUpdate instead of adding a duplicate.

NPC RULES:
- All recurring/distinct NPCs may track HP, fatigue, relationship, condition, location, mood, and action.
- HP/Fatigue values should only change when narration makes a change clear. If exact numbers are not available, use delta only when magnitude is clearly implied; otherwise leave blank.
- relationshipValue is -100 to 100 and should change conservatively.
- You MAY set an NPC's hasSystem=true automatically when the newest roleplay clearly establishes that NPC has/awakens/uses a System, status window, RPG stat interface, or equivalent mechanic. This is not limited to manual user toggles.
- You MAY set hasSystem=false only when the story clearly removes/disables that mechanic.
- NPC detailed level/XP/STR/DEX/INT/STA/SEN/custom System stats are ONLY allowed when that NPC explicitly has a System or equivalent stat interface.
- If NPC hasSystem=false, do not assign detailed RPG attributes/level/XP.
- presentCharacters means NPCs present NOW in the newest assistant reply, not merely mentioned.
- Do not create entries for anonymous crowds/generic guards unless the story treats one as a distinct recurring character.
- Match aliases/titles/translations to existing NPC identities.
- For NPC profile fields, fill ONLY facts supported by the RP and only when profileMissing says that field is missing, or the newest reply clearly corrects it.
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
