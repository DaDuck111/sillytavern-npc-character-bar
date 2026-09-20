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
    return state.order.map(id => state.characters[id]).filter(Boolean).map(c => ({
        name: c.name,
        aliases: c.aliases || [],
        role: c.role || '',
        faction: c.faction || '',
        status: c.status,
        relationship: c.relationship?.label || '',
    }));
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

    const playerSummary = {
        name: state.player?.name || ctx.name1 || '{{user}}',
        title: state.player?.title || '',
        className: state.player?.className || '',
        level: state.player?.level || 1,
        xp: state.player?.xp || 0,
        xpToNext: state.player?.xpToNext || 100,
        money: state.player?.money || 0,
        currency: state.player?.currency || 'Gold',
        currentLocation: state.player?.currentLocation || '',
        homeLocation: state.player?.homeLocation || '',
        stats: (state.player?.stats || []).map(stat => ({
            name: stat.name,
            value: stat.value,
            max: stat.max,
            unit: stat.unit,
            aiTrack: stat.aiTrack !== false,
        })),
        inventory: (state.player?.inventory || []).map(item => ({
            name: item.name,
            quantity: item.quantity,
            type: item.type,
            equipped: item.equipped,
        })),
        skills: (state.player?.skills || []).map(skill => ({
            name: skill.name,
            rank: skill.rank,
        })),
        titles: state.player?.titles || [],
    };

    const system = `You are a silent RPG state extractor for SillyTavern.
Read the recent roleplay and update BOTH the persistent NPC roster and the user's RPG state.
Return ONLY one JSON object. Do not roleplay, explain, use markdown, or invent facts.

Schema:
{
  "scene": {
    "location": "current scene location if known, otherwise empty string",
    "time": "current in-world time/date if explicitly known, otherwise empty string",
    "summary": "one short sentence describing the immediate scene"
  },
  "playerUpdates": {
    "name": "",
    "title": "",
    "className": "",
    "level": "",
    "xp": "",
    "xpDelta": "",
    "xpToNext": "",
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
    "inventoryAdd": [
      { "name": "", "quantity": 1, "type": "", "description": "", "equipped": false, "value": "" }
    ],
    "inventoryRemove": [
      { "name": "", "quantity": 1 }
    ],
    "inventoryUpdate": [
      { "name": "", "quantity": "", "type": "", "description": "", "equipped": "", "value": "" }
    ],
    "skillsAdd": [
      { "name": "", "rank": "", "description": "", "source": "" }
    ],
    "skillsUpdate": [
      { "name": "", "rank": "", "description": "", "source": "" }
    ],
    "titlesAdd": []
  },
  "presentCharacters": ["names of NPCs physically or conversationally present NOW"],
  "newCharacters": [
    {
      "name": "canonical or best observed name",
      "aliases": ["other names/titles actually used"],
      "role": "",
      "faction": "",
      "age": "",
      "gender": "",
      "appearance": "",
      "personality": "",
      "background": "",
      "relationship": "",
      "location": "",
      "mood": "",
      "action": "",
      "condition": ""
    }
  ],
  "characterUpdates": [
    {
      "name": "existing or observed NPC name",
      "aliases": [],
      "role": "",
      "faction": "",
      "relationship": "",
      "location": "",
      "mood": "",
      "action": "",
      "condition": "",
      "clothing": "",
      "thoughts": "",
      "memory": "one important durable event/fact worth remembering, or empty string"
    }
  ]
}

Player tracking rules:
- Track the user's persona separately from NPCs. Never create the user as an NPC.
- Only change player level, XP, money, items, skills, titles, or stats when the roleplay clearly establishes a change.
- Prefer delta fields when the RP describes a gain/loss but not an exact new total.
- Do not invent RPG rewards because a fight happened. A reward/level-up/skill/item must be stated or strongly and unambiguously established.
- InventoryAdd means the player actually acquired/received/kept an item. InventoryRemove means the player actually lost/used/gave away an item.
- Existing inventory quantities are authoritative unless the latest RP changes them.
- Existing custom stats are authoritative. Update only stats with aiTrack=true.
- If the RP explicitly creates a new measurable player stat, you may add it through statUpdates.
- currentLocation may follow the scene location when the player is there.
- homeLocation/homeDescription should only change when a home/base/residence is established or explicitly changed.

NPC rules:
- presentCharacters means NPCs present in the newest assistant roleplay reply, not merely mentioned in history.
- If a named or clearly distinct recurring NPC appears and is not in the existing roster, include them in newCharacters.
- Do NOT create entries for anonymous crowds, generic soldiers/guards, or throwaway labels unless the roleplay clearly treats that individual as a distinct character.
- Match titles, nicknames, translated names, and parenthetical variants to an existing character when they are obviously the same person. Put the observed variant into aliases.
- Never duplicate an existing character just because spelling/casing/title changed.
- Do not overwrite permanent biography with temporary mood/action.
- Only state thoughts when the narration explicitly reveals them.
- Use empty strings/arrays for unknown or unchanged data. Do not guess.`;

    return [
        { role: 'system', content: system },
        {
            role: 'user',
            content: `Existing player state:\n${JSON.stringify(playerSummary, null, 2)}\n\nExisting NPC roster:\n${JSON.stringify(summarizeRoster(state), null, 2)}\n\nRecent roleplay:\n${JSON.stringify(history, null, 2)}\n\nExtract only the changes established by the newest assistant reply.`,
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
