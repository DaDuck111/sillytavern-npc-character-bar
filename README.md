# NPC Character Bar for SillyTavern

## v0.3.0 — System HUD

This release expands the extension from an NPC tracker into a lightweight RPG HUD.

- **Global Character Archive**
  - NPCs persist across chats in an account-wide archive.
  - Create custom NPC groups.
  - Filter by group or linked chat.
  - Link an archived NPC into the current chat, or unlink them without deleting the global archive entry.
  - Existing per-chat NPCs are migrated into the global archive when a chat loads.

- **Tall portrait covers**
  - The character shelf above the input now uses tall portrait-cover cards instead of horizontal rows.
  - Present/nearby status remains visible and away cards can be optionally shown.

- **Player RPG state**
  - Level, XP and XP-to-next.
  - Money + custom currency.
  - Current location and persistent home/base.
  - Custom stats with per-stat AI tracking toggle.
  - Inventory with quantity and equipped state.
  - Skills, ranks and titles.
  - Current condition.

- **Automatic RP tracking**
  - Separate-generation tracker can update player stats, money, inventory, skills, titles, level/XP, location and NPC state.
  - The prompt is conservative: rewards/items/stat changes are only applied when the roleplay clearly establishes them.
  - Tracker categories can be enabled/disabled independently in the SYSTEM tab.

- **System UI**
  - The right dashboard now uses a dark glass / cyan-neon RPG-System aesthetic.
  - Tabs: STATUS / ITEMS / SKILLS / HOME / NPC / SYSTEM.

A persistent NPC roster + portrait bar for long-form roleplay.

## What this build does

### v0.2.0 (previous)
- RPG-style fixed dashboard on the right side of SillyTavern.
- Characters / Scene / Tracker tabs.
- Automatic post-response RP scanning using SillyTavern's own `getContext().generateRaw()`.
- New named characters can be registered automatically into the persistent per-chat roster.
- Present/away state, role, faction, relationship, location, mood, action, condition, aliases and durable memories can update from roleplay.
- Current scene location/time/summary are extracted and shown in the dashboard.
- Manual **Scan latest RP** button for re-reading the newest assistant reply.
- Tracker settings inside the dashboard: auto-read toggle, auto-register toggle, context depth, away-card visibility and compact mode.
- The latest existing RP is scanned once after extension startup.

> **Important:** Auto-read uses one additional model/API generation after each assistant RP response. Disable **Auto-read roleplay** in the Tracker tab if you do not want the extra request/token usage.

### Existing character system

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
