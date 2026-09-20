import { getContext } from './utils.js';

function q(value) {
    return JSON.stringify(String(value ?? ''));
}

function pipeValue(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    return String(result.pipe ?? result.newText ?? result.output ?? '');
}

async function run(command) {
    const ctx = getContext();
    if (typeof ctx.executeSlashCommandsWithOptions !== 'function') {
        throw new Error('This SillyTavern build does not expose executeSlashCommandsWithOptions().');
    }
    const result = await ctx.executeSlashCommandsWithOptions(command, {
        handleParserErrors: true,
        handleExecutionErrors: true,
    });
    return pipeValue(result).trim();
}

export function buildLoreContent(character) {
    const lines = [];
    const add = (label, value) => {
        const text = String(value || '').trim();
        if (text) lines.push(`${label}: ${text}`);
    };

    lines.push(`[NPC: ${character.name}]`);
    if (character.aliases?.length) add('Aliases', character.aliases.join(', '));
    add('Role', character.role);
    add('Faction', character.faction);
    add('Age', character.profile?.age);
    add('Gender', character.profile?.gender);
    add('Appearance', character.profile?.appearance);
    add('Personality', character.profile?.personality);
    add('Background', character.profile?.background);
    add('Goals', character.profile?.goals);
    add('Secrets', character.profile?.secrets);
    add('Relationship to {{user}}', character.relationship?.label);
    add('Relationship details', character.relationship?.detail);
    if (character.knowledge?.length) add('Knowledge / secrets known', character.knowledge.join(' | '));
    if (character.memories?.length) add('Important memories', character.memories.map(x => x.text || x).filter(Boolean).join(' | '));
    add('Notes', character.notes);

    if (character.lore?.includeScene) {
        add('Current location', character.scene?.location);
        add('Current condition', character.scene?.condition);
        add('Current mood', character.scene?.mood);
        add('Current activity', character.scene?.action);
        add('Current clothing', character.scene?.clothing);
    }

    return lines.join('\n');
}

export async function getChatBook() {
    return run('/getchatbook');
}

export async function pushLore(character, { rebuild = false } = {}) {
    const book = character.lore?.book?.trim() || await getChatBook();
    if (!book) throw new Error('Could not resolve a chat Lorebook.');

    const keys = [character.name, ...(character.aliases || [])].filter(Boolean).join(',');
    const content = rebuild || !character.lore?.content?.trim()
        ? buildLoreContent(character)
        : character.lore.content.trim();

    let entryUid = String(character.lore?.uid || '').trim();
    if (!entryUid) {
        entryUid = await run(`/createentry file=${q(book)} key=${q(keys)} ${q(content)}`);
        if (!entryUid) throw new Error('Lorebook entry was not created.');
    }

    await run(`/setentryfield file=${q(book)} uid=${q(entryUid)} field=comment ${q(`NPC — ${character.name}`)}`);
    await run(`/setentryfield file=${q(book)} uid=${q(entryUid)} field=key ${q(keys)}`);
    await run(`/setentryfield file=${q(book)} uid=${q(entryUid)} field=content ${q(content)}`);

    return {
        book,
        uid: entryUid,
        content,
        lastSync: new Date().toISOString(),
    };
}

export async function pullLore(character) {
    const book = character.lore?.book?.trim() || await getChatBook();
    const entryUid = String(character.lore?.uid || '').trim();
    if (!book || !entryUid) throw new Error('Set a Lorebook and entry UID first.');

    const content = await run(`/getentryfield file=${q(book)} field=content ${q(entryUid)}`);
    const keys = await run(`/getentryfield file=${q(book)} field=key ${q(entryUid)}`);

    return {
        book,
        uid: entryUid,
        content,
        keys,
        lastSync: new Date().toISOString(),
    };
}
