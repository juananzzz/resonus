# Changelog

All notable changes to Resonus are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before 0.2.1 are only listed on the
[GitHub releases page](https://github.com/juananzzz/resonus/releases).

## [Unreleased]

### Added

- Internet radio shows what is playing. Stations that announce their tracks put
  the song and the artist where the station's name used to sit, on the player,
  the mini player, the notification, the lock screen and in the car, and they
  update as the broadcast moves on. One that announces nothing looks exactly as
  it did. Asked for by @ztx-lyghters.
- Tapping an artist's photo opens it full screen, uncropped, the way album
  covers already did. The header has to crop photos to fill its space, and
  faces were ending up outside it. Asked for by @ztx-lyghters.
- 256 kbps, for streaming and for downloads, asked for by @CraftoHohenvels.
- The streaming codec can be chosen per network, as the quality already was:
  the file as it is over Wi-Fi, so the server is not re-encoding what was
  already fine, and something smaller on mobile data. Asked for by
  @ztx-lyghters.

### Changed

- The play button on an artist always has something to play. With no popular
  tracks it plays the discography from the earliest album on, which is what a
  server that keeps no play counts leaves you with, and until now the button
  did nothing at all. Raised by @ztx-lyghters.
- When an artist's popular tracks run out the queue carries on with the rest of
  that artist, album by album, and only then does the mix of other people get
  its turn.
- The equalizer no longer touches the audio while it is switched off. Its
  effect used to be attached to every song either way, which keeps Android from
  handing playback to the low power path: battery and heat spent on something
  most people never turn on.
- Home says when you are offline, with the same quiet cloud the other tabs
  already had in their headers. It was the one screen that showed you a shorter
  library without a word about why.
- "Library copy", in Settings › Downloads, is now "Library metadata copy". It
  sits under the bar that counts your downloads and read as a second copy of
  the music, which it is not.
- The transcode codec is greyed out while its quality is "Original". At that
  quality the file arrives exactly as it is on the server, so the codec had
  nothing to do and was ignored without saying so: picking Opus there looked
  like a setting that did nothing. It now says as much instead of showing a
  codec that is not being used, and stays in view so it can still be found. In
  Settings › Downloads the two have also swapped places, quality first and the
  codec under it, which is the order they already had for streaming. Raised by
  @ztx-lyghters and @CraftoHohenvels.
- Two strings that could not be translated properly. The row that creates a
  local profile said "Local", an adjective with no noun behind it, and now says
  "Local profile", the name that profile carries on every other screen; and
  "Original", the quality option, was written into the app in English and never
  reached the translators. Reported by @ztx-lyghters.

### Fixed

- Cover art reached the notification and nothing else. What a car shows over
  Bluetooth, what Android Auto shows and what the system's own controls show
  all come from the track, and nothing was ever attached to it, so all they had
  were the tags inside the file: an original FLAC carried its cover, a
  transcode arrived stripped of it, and downloads in Opus had none at all. The
  cover also comes off the disk when the album is downloaded, so it is there
  with no connection. Reported by @jaredm4 and @ztx-lyghters.
- Casting to a UPnP or DLNA speaker answered "this song can't be cast", every
  song and every device. Tracks went out announced as video, which a TV plays
  anyway and a speaker refuses. They now say what they are, and the cover, the
  artist and the album go with them. Reported by @kebbob.
- On Jellyfin every transcode came out as mp3 whatever the codec setting said,
  and downloads were saved under the name of the codec that had been asked for.
  Files downloaded before this are still mp3 and have to be downloaded again.
  Reported by @jaredm4.
- The blurred background went black for an instant between one song and the
  next, on the player and on the lyrics screen. The previous cover now stays up
  until the next one is ready and they dissolve into each other.
- The heart said nothing. Marking a favourite from the swipe or from a menu
  confirmed it, but tapping the heart itself, on the player, the mini player,
  a song row or an artist, did not, and if the server refused the heart quietly
  went back to how it was, which looked like a mistyped tap.

## [0.6.0] - 2026-07-30

Your downloads and your offline library move out of the JSON files they lived
in and into a database. Nothing is lost in the move: the old files are kept,
renamed, and only after everything they held has arrived.

Note that this is a one way trip. Going back to 0.5.6 or earlier after
installing this will show no downloads at all, because the files those versions
read have been renamed.

### Added

- Gapless playback, for real this time and with no setting to find: an album
  that was recorded to run without pauses now plays that way. Thanks to
  @haccersmakker, who tracked down the gap that was left on the first change of
  track.
- Favourited albums and artists open offline even if you have never downloaded
  a song from them.
- Radio stations can be pinned to the top like playlists and albums, and once
  there are enough of them the screen offers a search box.
- German and Italian are complete, thanks to @Psychotoxical and @Anakin-bb8.

### Changed

- The offline copy of your library no longer has size limits. Playlists over
  five hundred songs used to be dropped, as were albums you had downloaded in
  full; both are kept now. Saving one playlist writes one playlist instead of
  rewriting the whole copy.
- Only the profile you are using has its downloads read when the app starts,
  instead of every profile you have ever added.
- Up to twenty five things can be pinned, rather than four.
- Choosing an order in the sort menu closes it, the way the one in the Library
  already did.

### Fixed

- Original quality played lossless files at double speed and an octave up,
  with heavy clipping, on phones whose decoder answers a request for 32-bit
  audio without saying that it did. It reached the 0.6.0 pre-release only, and
  transcoding is no longer needed to get around it.
- Downloading a library asked the server twice for the lyrics of every song
  that has none, doubling the requests queued in front of the screens.
- Switching profiles could leave the offline library unreadable, showing
  playlists with names like `dl_obp32J49` and no favourites.
- Deleting a discography could fail on a large one.
- Counted playlists read "1 playlists" in every language.
- With Android's "Bold text" turned on, the last letter of a word was dropped
  all over the app: "MP3" read "MP", "2.6 GB" read "2.6". The app no longer
  takes that setting, so it renders at its usual weight instead.
- Removing a profile now asks first, and takes its downloads and its offline
  copy of the library with it instead of leaving them on disk for good.
- Random songs and the mix took the same amount from every library whatever
  its size, and the mix could still draw on a library you had disabled.

## [0.5.6] - 2026-07-27

Mostly a performance release. On large libraries the app was doing a great deal
of work nobody asked for, and the bigger the library the worse it got.

### Added

- Delete the downloads of your favourites from their ⋯ menu, as albums,
  playlists and discographies already allowed.
- Settings › Downloads shows what the offline copy of your library takes up,
  next to what the downloads themselves take.

### Changed

- The ⋯ menus of playlists, favourites, the queue and artists, and the sort
  sheet, now slide in and out and close by dragging them down, with the same
  grabber the song menu has.
- The song ⋯ menu opens showing one more action before you have to scroll.
- The offline copy of your library no longer grows without end. It keeps your
  playlists, your favourites and whatever has downloads, and it is tidied up
  when the app starts.

### Fixed

- Downloading no longer drags the whole app down. Each finished song was
  recounting every album by walking every song, which on a large library is
  millions of comparisons per song, on the thread that answers your taps.
- Deleting downloads did the same twice over, and asked every screen in the app
  to reload before it had actually deleted anything.
- The app no longer downloads the full contents of every playlist you own on
  every start. It was tens of MB before the first screen had finished loading.
- Android Auto's browse list is no longer built within a second of opening the
  app, fetching the songs of every album on your shelves and every favourite,
  whether or not a car is ever plugged in.
- Storage used no longer measures every downloaded file one at a time, which
  froze the app while it counted and did not even stop when you left the screen.
- The Library no longer sorts its lists again on every redraw and every letter
  typed into its search box.
- Cover art is kept in memory once decoded, instead of being decoded again
  every time it scrolls back into view.
- The full screen player no longer repaints itself twice a second while music
  is playing.
- With more than one library active, shelves ask for what they show instead of
  five times as much, and "Random albums" now takes each library's size into
  account rather than giving them equal turns.
- A large install could open showing placeholders that never resolved, and the
  switch to offline mode could be missing from Settings while the downloads
  were still being read.
- Lyrics are asked for once per song rather than twice, and the next song's are
  no longer requested at the exact moment a track changes.

## [0.5.5] - 2026-07-26

### Added

- Share a song, album or playlist as a link, on servers that allow it.
- Genre screens now have a Songs tab next to the albums, with play and shuffle
  for the whole genre, a grid/list switch and multi-select on the songs.
- Genre chips on album screens; tap one to browse it. Off by default, under
  Appearance.
- Search finds radio stations too.
- Search your playlists, albums and artists from the Library.
- Radio stations show the image the server holds for them, and changing it in
  Resonus uploads it, so every client and Navidrome itself show the same one.
- Delete the downloads of an album, a playlist or a whole discography from its
  ⋯ menu — offline included, and half-downloaded ones too.
- A warning when Android's battery optimization is restricting the app, which
  is what usually stops playback in the background. Switch under Playback.
- Grid or list in an artist's full discography, remembered.
- "Play discography" in chronological order, from the artist's ⋯ menu.
- "Good night" as a greeting in the small hours.
- The Russian translation is complete again.

### Changed

- The song ⋯ menu opens showing the actions most used and grows when pulled up;
  its grabber closes it from anywhere in the list.
- Search asks what you want to listen to instead of listing what it can find —
  it finds more than it used to say.
- The search bar in Browse albums and artists is simply there, instead of
  appearing when you pull the grid down.
- Removing a download, turning on auto-download and clearing an album's
  downloads ask first. Downloading from a ⋯ menu now says how much space it
  will take, as the album's own screen already did.
- The player's background is blurred cover art by default.
- Shuffle sits next to play on the artist screen and lights up when it's on.
- «Rate» shows in the song menu by default.
- "Help translate" opens the translation guide.

### Fixed

- Downloading no longer rewrites the entire download catalog for every single
  song, which froze the app on large libraries and left deletions looking like
  they had done nothing until a restart.
- With more than one library active, album lists no longer read every library
  whole just to show twenty albums.
- Finishing a download no longer sends the app off to re-fetch everything from
  the server.
- Cover art is no longer downloaded twice, once to show and once for the colour.
- A mix stays anchored to the song it started from instead of drifting further
  from it with every batch.
- Mixes range across artists instead of turning into one artist's discography.
- A mix that finds nothing says so instead of announcing it started.
- Home shelves order across libraries instead of taking turns, so a small
  library no longer crowds out a big one.
- The saved library filter no longer arrives too late to be applied, which
  showed libraries you had disabled for the rest of the session.
- "Recently played" no longer pads itself with albums you have never played.
- Offline search ranks by what actually matched: an artist by name comes before
  one that merely has a song with that word in the title.
- One search history per account instead of one per mode, so the same artist no
  longer shows up twice with only one of them opening.
- Album, artist and playlist screens keep a way back while they load or fail.
- Playback survives the screen turning off.
- Seeking works on streams the server transcodes on its own.
- A profile's settings, pins and downloads are no longer wiped by another
  profile's.
- Multi-disc albums keep their order and disc subtitles offline.
- The cover swipe no longer wraps past the ends of the queue.
- The cover and controls no longer jump when the player opens.
- The progress bar recovers after a track changes with the app in the
  background.
- Casting a lossless track to a speaker that only takes MP3 — Sonos among
  them — no longer fails outright, and a speaker that waits to be told to
  play is now told, instead of sitting silent while the app showed it
  playing.
- The same speaker no longer appears twice in the cast list.

## [0.5.4] - 2026-07-24

### Added

- The Russian translation is now complete.

### Changed

- Resonus is now released under the GPL-3.0-or-later license, so anything built
  on it stays free under the same terms.

### Fixed

- A long value on the right of a settings row squeezed the label until it
  wrapped one letter per line. Most visible in Russian, where the strings run
  longest.

## [0.5.3] - 2026-07-24

### Added

- Blurred cover art as a background for the player and the lyrics screen.
- Show non-square artwork whole instead of cropped to a square.
- Swap the player's favourite and ⋯ buttons, putting the menu within reach.
- Album and year on their own line in the player.
- Refresh a playlist from its ⋯ menu, so smart playlists pick again.
- Close a song's ⋯ menu by swiping it down.
- A ⋯ menu on Favourites, with the same actions as a playlist's.
- Italian translation, and fixes to the Russian one.

### Changed

- Player, Quality & playback and Appearance settings regrouped by what they
  affect.
- The artist's shuffle now covers the whole discography, not just top tracks.
- Dragging the player down reveals the screen behind it.
- Library chips scroll when they don't fit.

### Fixed

- "Appears on" was empty on servers that list collaborations in the discography.
- Playlist covers were replaced by a track's album art offline.
- Starting a mix from the current song restarted it.
- The "playing from" header vanished once Android killed the app.
- Queue covers blinked on every track change.
- Headphone next/previous buttons now skip through the queue.
- Casting finds devices more reliably, and fixes the volume overlay and
  skipping from a Bluetooth device.
- Various smaller fixes and polish throughout.

## [0.5.2] - 2026-07-22

### Added

- Russian translation.

### Fixed

- Big performance fix: opening an album, artist or playlist no longer freezes
  the app while it saves a copy of your library for offline. This was the main
  reason the app felt laggy or "stuck" on large libraries, and it got worse the
  more you browsed — those writes are now batched instead of happening on every
  screen. Going offline is much faster too.
- Switching between online and offline no longer wipes the whole cache, so
  screens you've already opened come back instantly.
- The mini player and song lists re-render far less while music is playing,
  cutting jank when the track changes while you're looking at a list.

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

[0.5.2]: https://github.com/juananzzz/resonus/releases/tag/v0.5.2

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
