# NPC Character Bar for SillyTavern

A persistent NPC roster + portrait bar for long-form roleplay.

## What this build does

- Horizontal character bar directly above the chat input.
- Persistent per-chat NPC registry stored in SillyTavern `chatMetadata`.
- Present / Nearby / Away / Unknown / Missing / Dead / Inactive states.
- Portrait URL or uploaded/compressed portrait.
- Character Workshop with Identity, Profile, Scene, Relations, Memory, and Lorebook tabs.
- Aliases prevent one NPC from becoming multiple records when a tracker integration uses different names.
- Character Archive with search, JSON import/export, and compact mode.
- Right-click a character card to change roster status quickly.
- Collapse/expand the bar like a portrait shelf.
- Tracker bridge accepts both the custom payload and RPG Companion-style present-character arrays.
- Lorebook Push/Pull using SillyTavern's own World Info slash commands.
- Tracker bridge API for a later RPG Companion / separate-generation integration.

## Install locally

1. Put this folder under SillyTavern's third-party extensions directory, or push it to a Git repository.
2. In SillyTavern: Extensions → Install Extension → enter the Git URL.
3. Reload SillyTavern.

## Tracker integration

The extension exposes `window.NPCCharacterBar.applyTrackerPayload(payload)` and also listens for a browser event named `npcb:tracker-update`.

Example payload:

```js
window.dispatchEvent(new CustomEvent('npcb:tracker-update', {
  detail: {
    presentCharacters: ['Old Zhang', 'Chen Wei'],
    replacePresent: true,
    characterUpdates: [
      { name: 'Old Zhang', mood: 'uneasy', action: 'watching the door' }
    ],
    newCharacters: [
      {
        name: 'Chen Wei',
        aliases: ['陈伟', 'Senior Brother Chen'],
        role: 'Azure Cloud Sect disciple',
        faction: 'Azure Cloud Sect'
      }
    ]
  }
}));
```

This is intentionally separated from the UI so a future separate-generation tracker can feed structured JSON into the roster without rewriting the character system.

## Lorebook behavior

The Lorebook tab supports:

- blank Lorebook name → use/create the current chat-bound Lorebook;
- first Push → creates an entry and stores its UID;
- later Push → updates key/title/content;
- Pull → loads the entry content back into the Workshop;
- scene-state fields are excluded from generated lore by default.

## Design notes

This implementation is original code inspired by the interaction patterns of RPG Companion and Doom's Enhancement Suite. It does not require either extension to be installed.

## License

AGPL-3.0-or-later. If you merge code from AGPL projects such as the referenced extensions, retain their notices and attribution as required by their licenses.
