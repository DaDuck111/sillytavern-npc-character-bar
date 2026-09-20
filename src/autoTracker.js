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

    const system = `You are a silent RPG character-state extractor for SillyTavern.
Read the recent roleplay and update a persistent character roster.
Return ONLY one JSON object. Do not roleplay, explain, use markdown, or invent facts.

Schema:
{
  "scene": {
    "location": "current scene location if known, otherwise empty string",
    "time": "current in-world time/date if explicitly known, otherwise empty string",
    "summary": "one short sentence describing the immediate scene"
  },
  "presentCharacters": ["names of characters physically or conversationally present NOW"],
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
      "name": "existing or observed character name",
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

Rules:
- presentCharacters means present in the newest assistant roleplay reply, not merely mentioned in history.
- If a named or clearly distinct recurring NPC appears and is not in the existing roster, include them in newCharacters.
- Do NOT create entries for anonymous crowds, generic soldiers/guards, or throwaway labels unless the roleplay clearly treats that individual as a distinct character.
- Match titles, nicknames, translated names, and parenthetical variants to an existing character when they are obviously the same person. Put the observed variant into aliases.
- Never duplicate an existing character just because spelling/casing/title changed.
- Do not overwrite permanent biography with temporary mood/action.
- Only state thoughts when the narration explicitly reveals them.
- Do not include the user's persona as a new NPC unless the roleplay clearly treats that persona as a separately tracked named character.
- Use empty strings when information is unknown. Do not guess.`;

    return [
        { role: 'system', content: system },
        {
            role: 'user',
            content: `Existing roster:\n${JSON.stringify(summarizeRoster(state), null, 2)}\n\nRecent roleplay:\n${JSON.stringify(history, null, 2)}\n\nExtract the current character state from the newest assistant reply.`,
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
