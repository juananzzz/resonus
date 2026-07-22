# Changelog

All notable changes to Resonus are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before 0.2.1 are only listed on the
[GitHub releases page](https://github.com/juananzzz/resonus/releases).

## [Unreleased]

## [0.5.1] - 2026-07-22

### Added

- Add a whole album, artist, playlist or the current queue to a playlist, from
  its ⋯ menu.
- Auto-download playlists: mark a playlist and the songs you add to it download
  automatically.
- Choose the streaming and download codec separately — Opus, AAC, MP3 or the
  server default — with a new 160 kbps option.
- Optional album and release year line under the title on the player (off by
  default).
- Multi-disc albums now show disc separators with their titles.
- Optional plain-text password authentication, for Subsonic servers that don't
  support token auth.
- Option to hide unavailable (not downloaded) songs in offline mode.

### Changed

- UPnP/DLNA casting now advances the queue, shows lock-screen controls and
  responds to the volume keys.
- All server playlists are cached for offline, not just the downloaded ones.
- Swapped the positions of the star rating and the audio-quality label on the
  player.
- The offline cloud icon was removed from the Home header.
- Contributing a translation is now much easier: languages live in a single
  place, with a contributor guide and a status helper for translators.

### Fixed

- Seeking a transcoded stream no longer restarts the track when you seek right
  after it loads, and it recovers safely if the server support check hiccups.
- The mini player's swipe direction now matches the full player: swipe left for
  the next track, right for the previous.
- The "Show rating" toggle now appears in the player settings in offline mode,
  where ratings already work.
- Favorited albums now appear in offline mode even when none of their songs are
  downloaded.
- Slow, laggy scrolling in long playlists.
- The mini player no longer covers the last row in tab lists.
- Track preloading now warms the original source instead of the transcode.

## [0.5.0] - 2026-07-20

### Added

- Offline mode now mirrors your whole server library, not just downloads:
  favorites, playlists, starred albums and artists all appear. Songs you haven't
  downloaded show greyed out, with their cover, and can still be selected in
  multi-select, so you see everything and play what's on the device.
- Offline edits sync back when you reconnect: favorites, star ratings and
  playlist changes (add, remove, reorder, create, delete, rename) you make
  offline are pushed to the server the next time it is reachable.
- Radio stations can be managed from the app — add, edit and delete — with a
  radio-aware player and custom station artwork stored on the device.
- Quick grid customization: choose its sources (favorites, albums, playlists),
  its size (4, 6 or 8 cards), and turn it off, all from its own settings.
- Choose which tab the app opens on (Home, Search or Library), returning there
  when you reopen the app after a few minutes away.
- Playlists can now appear as a Home section (off by default).
- Star ratings in song lists, with an optional Rate action in a song's ⋯ menu to
  rate without opening the player.
- Subsonic Jukebox mode, to play through the server's own audio output.
- Previous-button behavior setting.
- "Recently added" sort when browsing Albums and Artists.
- "Downloaded" sort that groups downloaded songs together in playlists and
  favorites.
- Optional Favorites explore chip, and a hidden-by-default "Recently played"
  chip on Home.
- Server accounts now go offline automatically and seamlessly when the server
  can't be reached, including falling back to offline when a saved profile is
  unreachable at login; the auto-switch has a toggle.

### Changed

- Downloads and settings are now per account/profile, and offline behavior is
  sturdier.
- The offline indicator is a single subtle crossed-cloud icon next to the
  greeting; the offline toast just says "Offline"; and the switch-to-offline and
  sign-out pills are lighter.
- Discover shows first among the default Home sections.
- The Recent chip on Albums sorts by recently played and refreshes when you
  enter the screen.
- The repeat button now cycles off → repeat one → repeat all, so the first tap
  repeats the current song.
- Switching server address refreshes the library and hands off the currently
  playing track seamlessly.
- Delete is separated from the other playlist-menu actions by a divider.
- The Downloads settings section is hidden in the local profile.

### Fixed

- Playlist song removal is hardened against index drift, so the right song is
  removed even if you go offline mid-edit.
- Random artists and Discover reshuffle on pull-to-refresh on Home.
- The password field no longer forces an uppercase keyboard, and revealing
  search gives a single haptic.

## [0.4.0] - 2026-07-17

### Added

- Built-in equalizer, with the device's presets, a slider per band and a reset
  to flat (Quality & playback).
- Home sections can now be shown, hidden and reordered, with three new rows off
  by default: Discover (albums you played a while ago but not lately), Random
  albums and Random artists.
- The Home explore chips can now be shown, hidden and reordered too, and a new
  Shuffle chip plays random songs from your library straight away.
- Start mix on a song's ⋯ menu: the song plays at once and the queue keeps
  filling with music like it. The queue header shows a button to stop it.
- Shuffle button on the genre screen, to play a genre at random.
- Choose which actions appear in a song's ⋯ menu (Appearance).
- Configurable swipe actions on song rows, in both directions: add to queue,
  play next, add to favorites or open the options menu.
- Network settings (experimental): several server addresses with automatic
  switching.
- Choose what tapping the player cover does, including showing the lyrics in
  place.
- Lyrics entry in the player's ⋯ menu.
- Bulk downloads can be stopped, keeping whatever already finished, and they
  start downloading almost immediately instead of after a long scan.
- Browsing artists now shows a grid of artist cards with sorting by name,
  recently played, most played or random.
- Grid or list when browsing albums and artists, from a button in the header.
  Each screen remembers its own.
- Search when browsing albums: pull down at the top of the list to find an album
  anywhere in your library.
- Download an artist's whole discography from their page, with progress and the
  option to stop it.
- The Home greeting can be hidden, or replaced with your own text, under
  Appearance › Home › Greeting.
- More accent colors in the palette.
- Pressing the Search tab when you are already on Search brings up the keyboard,
  so you can start typing without reaching for the box. Arriving from another
  tab it takes two presses, which leaves Browse all in peace on the first one.
- Preload upcoming tracks (Quality & playback, off by default): the next few
  tracks are requested ahead of time so they start instantly, even when you skip
  several ahead. Aimed at proxy servers like Octo-Fiesta, or slow sources that
  only fetch a track the first time you play it.

### Changed

- The "Show explore chips" switch is replaced by a switch per chip. If you had
  the chips hidden they stay hidden after updating.
- Online lyrics lookup is now on by default.
- The cover-tap and skip-button settings are now dropdowns instead of long
  lists of options.
- Only favorited albums can be pinned.
- Recently played now appears on Home in local mode, and an artist's Popular
  songs are ordered by your play count there.
- Settings screens no longer offer switches for things that don't exist in
  local mode.
- The artist's Popular songs line up with the rest of the lists instead of
  running edge to edge.
- The filter when browsing artists now stays out of the way until you pull down
  at the top of the list, the same gesture playlists and favorites use.
- The sleep timer fades the music out over its last seconds instead of cutting
  it dead.
- Download confirmations now estimate how much space they need, and say so when
  the device may not have enough.
- The sleep timer says how long is left rather than the length you picked, and
  starts counting down from the first second.
- Scanning your device or folder for music is faster: it no longer reads the
  embedded cover of every single song only to keep one per album.
- The local scan's progress bar moves steadily instead of in jumps, counts
  files while it is still finding them, and stays up until the covers are ready
  rather than leaving you on a full bar with nothing happening.
- Browsing albums and browsing artists now offer the same sort chips in the
  same order, and both open on Recent. Sorting albums by artist is gone; browse
  by artist from Artists instead.

### Fixed

- The accent color now repaints Settings immediately instead of waiting for you
  to leave and come back, and the toast's Undo, the error screen's Retry button
  and the login button no longer stay stuck on the default green.
- Settings dropdowns now open flush against their row instead of floating above
  it, and scroll when there isn't room.
- The artist Shuffle button now really shuffles instead of starting with the
  artist's top track every time.
- A mix no longer runs out quietly: it falls back to the artist's tracks and
  then to the genre, and it survives closing the app.
- Clearing the queue now stops a running mix instead of leaving it on but
  unable to grow.
- The artists grid in random order no longer reshuffles itself while music
  plays.
- The favorite heart no longer sticks on album rows after unfavoriting.
- Downloaded cover art now shows offline in server mode.
- Long-pressing a song to enter multi-select now keeps that song selected.
- Bigger tap target on the song row's ⋯ button.
- German and Catalan translations for the newest screens.
- The Autoplay setting no longer claims something a mix contradicts.
- Home and the other screens show a local scan's new music and covers as soon
  as it finishes, instead of waiting for you to pull down and refresh.
- A failed download is no longer saved as if it were the song. Servers report
  some failures with a success code, so the error text was being written to
  disk as the track — and as the album art — marked as downloaded and never
  retried. You would only have found out with no signal, which is when it
  matters most.
- Removing the last downloaded song of an album now leaves that album's screen
  instead of stranding you on an empty page with an internal id for a title.
- Crossfade no longer goes silent in the background. The incoming track's volume
  ramp ran on a timer that Android freezes while the app is backgrounded, so the
  next song came up muted until you reopened the app; it now keeps fading
  correctly with the screen off.
- Playback now pauses when you unplug headphones or a Bluetooth device
  disconnects, instead of suddenly blaring out of the speaker. It used to pause
  only sometimes, on some Bluetooth disconnects, and never on a wired unplug.

## [0.3.1] - 2026-07-12

### Added

- Separate streaming quality for Wi-Fi and mobile data, with new 96 and 64 kbps
  options for tighter data caps.
- Skip back/forward buttons in the player, with a choice of 5, 10 or 30 seconds
  (off by default).
- Press and hold the play button to stop and clear the current playback.
- Setting to show or hide the explore chips on Home.

### Changed

- Reorganized Settings into clearer sections across Player, Quality & playback,
  Downloads, Library and Appearance, with Font moved to its own screen.
- The add-to-playlist sheet is now taller so long playlist lists aren't cramped.

### Fixed

- Downloaded songs now play from disk in server mode, so downloads work
  offline.
- Sorting a playlist by album now respects disc numbers on multi-disc albums
  instead of interleaving tracks.
- The colored-lyrics setting is now honored by the lyrics card in the player,
  not just the full-screen lyrics.
- The player rating row no longer pushes content off screen when every element
  is enabled.
- The keyboard no longer covers the search bar on the add-to-favorites screen.
- Centered the sort chip labels on the Albums screen.

[0.5.1]: https://github.com/juananzzz/resonus/releases/tag/v0.5.1

[0.5.0]: https://github.com/juananzzz/resonus/releases/tag/v0.5.0

[0.4.0]: https://github.com/juananzzz/resonus/releases/tag/v0.4.0

[0.3.1]: https://github.com/juananzzz/resonus/releases/tag/v0.3.1

## [0.3.0] - 2026-07-11

### Added

- Reorder playlists by dragging, with per-list sort options (Custom / Recent)
  that are remembered.
- Haptic feedback on key actions (off by default, under Appearance).
- App font picker with six fonts, including Typewriter and Casual.
- Folder browsing for Subsonic servers (optional, in Settings).
- Search inside playlists and favorites by pulling down at the top of the list.
- Add-to-favorites screen to star your most played, recent or suggested songs
  in batch.
- Multi-select in playlists, favorites and albums, with undo for destructive
  actions.
- An "Appears on" section on the artist screen.
- ReplayGain volume normalization.
- Change playlist covers from the fullscreen viewer, marquee titles in the mini
  player, queue whole albums or playlists from their menu, a keep-screen-on
  option, a download-over-Wi-Fi-only setting, and more visibility toggles in
  Settings.
- Catalan translation.

### Changed

- Playlists default to Custom sort, like Spotify.
- Song duration is hidden in lists by default.

### Fixed

- Tapping a lyrics line to seek now responds reliably, and the auto-scroll
  animates smoothly on phones with reduced system animations.
- Seeking in transcoded streams.
- The audio quality badge reflects the transcoded stream instead of the source
  file.
- The mini player's dynamic color now matches the player screen.
- Honest scrobbling: correct now-playing updates and Last.fm threshold.

[0.3.0]: https://github.com/juananzzz/resonus/releases/tag/v0.3.0

## [0.2.2] - 2026-07-07

### Added

- Per-library visibility toggles for multi-library servers: pick which
  Navidrome libraries appear across the app (Home, Library, Search, Favorites).
- 1–5 star rating bar in the player (opt-in; off by default).
- Grid view mode for the Library.
- New Theme settings section with an accent color picker.
- German translation.
- Loading skeletons on the Genres screen and the browse and home album/artist
  lists.

### Changed

- The audio quality label is now a player-only toggle instead of appearing on
  every song row.
- Audio fades in and out when you pause or resume inside the app.
- More breathing room between the settings section rows.

### Fixed

- Shuffle play could show a different track than the one actually playing, and
  the shuffle button stayed lit on unrelated albums and playlists.
- The About screen no longer labels the version as beta.

### Removed

- Chromecast support, removing the last proprietary dependency (a step toward
  F-Droid). Casting to UPnP/DLNA devices is unaffected.

[0.2.2]: https://github.com/juananzzz/resonus/releases/tag/v0.2.2

## [0.2.1] - 2026-07-06

### Added

- Tap the cover art in the player to open the full-screen lyrics.
- Artist picker for songs and albums with more than one artist.
- Loading skeleton for the genre cards in Search.

### Changed

- Reworked the mini player gestures: swipe down to dismiss, swipe sideways to
  skip tracks.
- Split the queue into clear sections (now playing, next in queue, next from
  the source).
- Polished the lyrics screen with Apple Music-style line focus and previous /
  next controls.
- Full-screen lyrics now start centered instead of pinned to the top.
- Opening the lyrics now jumps straight to the current line instead of doing a
  fast scroll from the top.
- Softened the cover-derived background color so text and controls stay legible
  on any artwork.

[0.2.1]: https://github.com/juananzzz/resonus/releases/tag/v0.2.1
