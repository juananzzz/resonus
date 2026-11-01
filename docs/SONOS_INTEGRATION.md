# Sonos Integration Technical Guide

## Overview

The Resonus Sonos integration enables seamless queue management and playback control across Resonus (React Native client) and Sonos devices via UPnP protocol. The system maintains synchronized queue state while intelligently handling different sync scenarios during playback.

**Key Goals:**
- Synchronize local queue changes to Sonos device queue
- Support queue reordering (including moving the currently playing track)
- Maintain playback without interruption during queue updates
- Optimize network calls by using incremental updates when possible
- Fall back to a full rebuild when incremental sync is not possible
- Mirror the Resonus crossfade setting to the Sonos crossfade toggle

---

## Architecture Overview

### Component Stack

```
┌─────────────────────────────────────────────────────────────┐
│ UI Layer (React Native)                                      │
│ - QueueScreen: drag-to-reorder, all rows including current  │
│ - moveTrack(from, to): called when user drops a row         │
├─────────────────────────────────────────────────────────────┤
│ State Management (Zustand)                                   │
│ - playerStore: queue[], index (currentIndex), isPlaying     │
│ - moveTrack() → scheduleSync() → syncUpnpRemoteQueue()      │
├─────────────────────────────────────────────────────────────┤
│ Sync Bridge (TypeScript)                                     │
│ - upnpRemoteSync.ts: syncUpnpRemoteQueue() → upnpSyncQueue()│
│ - Deduplicates in-flight syncs, caches queue signature      │
├─────────────────────────────────────────────────────────────┤
│ UPnP Native Bridge (Kotlin)                                 │
│ - RendererSession.kt: syncQueue(): routes to correct path  │
├─────────────────────────────────────────────────────────────┤
│ UPnP Protocol (SOAP/HTTP)                                    │
│ - AVTransport Service: SetAVTransportURI, Seek, Play, Pause │
│ - Queue Service (Sonos): AddURI, RemoveAllTracks, Reorder   │
└─────────────────────────────────────────────────────────────┘
```

### Key Data Structures

**UpnpRemoteState** (TypeScript):
```typescript
{
  queue: Song[];              // Full track list to sync
  index: number;              // 0-based index of current playing track
  positionSec: number;        // Playback position in seconds
  isPlaying: boolean;
  shuffle: boolean;           // Local-only for queue ordering; crossfade is synced separately
  repeat: 'off' | 'all' | 'one';
}
```

**Track** (Kotlin):
```kotlin
data class Track(
  val url: String,        // Stream URL (must be reachable by the Sonos device)
  val mime: String,
  val title: String,
  val artist: String?,
  val albumArtist: String?,
  val album: String?,
  val artworkUrl: String?,
  val durationSeconds: Int,
  val id: String? = null  // The song's id in the app
)
```

---

## Queue Sync Flows

### Flow 1: Non-Playing Device (Static Queue)

**Scenario:** User modifies the queue when Sonos is stopped or paused.

**Execution Path:**
```
moveTrack()
  → scheduleSync()
  → syncUpnpRemoteQueue()
  → upnpSyncQueue() [Native]
  → replaceQueueViaQueueService(applyTransport=false)
      ├─ RemoveAllTracks
      ├─ AddURI × N tracks
      ├─ SetPlayMode (NORMAL / REPEAT_ALL / REPEAT_ONE)
      └─ skip SetAVTransportURI (applyTransport=false → no seek/play)
```

**Outcome:** Sonos queue replaced; device stays paused; next Play uses new order.

**Network Cost:** 1 + N SOAP calls.

---

### Flow 2: Incremental Tail Sync (Playing, Current Track Unchanged)

**Scenario:** User adds, removes, or reorders tracks while playing, and the currently playing track has not moved.

**Detection:** the current track's URL is at `selectedIndex` in `lastQueueTrackUrls`, or not in it at all (see the detection in Flow 4).

**Execution Path:**
```
syncQueue()
  ├─ wasPlaying = true
  ├─ currentTrackMoved = false
  └─ → syncQueueTailWhilePlaying()
        ├─ Identify operation type on tail (tracks after current)
        ├─ Pure append   → AddURI for new tracks
        ├─ Pure trim     → RemoveTrackRange at end
        ├─ Pure deletion → RemoveTrackRange(s), back-to-front
        ├─ Insertion     → AddURI + ReorderTracks to insert in place
        ├─ Pure reorder  → ReorderTracks sweep (backward passes only)
        └─ rememberQueueState(): update URL cache and updateId
```

**Outcome:** Sonos tail updated with minimal SOAP calls; playback uninterrupted.

**Network Cost:** 1–3 SOAP calls (not per track).

**Supported Tail Operations:**
| Pattern | Before → After (tail only) | Method |
|---------|---------------------------|--------|
| Pure append | `[B, C]` → `[B, C, D, E]` | AddURI |
| Pure trim | `[B, C, D]` → `[B, C]` | RemoveTrackRange |
| Pure deletion | `[B, C, D]` → `[B, D]` | RemoveTrackRange (back-to-front) |
| Insertion | `[B, C]` → `[B, D, C, E]` | AddURI + ReorderTracks |
| Pure reorder | `[B, C, D]` → `[D, B, C]` | ReorderTracks |
| Mixed | Any | Rejected → return false |

---

### Flow 3: Shuffle / Unshuffle (Queue Fully Reordered)

**Scenario:** User enables or disables shuffle while connected to Sonos.

**UPnP-specific shuffle behaviour:** When shuffle is toggled via the player button and UPnP is active, `toggleShuffle` takes a special path that keeps the current track at its current index and only reorders the tail. This ensures `currentTrackMoved` stays `false` and only a tail-sync is needed.

**Problem with `playQueue` + shuffle mode:** When shuffle mode is already on and the user taps a song in an album (`playQueue`), the tapped song goes to `index = 0` with `originalQueue = songs`. When shuffle is then turned off, the current track moves from index 0 to index `k` (its original position). `currentTrackMoved = true`. Without additional handling, only the current track position and tail are fixed: the **head** (positions 0..k-1) remains in shuffled order.

**Execution Path (unshuffle, current track moved):**
```
toggleShuffle()  [shuffle off, originalQueue exists]
  → queue restored to originalQueue
  → index = k (original position of current track)
  → scheduleSync()
  → syncQueue()
      ├─ currentTrackMoved = true  (was at 0, now at k)
      ├─ ReorderTracks: move current track from pos 0 to pos k
      ├─ Head reorder (positions 0..k-1):
      │    forward sweep, backward ReorderTracks moves
      │    fixes all tracks that were before current in original order
      └─ syncQueueTailWhilePlaying()
           pure reorder of tail (positions k+1..N-1)
```

**Outcome:** Full queue correctly reordered with no playback interruption.

**Network Cost:** Up to N ReorderTracks calls (one per out-of-order track).

---

### Flow 4: Current Track Moved (Playing)

**Scenario:** User drags the currently playing track to a new position while Sonos is playing.

**Why this is different:**
Moving the current track does **not** change what is playing: the same song continues. Only the queue slot changes. The correct tool is `ReorderTracks`, not `RemoveAllTracks`+rebuild, because clearing the queue while Sonos streams from it kills the stream immediately.

**Detection:**
```kotlin
val currentTrackUrl = tracks[selectedIndex].url
val oldSelectedIndex = lastQueueTrackUrls.indexOfFirst { it == currentTrackUrl }
val currentTrackMoved = oldSelectedIndex >= 0 && oldSelectedIndex != selectedIndex
```

**Execution Path:**
```
syncQueue()
  ├─ wasPlaying = true
  ├─ currentTrackMoved = true
  └─ ReorderTracks(StartingIndex=oldPos+1, InsertBefore=insertBefore)
        ├─ update lastQueueTrackUrls locally (mirror the move in the cache)
        ├─ update lastQueueUpdateId from response NewUpdateID
        └─ → syncQueueTailWhilePlaying()  [handle any remaining tail delta]

  on ReorderTracks failure:
  └─ replaceQueueViaQueueService(applyTransport=true, autoplay=true)
        ├─ livePositionMs = GetPositionInfo(), fresh position from device
        ├─ RemoveAllTracks + AddURI × N
        ├─ SetAVTransportURI + Seek TRACK_NR + Seek REL_TIME
        └─ Play  [brief audible pause, but no broken state]
```

**Outcome (happy path):** Single `ReorderTracks` SOAP call; playback completely uninterrupted.

**Network Cost:** 1–2 SOAP calls.

---

### Flow 5: Track Skip (Queue Unchanged)

**Scenario:** User taps next/previous or a specific queue entry, with no tracks added, removed, or reordered.

**Why naive behavior is wrong:** `loadUpnpRemoteTrack` always calls `upnpLoad` → `replaceQueueViaQueueService` → N+2 SOAP calls (clear + add × N + seek + play), even when the queue on Sonos is already identical.

**Optimized path:** If `lastQueueTrackUrls` is non-empty and matches the incoming track list, the queue is already loaded. Only `Seek TRACK_NR` (and optionally `Play`) is needed.

**Execution Path:**
```
jumpTo(index)
  → loadIndex(index, autoplay)
  → remoteLoadIndex(index, autoplay)
  → loadUpnpRemoteTrack()  [JS]
  → upnpLoad() [Native]
  → loadQueue()
      ├─ lastQueueTrackUrls == tracks.map { url }?
      │  ├─ YES → SetPlayMode (if changed)
      │  │        Seek TRACK_NR to selectedIndex+1
      │  │        Seek REL_TIME (if positionMs > 0)
      │  │        Play (if autoplay)
      │  └─ NO  → replaceQueueViaQueueService() [full rebuild]
```

**Outcome:** Single `Seek TRACK_NR` + `Play` call; no queue disruption, no latency.

**Network Cost:** 1–2 SOAP calls (vs. N+2 before).

---

### Flow 6: Crossfade Setting Change

**Scenario:** User enables or disables crossfade in Resonus settings while connected to Sonos, or connects to Sonos while crossfade is already set.

**Mapping:** Resonus stores `crossfadeSec: number` (0 = off, >0 = enabled with N seconds). Sonos has a simple boolean toggle via `SetCrossfadeMode`.

**Sync triggers:**
1. **On connect** (`onConnected`): `upnpSetCrossfade(crossfadeSec > 0)` is called immediately after the sleep timer sync, before the queue loads.
2. **On setting change** (`setCrossfadeSec`): A `useSettings.subscribe` listener in `player.ts` fires `upnpSetCrossfade` whenever `crossfadeSec` changes and UPnP is connected.

**SOAP call:**
```xml
<u:SetCrossfadeMode xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
  <InstanceID>0</InstanceID>
  <CrossfadeMode>1</CrossfadeMode>  <!-- 0 = off, 1 = on -->
</u:SetCrossfadeMode>
```

**Outcome:** Sonos crossfade toggle matches Resonus setting immediately.

**Network Cost:** 1 SOAP call.

**Note:** Sonos returns error 800 if sent to a non-coordinator or for content that doesn't support crossfade (e.g. streams). Both are silently ignored.

---

## Critical: ReorderTracks InsertBefore Semantics

This is the most important subtlety in the integration. Getting it wrong produces silently incorrect results: Sonos returns `ok=true` regardless.

**Sonos spec (Queue Service):**
> `InsertBefore` is based on the **current ordering of the queue before the operation**, not after the tracks are removed.

This means the position counts tracks in the **original queue**, before the block at `StartingIndex..StartingIndex+N-1` is removed.

### Forward vs. Backward Moves

**Backward move** (`oldPos > newPos`, track moves toward front):
- Removal is from a position **after** `InsertBefore`. Positions ≤ `InsertBefore` are unaffected.
- `InsertBefore = newPos + 1` (1-based) is correct.

**Forward move** (`oldPos < newPos`, track moves toward back):
- Removal is from a position **before** `InsertBefore`. All positions above the removal shift left by one.
- To land at 0-based index `newPos`, target the element that is **originally** at `newPos + 1` (which is `newPos + 2` in 1-based), because the element that will be at `newPos` after insertion is currently at `newPos + 1` before the removal shifts things.
- `InsertBefore = newPos + 2` (1-based).

**Implementation:**
```kotlin
val insertBefore = if (oldSelectedIndex < selectedIndex) selectedIndex + 2 else selectedIndex + 1
```

### Worked Examples

**Forward move**, 8-track queue, current at 0-based index 3 → 6:
```
Before (1-based): [A, B, C, D*, E, F, G, H]
StartingIndex = 4   (oldPos + 1)
InsertBefore  = 8   (newPos + 2 = 6 + 2)

Remove D* from pos 4: [A, B, C, E, F, G, H]
Insert before original pos 8 = H (now at pos 7 after removal)
Result: [A, B, C, E, F, G, D*, H]  →  D* at 0-based index 6  ✓
```

**Backward move**, 8-track queue, current at 0-based index 6 → 1:
```
Before (1-based): [A, B, C, D, E, F, G*, H]
StartingIndex = 7   (oldPos + 1)
InsertBefore  = 2   (newPos + 1 = 1 + 1)

Remove G* from pos 7: [A, B, C, D, E, F, H]
Insert before original pos 2 = B (unchanged: removal was after pos 2)
Result: [A, G*, B, C, D, E, F, H]  →  G* at 0-based index 1  ✓
```

### Why the Existing Tail-Sync Is Unaffected

`syncQueueTailWhilePlaying` uses `ReorderTracks` only for reordering within the tail, and its scan always moves elements **backward** (source > target, `InsertBefore < StartingIndex`). For backward moves the removal is after the insertion point, so the two interpretations of `InsertBefore` yield the same result. The ambiguity only surfaces for forward moves.

---

## Implementation

### TypeScript: `src/store/upnpRemoteSync.ts`

Bridges React state to native UPnP calls. Deduplicates syncs and caches the queue signature so unchanged queues don't trigger SOAP traffic.

**Key state:**
```typescript
let lastQueueSignature: string | null = null;    // join of track IDs
let lastPlayMode: UpnpPlayMode | null = null;
let inFlightSync: Promise<boolean> | null = null; // dedup guard
```

**`syncUpnpRemoteQueue(state, force?)`:**
1. Skip if not connected.
2. Return the in-flight promise if one exists (dedup).
3. If queue signature changed or `force=true`: call native `upnpSyncQueue()`.
4. If only play mode changed: call `upnpSetPlayMode()`.
5. Otherwise: no-op, return `true`.

The TS layer passes full state (queue, index, position) to native and lets native decide the strategy. This keeps the bridge simple.

---

### Kotlin: `modules/upnp-cast/.../RendererSession.kt`

Owns the UPnP session state and all SOAP communication.

**`syncQueue(tracks, currentIndex, positionMs, playMode)` decision tree:**
```
Is Sonos device?
│
├─ NO  → loadQueue()  [non-Sonos: SetAVTransportURI per track]
│
└─ YES
   ├─ wasPlaying?
   │  ├─ NO  → replaceQueueViaQueueService(applyTransport=false)
   │  │
   │  └─ YES → currentTrackMoved?
   │           ├─ NO  → syncQueueTailWhilePlaying()
   │           └─ YES → ReorderTracks(StartingIndex, InsertBefore)
   │                      ├─ ok   → syncQueueTailWhilePlaying()
   │                      └─ fail → replaceQueueViaQueueService(applyTransport=true, autoplay=true)
```

**Queue state cache** (updated by `rememberQueueState()` after every successful sync):
```kotlin
private var lastQueueOwnerUid: String? = null
private var lastQueueId: Int? = null
private var lastQueueTrackUrls: List<String> = emptyList()
private var lastQueueUpdateId: Int = 0
```

`lastQueueTrackUrls` is also patched in-place after `ReorderTracks` so that the follow-up `syncQueueTailWhilePlaying` sees a consistent starting state.

---

## Edge Cases

### Current Track Moved + Tail Also Changed

If the user drags the current track and other tracks also changed simultaneously:
1. `ReorderTracks` repositions the current track.
2. `lastQueueTrackUrls` is updated locally to reflect the move.
3. `syncQueueTailWhilePlaying` handles any remaining tail delta against the updated cache.

### `RemoveAllTracks` While Playing

**Never do this.** Sonos streams from the queue URI; clearing the queue while playing immediately drops the stream. The current-track-move path uses `ReorderTracks` to avoid this. The full-rebuild fallback (triggered only when `ReorderTracks` fails) calls `GetPositionInfo` first to get a fresh position, then rebuilds and seeks back.

### `avTransport` Nulling

When `accepted = false`, `avTransport` is only cleared when the device was **not** playing. Clearing it during playback would break all subsequent play/pause/seek commands. A rejected tail-sync while playing is not a connection error.

### Stale `positionMs`

`syncQueueNow` fires 2.5 s after the last queue change (debounce). For the full-rebuild fallback, a fresh `state()?.positionMs` (`GetPositionInfo` call) is used instead of the potentially stale JS store value.

### Network Failure Mid-Sync

All SOAP operations abort immediately on failure. The Sonos queue is left in its previous state. The next `scheduleSync()` will retry the full operation.

---

## Testing Checklist

### Unit
- [ ] `queueSignature()` is stable for the same track list
- [ ] `playModeForState()` maps all three repeat modes correctly
- [ ] `moveTrack()` index adjustment keeps the same track as current after every move
- [ ] `currentTrackMoved` detection: `true` when the current track's URL is cached at another index, `false` otherwise
- [ ] `insertBefore` formula: backward → `newPos+1`, forward → `newPos+2`

### Integration (with Sonos device)
- [ ] Drag current track **backward** → `ReorderTracks` fires, queue correct, playback uninterrupted
- [ ] Drag current track **forward** → `ReorderTracks` fires with `InsertBefore = newPos+2`, queue correct
- [ ] Drag non-current track → tail-sync path, no `ReorderTracks`
- [ ] Add track while playing → tail append via `AddURI`
- [ ] Remove non-current track while playing → tail deletion
- [ ] Pause → drag → resume → queue correct on both sides
- [ ] Multiple rapid drags → debounce fires once with final state

### Shuffle
- [ ] Toggle shuffle on while playing (UPnP) → only tail reordered, index stable
- [ ] Toggle shuffle off with `originalQueue` → full queue correctly reordered (head + tail)
- [ ] Start album via "shuffle play" button → queue shuffled, no `originalQueue`, turning off shuffle is a no-op on queue order
- [ ] Head reorder failure → falls back to full rebuild with seek

### Crossfade
- [ ] Enable crossfade in settings while connected → `SetCrossfadeMode(1)` fires immediately
- [ ] Disable crossfade in settings while connected → `SetCrossfadeMode(0)` fires immediately
- [ ] Connect while crossfade is on → `SetCrossfadeMode(1)` sent in `onConnected`
- [ ] Connect while crossfade is off → `SetCrossfadeMode(0)` sent in `onConnected`

### Regression
- [ ] Non-Sonos UPnP renderers still work (fallback `loadQueue` path)
- [ ] Play mode (repeat) changes propagate without full rebuild
- [ ] Connecting mid-playback loads correct track and queue

---

## Protocol Reference

### SOAP Services Used

#### AVTransport Service (standard UPnP)
| Action | Purpose |
|--------|---------|
| `SetAVTransportURI` | Load a queue URI as the transport source |
| `Seek` | Jump to track (`TRACK_NR`) or time position (`REL_TIME`) |
| `Play` | Start or resume playback |
| `Pause` | Pause playback |
| `SetPlayMode` | Set repeat mode (`NORMAL`, `REPEAT_ALL`, `REPEAT_ONE`) |
| `GetPositionInfo` | Query current track number and playback position |
| `GetTransportInfo` | Query playback state (`PLAYING`, `PAUSED_PLAYBACK`, etc.) |
| `SetCrossfadeMode` | Enable/disable crossfade between tracks (`CrossfadeMode`: 0 or 1) |

#### Queue Service (Sonos-specific)
| Action | Purpose |
|--------|---------|
| `AttachQueue` | Get the queue ID for an owner UID (returns existing) |
| `CreateQueue` | Create a new queue for an owner UID |
| `RemoveAllTracks` | Clear the entire queue |
| `AddURI` | Append a track; returns `NewUpdateID` |
| `RemoveTrackRange` | Remove a contiguous range of tracks by 1-based index |
| `ReorderTracks` | Move a contiguous block to a new position (see InsertBefore section) |

### Key Sonos Concepts

**Queue URI:**
```
x-rincon-queue:RINCON_XXXXXXXXXXXXX#queueId
```
Passed to `SetAVTransportURI` to tell the device to play from its queue service.

**UpdateID:**
Every queue mutation returns `NewUpdateID`. Each subsequent mutation must include the current `UpdateID`. A stale ID causes Sonos to reject the call (`400` or fault response). `parseUpdateId()` extracts `NewUpdateID` (or `UpdateID`) from every response.

**`resolveQueueId(queueSvc, ownerUid)`:**
Calls `AttachQueue` to get the active queue ID. Creates a new queue via `CreateQueue` only if attach fails. The ID is stable for the lifetime of a session.

---

## External Reference

All Sonos UPnP service actions, their parameters, allowed values, and error codes are documented in the unofficial community reference:

**https://sonos.svrooij.io/**

Relevant service pages used in this integration:

| Service | URL |
|---------|-----|
| AVTransport | https://sonos.svrooij.io/services/av-transport.html |
| Queue Service | https://sonos.svrooij.io/services/queue.html |

This reference was the authoritative source for:
- `SetCrossfadeMode` input parameter name (`CrossfadeMode`, boolean `0`/`1`)
- `ReorderTracks` / `InsertBefore` semantics (*"InsertBefore is based on the current ordering before the operation"*)
- `ConfigureSleepTimer` duration format (`hh:mm:ss` or empty string to cancel)
- Error code 800 (*"Command not supported or not a coordinator"*)
- Queue service `AttachQueue` / `CreateQueue` / `ReorderTracks` parameter names

---

## Common Issues & Solutions

| Issue | Root Cause | Solution |
|-------|-----------|----------|
| Queue drifts on **forward** drag of current track | `InsertBefore` needs `newPos+2` for forward moves | `if (oldPos < newPos) newPos+2 else newPos+1` |
| Playback stops when current track is dragged | `RemoveAllTracks` while streaming kills queue | Use `ReorderTracks`; full rebuild only as fallback |
| Playback restarts unexpectedly | `SetAVTransportURI` called while playing | Only call when `applyTransport=true` (deliberate load) |
| Tail-sync silently skips | `lastQueueOwnerUid` / `lastQueueId` mismatch | Ensure `rememberQueueState()` is called after every successful sync |
| `UpdateID mismatch` error from Sonos | Stale `lastQueueUpdateId` | Parse `NewUpdateID` from every queue service response |
| Deadlock / sync never completes | `inFlightSync` not cleared on error | JS bridge uses `try/finally` to always clear `inFlightSync` |
| Sonos crossfade out of sync after reconnect | Not synced on `onConnected` | `upnpSetCrossfade` is called in `onConnected` before queue load |

---

## Glossary

| Term | Definition |
|------|-----------|
| **Tail** | All queue tracks after (and not including) the currently playing track |
| **Tail-Sync** | Incremental update of the tail only; fastest path, no stream interruption |
| **Queue Rebuild** | Full `RemoveAllTracks` + `AddURI` loop; used when paused or as fallback |
| **applyTransport** | If `true`, `replaceQueueViaQueueService` also calls `SetAVTransportURI + Seek + Play` |
| **Forward Move** | Dragging a track toward the end (`oldIndex < newIndex`) |
| **Backward Move** | Dragging a track toward the start (`oldIndex > newIndex`) |
| **InsertBefore** | 1-based `ReorderTracks` parameter; position in the queue **before** removal |
| **UpdateID** | Monotonically-increasing sequence number threaded through every queue operation |
| **inFlightSync** | Shared `Promise<boolean>` in the JS bridge; prevents overlapping syncs |
| **RINCON** | Sonos device identifier embedded in the queue URI |
| **CrossfadeMode** | Sonos boolean toggle for crossfade between tracks; mapped from Resonus `crossfadeSec > 0` |
