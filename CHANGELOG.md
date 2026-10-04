# Changelog

All notable changes to Resonus are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before 0.2.1 are only listed on the
[GitHub releases page](https://github.com/juananzzz/resonus/releases).

## [Unreleased]

## [0.8.1-beta.1] - 2026-10-04

### Added

- The player's ⋯ menu always opens the queue, and devices and speed when their buttons are hidden (#248).
- An optional Queue button at the top of Home, off by default.
- An empty queue offers to bring over the server's saved queue.

### Changed

- Screens redraw less, so scrolling and the player should feel smoother.

### Fixed

- Local M4A and FLAC files show their titles, artists, albums and covers (#249).
- Casting to a TV moves on to the next song on time with the screen off (#246).
- On phones that freeze apps in the background, the player no longer shows the old song for seconds on return (#192).
- Offline, a song whose cover is not downloaded no longer breaks the lock screen and the car.

## [0.7.14] - 2026-10-03

### Added

- The update prompt sums up what the new version brings.

### Changed

- The player shows only the Devices and Queue buttons by default.

### Fixed

- Starting an album no longer refetches the whole Android Auto library.
- The diagnostics report no longer counts frames while the app is in the background.
- Home redraws its album cards less often.
- Genre cards load their covers with one request each, even with several libraries.
- Long queues redraw fewer rows when the song changes.
- With several libraries on Navidrome, album lists load in one request instead of one per library.
- Lyrics redraw only when the line or the word changes.

## [0.7.13] - 2026-10-02

### Added

- Settings > About > Share diagnostic report, for bug reports.
- The diagnostics report counts late frames per screen and row redraws.
- Remixers show up as artists, with their remixes under Appears on (#215).

### Changed

- Settings drop descriptions that only repeated the option.
- Settings > Appearance shows the chosen theme mode.
- The app always reopens where you left it; the Keep where you were switch is gone (#225).

### Fixed

- Fragmented M4As no longer stop after two seconds (#242).
- Offline, songs not on the phone are greyed out again.
- Offline changes no longer go to another profile's account.
- Offline listens are no longer scrobbled twice.
- One profile's albums and playlists no longer leak into another's offline library.
- Skipping while casting no longer leaves the speaker on the previous song.
- Casting retries a track the TV refuses while another is playing (#246).

## [0.7.12] - 2026-10-01

### Added

- Brazilian Portuguese, thanks to @vicsantus (#240).
- Settings > Home chips has a switch on top that turns every chip on or off at once.
- Settings > About can export your settings to a file and import them on another phone or someone else's, without accounts or passwords (#243).

### Changed

- The chips and the quick grid on Home start turned off on a new install; existing setups keep theirs.
- The greeting and buttons at the top of Home scroll away with the rest instead of staying pinned.
- The buttons under the player controls are spread across the width by default on a new install.
- The Ukrainian translation is complete again, thanks to @albedych (#245).

### Fixed

- Opening Search no longer makes the page jump down a moment after it appears.
- A cover opened full screen is now shown with square corners, whatever the cover corners setting (#241).
- Dragging the seek bar in a fragmented M4A, such as the ones many downloaders save from streaming services, no longer starts the song over (#242).
- Home no longer offers the song paused on this same phone as playing on Resonus.
- "Don't remind me" on the battery optimization warning now keeps it from coming back on the next launch (#238).

## [0.7.11] - 2026-09-27

### Added

- Settings > Theme lets you make an accent color of your own, next to the palette, with a color picker and a hex code.
- A scheduled theme in Settings > Theme, light from one hour and dark from another.
- Settings > Player lets you choose the size and alignment of the lyrics.
- The names under the navigation bar icons can be hidden.
- The mini player can show next, previous and next, or no button beside play instead of the heart, and its progress bar can be hidden.
- Tapping the time at the right of the seek bar switches between the song's length and the time left.
- Settings > Appearance lets you make the corners of every cover in the app square, rounded or more rounded.
- Podcasts: search for a show or paste its feed, and its episodes play from Explore, a Home chip and a Recent episodes row on Home, with no server needed (#239).
- Gapless playback on iOS (#237).

### Changed

- Settings drop the descriptions under options whose name already says what they do.
- The light theme is no longer experimental.
- The player buttons no longer take the hue of the background shade.
- The dark theme is called just Dark, without (default).
- The rows of each settings section sit in one card, under smaller headings.
- The colour at the top of an album or playlist fades into the page more smoothly.
- The blur behind the navigation bar and the one behind the mini player are now two separate switches, the second in Settings > Player next to Colored mini player.
- Settings > Appearance groups Explore sections and Folder browsing under Explore, and Quality & playback puts Keep screen on and the battery warning under System.
- The times under the progress bar are lighter and easier to read over the cover (#237).
- On iOS the keyboard, alerts and system sheets follow the app's theme instead of the phone's (#237).
- More of the app is translated to Italian (#237).

### Removed

- The Typewriter font. A profile that had it goes back to the default one.
- Resonus links, for now: sharing them from the ⋯ of an album, artist or playlist, and opening them.

### Fixed

- Pulling the player up from the mini player no longer shows its title, controls and cover jumping into place.
- On iOS, seeking in FLAC, MP3 and other non-M4A files lands where you asked, and the animated cover's blurred backdrop no longer smears at the edges nor stutters on the lock screen (#237).
- In the light theme, the Android navigation bar buttons are dark instead of white on white.
- In the light theme, the fade under an artist photo and under the animated cover no longer passes through a grey band.

## [0.7.10] - 2026-09-26

### Added

- Settings > Player > Bottom row can spread the buttons under the player controls across the width with equal gaps, instead of grouping them in the middle.
- Sign out in Settings is now Change profile, since the password is kept and the next screen is the list of saved profiles.

### Fixed

- Going back from an album, a playlist, Favorites or an artist fades straight into the screen before instead of flashing an empty page first; the bar at the top of those screens is a solid colour again rather than blurred.
- The player opens in one piece, with its cover already in place, instead of the cover and the stars arriving a moment after the rest, and the controls no longer shift when the next song has no album or no audio details (#155).
- Pulling down for the search box in a playlist, an album or Favorites no longer leaves a grey strip at the top of the screen.
- The play icon sits in the middle of its button instead of a little to the right.

## [0.7.9] - 2026-09-25

### Added

- Settings > Theme > Pure black puts the dark appearance on a true black background, for OLED screens.
- A gray accent colour, after the rest in Settings > Theme.
- Settings > Theme > Background picks the shade of the greys in the dark and light appearances: blue, the new default, the neutral grey from before, purple, green, warm, teal, rose or olive.
- The navigation bar, the mini player and the bar at the top of albums, playlists and artists blur what scrolls under them, with a hairline marking where the navigation bar starts, on iOS and on Android 12 or newer, and Settings > Appearance > Blur behind the bars turns it off.
- Swiping the mini player up brings the player up with your finger, and letting go early sends it back down.
- Settings can be a tab in the navigation bar, turned on in Settings > Appearance > Navigation bar.
- Home shows what is playing in your other apps and devices on the same account, like Feishin on the computer, or paused or left there, with a button to carry on here from where it was, on Navidrome and other OpenSubsonic servers. Settings > Appearance turns it off.
- On Android, a heart on the notification, the lock screen and Android Auto adds the song playing to your favorites or takes it out.
- On Android 13 or newer, Resonus shows up in the system's per-app language settings, and a language chosen there or in the app is the same everywhere.
- On Android, a Now playing widget for the home screen in two sizes, a strip and a square with the cover filling it, both with previous, play and next buttons, a Resonus tile in Quick Settings to play and pause, and Shuffle favorites, Continue listening and Search on a long press of the app icon.
- Share Resonus link, in the ⋯ menu of albums, artists and public playlists, sends a resonus:// link that opens it in the Resonus of someone with an account on the same server, asking which profile to use when more than one fits; pasting the link into Search opens it too (#176).
- Settings > Downloads > Song cache keeps a copy of the songs you stream, up to a size you choose, so they play again without using data or a connection, and the next song in the queue is fetched ahead so it plays from the phone; Cached songs lists them and deletes them one by one or all at once (#180).
- Transcode lossless files only, in Settings > Quality & playback and in Settings > Downloads, streams or downloads MP3, AAC, Opus and other lossy files as they are and only transcodes files like FLAC (#216).

### Changed

- New icons throughout the app, from Phosphor.
- Text is lighter throughout the app, with only action buttons left semibold, and the dark theme sits on greys with a touch of blue instead of neutral ones.
- Album and playlist headers carry more of the cover's colour, further down the page, and the player lets more of it through behind the controls.
- The navigation bar stays on every screen by default; Settings > Appearance > Always show the navigation bar turns it back to the tabs only.
- The chips at the top of Home scroll away with the page instead of staying on screen.
- The mini player floats as a card, with rounder corners, a soft shadow and a little air above the navigation bar.
- The quick access tiles at the top of Home have rounder corners, with the cover flush against them.
- Settings cards have rounder corners, and the lines between their rows are finer and start where the text does.
- The account at the top of Settings is a card, with offline mode as a switch and signing out as a row in it, instead of the two black buttons at the bottom, and the category names are lighter.
- Search boxes are fully rounded throughout the app, like the one for adding songs to a playlist.
- Home shows its name next to the buttons at the top, like Explore and Your library, and the greeting starts off.
- Search opens on your recent searches instead of the genres, which stay in Explore, and says what it searches when there are none yet.
- The row under the player controls has lyrics, playback speed and a sleep timer that shows the minutes left, next to devices and the queue, and Settings > Player > Bottom row turns each one on or off and puts them in any order.
- The play button and the progress bar take the hue of the background shade chosen in Settings > Theme, and on the light theme the controls are a deep tone of it instead of black.

### Fixed

- Resonus uses less data and battery on Android: the song lists for Android Auto are only fetched on phones that have been connected to a car, and a signal change on mobile data no longer makes the app check the server again (#221).
- A car connected by Bluetooth gets each song's cover along with its title, instead of only for the first song (#139).
- A long title on the queue screen, like the German one, no longer runs under the buttons next to it (#232).
- On iOS the lock screen and the Dynamic Island show the song's length and progress while the server transcodes it, instead of --:--.
- A suggested track previewed in a playlist stops when you leave the playlist, put the app in the background or play something else, instead of playing on with no way to stop it (#234).

## [0.7.8] - 2026-09-23

### Added

- Your library can show Favorites and your playlists again when no chip is pressed, instead of everything mixed together, with Settings > Appearance > Start on your playlists (#217).
- Lyrics timed word by word light up each word as it is sung, from TTML or enhanced LRC files on Navidrome 0.63 or newer, on Jellyfin, or next to your own music, and downloads keep them for offline (#165).
- An album shows its description under its name, as a playlist already did, taken from the overview on Jellyfin or from the comment tag the album's files share, and the switch for it is now Settings > Appearance > Song lists > Show description (#223).
- Diagnostics counts every request made to the server, says how the time since it started measuring splits between the screen being on and the app being away, and how much of that time away the app was actually being run (#221).
- Settings > Appearance > Keep where you were leaves the app on the screen you left when you come back to it, instead of going to the tab it opens on; it starts off, which is what it has always done (#225).
- Swedish, thanks to @NickWick13 (#228).
- A playlist ends with a few suggested songs picked from the ones already in it, each with a preview you can listen to before adding it and a Refresh button for others, from @Anakin-bb8 (#227).
- Settings > Appearance > Font can load a .ttf or .otf file of your own, from @Anakin-bb8 (#227).
- Home has a Random songs section, off to begin with, under Settings > Appearance > Home sections (#227).

### Changed

- You can pin up to 50 items instead of 25 (#217).
- A long playlist or album description is cut to two lines with a Show more under it, instead of filling the whole header (#223).
- The Artists, Albums and Songs lists remember the order you picked instead of going back to Recently played every time you open them (#226).
- Most played songs on Home is a list of songs three to a column instead of a row of covers (#227).
- Lyric lines already sung stay lit instead of fading back out (#227).
- The name of an album or playlist sits centred in the bar that appears when you scroll down it (#227).
- The progress bar of the mini player is a little thicker and rounded (#227).

### Fixed

- Deleting a playlist or a radio station, or taking an album out of your favourites with its heart, no longer leaves a hidden pin that still counts toward the limit (#217).
- Previous goes to the track before in the album or playlist that is playing, and only back to what you played before it once you reach the first track (#219).
- On a UPnP or Sonos speaker the volume starts from the speaker's own level and follows changes made on it, instead of jumping near full at the first press (#218).
- Offline, a track with its own embedded cover shows it in the album, the queue and the player instead of the album's, also for albums downloaded before 0.7.7 (#214).
- On Navidrome 0.64 or newer, albums, artists and playlists with no artwork show Resonus' own placeholder instead of Navidrome's, and are no longer asked for it.
- A Sonos queue that failed to load part way is sent again in full the next time, instead of being taken as already there (#220).
- Casting to a UPnP or Sonos speaker goes back to the phone, paused where it was, when the phone moves to mobile data or loses the network, but not when only the internet drops (#220).
- A playlist you have never played no longer rises to the top of the home grid for having been created or edited recently on the server (#222).
- Songs play and covers show again on Jellyfin 12, where browsing worked but nothing would play (#229).
- A failed Jellyfin sign-in explains why in the app's language instead of always in Spanish.
- On iOS the fonts in Settings > Appearance > Font apply, and Share, Go to artist, Go to album and Song information in the menus open (#227).

## [0.7.7] - 2026-09-13

### Added

- Chips under the search box narrow the results to songs, artists, albums, playlists or radio. They show up as soon as you type, and pressing the one already lit gives you everything back.
- An animated cover can fill the player behind the controls, with a still copy of it beside the title, instead of playing inside the square; it starts off, under Settings > Player > Cover art, and comes from @Anakin-bb8 (#190).
- Ukrainian is complete again, thanks to @albedych (#191).
- The sections of Explore can be shown or hidden as well as reordered, from Settings > Appearance > Explore sections. The last one on stays on: Explore is the only way into the whole of a library, so a tab with no chips would be a catalogue with no way in.
- A playlist can be a favourite, with the heart its albums and artists already have. It needs Navidrome 0.64 or newer, which is where playlist favourites start existing, and the heart simply isn't there on a server that has no way to remember it.
- Polish, a complete translation, thanks to @pegaz19803-spec (#200). It also made the Language screen's own three lines translatable, which they were not in any language: they were English sitting in the code.
- Navidrome 0.64 gives every song, album and playlist a new id, and the music already on the phone is filed under the old ones. Resonus now notices a server that has renumbered and rewrites the downloads, the offline library, the queue, the pins and the listens still waiting to be sent, so nothing has to be downloaded again. It only acts on proof: the server has to answer to the new id and refuse the old one, since a song that was simply deleted looks the same from outside. A server that has not migrated is left alone.

### Changed

- Home opens with every section on. Five of them used to start off to keep it short, which mostly kept them secret: a section nobody has seen is one nobody knows to look for in the settings. Turn off what you do not want from Settings > Appearance > Home sections. Anyone who has already set these keeps what they chose.
- "Your library" opens on everything you have, playlists, favourite albums and favourite artists in one list saying which is which, and the chips narrow it from there instead of being the only way to see any of it.
- The chip you press in "Your library" is now the only one left in the row, behind an X that gives the whole library back, and Playlists brings Yours and Public with it, each when it has something to leave out; picking one of those leaves the two words sitting together as one answer.
- The search box of Explore is now behind the same magnifier "Your library" has, at the top right, where it becomes the X that puts the box away; Back closes it too, and a section opens on its list rather than on a box you were not looking for.

### Fixed

- "On cover tap" keeps what you picked. "Go to album", "Play or pause" and "Add to favorites" were thrown away when the app reopened and came back as "Open lyrics screen"; the same went for the double tap, which came back off unless it was set to play/pause or favorites. Reported by BrawlReturns.
- An animated cover no longer stutters in the player: only the copy you are looking at plays, and the blurred background behind it holds still.
- The popular songs on an artist's page are that artist's, where two of them share a name. They were asked for by name alone, so whichever one the server happened to reach first answered for both.
- "Start mix" works with repeat turned on. It used to answer that it could not find anything to mix with the song, whichever song it was, and nothing had been looked for: the queue never runs out with repeat on, so the search that fills a mix was skipped before it began. Starting a mix now also turns repeat off, the way it already turned shuffle off (#197).
- A downloaded track with a sleeve of its own shows it offline, instead of the record's. Its picture was never saved, so offline had nothing to show but the album's; downloading now brings it along, and a track without one still gets the album's as before. Albums already on the phone keep the album cover until they are downloaded again (#214).
- The colour an artist's page is tinted with comes from their photo and not from the grey square standing in for it while the server is still looking the photo up, which it could keep doing for as long as the picture stayed in the cache.

## [0.7.6] - 2026-08-26

### Added

- The row playing in a list shows a set of bars that move while it plays and settle when you pause it.
- One tap and two on the player's artwork now offer the same actions, the album among them, so play or pause on one and the lyrics on the other is a choice you can make either way round.
- Holding a playlist on the Home shelf opens the same menu the library gives it (#182).
- The tabs at the bottom can be reordered, and all but Home hidden, from Settings > Appearance > Navigation bar.
- A fourth tab, Explore, holds everything the server has: all albums, all artists, all songs, the genres, the radio stations and the folders, each with its own search and orders.
- Italian is complete again, and Explicit, Clean and Lyrics read as Italian instead of English, thanks to @Anakin-bb8 (#189).
- On iOS the app wears an icon of its own, also from @Anakin-bb8 (#189).
- Playlists are the first section of Explore, with their own search, order and rows-or-cards button, so the server's public ones are reachable from the tab that holds its catalogue.
- The icons at the top of Home can be reordered, and all but the gear hidden, from Settings > Appearance > Home buttons. There is a new one among them, a search button that opens the box with the cursor already in it; it starts off, since searching already has a tab of its own.

### Removed

- The setting that picked which actions a song's ⋯ menu shows: every action is back in it, and each one is still only there when it applies.
- The avatar on Home, and the setting that showed it: it was never a button, and the account is one tap away behind the gear beside it.

### Changed

- Song, album and artist rows dim under the finger, late enough that scrolling past one never lights it up.
- Corners are rounder throughout, sheets and panels most of all. Covers keep the corner they had: letting it grow with the artwork ate into the picture on the big ones.
- Every sheet rises with the same rounded top; half of them used to be less rounded than the other half.
- The library tab is now called "Your library", at the bottom of the screen and at the top of the tab itself.
- The row of chips on Home is now called "Home chips" and not "Explore chips", which named the Explore tab it has nothing to do with; the order you put them in survives the rename.
- "Pick up the queue from other players" starts on, so a queue left on another device is taken as well as sent; it was only ever sent before (#188).
- Albums and artists start as rows rather than as a grid, in Explore and anywhere else they are browsed, and the view button still switches them.
- "Your library" is the last tab at the bottom rather than the third, behind Explore, and it can still be dragged anywhere from Settings > Appearance > Navigation bar.
- Browsing all albums, all artists and all songs picks its order from a menu that says which one is on, instead of a scrolling row of pills, and the albums and the songs gained play and shuffle beside it.
- A genre card now says how many albums it holds and fans out the covers of its first two, in Search and in the genres screen alike.
- The album and year line in the player scrolls when it does not fit, so a long album name no longer keeps the year off the screen (#183).
- Folders moved out of Your library and into the new Explore tab, which is where the rest of the server's own catalogue now lives.
- Settings > Appearance > "Open the app on" can pick the new tab.

### Fixed

- "Add to queue" puts what you add at the end of the queue, where "Play next" already put things right after the current song (#184).
- The queue's headings say where each stretch of it came from, instead of leaving songs you added under the name of a record none of them are on (#184).
- The dropdowns in Settings open flush against their row again, instead of a status bar's height below it.
- Opening Your library for the first time no longer draws it under the status bar for an instant before dropping it into place.
- "New releases" shows the newest records instead of a slice of the alphabet: the list goes by the day each record came out, and by when it reached the server for those tagged with a year and nothing more.
- Offline mode no longer looks for a new version of Resonus by itself, since asking GitHub is still using the network somebody said not to use (#179).
- The queue Resonus saves on the server no longer overwrites a newer one another player left there, and a queue that has only been restored, never played, is not sent at all (#188).

## [0.7.5] - 2026-08-24

### Added

- The local profile can read from more than one folder, added and removed in Settings > Local music, and adding one reads the tags of the new folder only instead of the whole library again (#158).
- Home can show a "New releases" shelf, off by default in Settings > Home sections, with the albums ordered by the year they came out rather than by when the server got hold of them (#173).
- The theme can follow the phone's own light or dark setting, from Settings > Appearance > Theme, and changes with it while the app is open (#173).
- The accent colour is now remembered per appearance: the swatches set the colour of the theme you are in, and switching between dark and light brings back the one chosen there (#173).
- The queue another player left on the server can be brought over from the ⋯ of the queue screen, and taken on its own with the new switch in Settings > Playback: with it on, opening the app with nothing playing picks up that queue when it is the newer of the two.
- Tapping the player's artwork twice can play, pause or favourite the song, from a new setting in Settings > Player that starts off (#156).
- An album, a playlist or the favourites can be played next from their ⋯ menu, instead of only going to the end of the queue.

### Fixed

- The server's Now Playing panel follows the song instead of sitting at 0:00: the position was only reported when something changed, so a track nobody touched stayed at the second it started on.
- Dragging the progress bar now moves the time under it, so the number says where you are about to land instead of where the song still is.
- On iOS the buttons to skip to the next and the previous song work from the lock screen, the Dynamic Island, Bluetooth and the car, where they were greyed out, thanks to @Anakin-bb8.
- On iOS the accent colour reads the whole cover instead of a sample of it and takes the colour the cover is made of, so a green sleeve no longer comes out grey, thanks to @Anakin-bb8.
- The sleep timer's "When the song ends" no longer leaves the player describing one song while holding another: the track it stops on is the one that plays when you press play again (#177).

### Changed

- The local profile no longer keeps its library in memory: it asks its catalog for the rows a screen is about to draw, the way a server's downloads already did, so opening the app and moving around it stop costing what the whole library costs.
- The local profile no longer stops at five thousand songs per folder: what is left is a guard against a scan pointed at a whole card, far above any music library, and a scan that ever reaches it says so in Diagnostics instead of quietly leaving the rest out.
- Folders are followed ten levels deep instead of six, so a library filed under more folders than usual is read whole.

## [0.7.5-beta.1] - 2026-08-22

### Added

- The player can show a card with the artist's photo and biography below the controls, off by default in Settings > Player, thanks to @Anakin-bb8.
- Italian is much more complete: over 140 strings that were missing or read unnaturally, thanks to @Anakin-bb8.
- A selection of songs can be exported to a folder, or have its downloads deleted, from the ⋯ of the selection bar (#164).

### Changed

- The selection bar keeps two buttons and a ⋯ that opens the rest, so favouriting and unfavouriting several songs at once are finally somewhere you would look for them, instead of hidden in the "Add to a playlist" sheet (#164).
- Headings and screen titles are lighter: Android draws Roboto's 800 as a real ExtraBold, which closes the letters up, so they sit at 600 instead.
- The genre grid on Search no longer carries a "Browse all" heading above it.
- Expo SDK 57 and React Native 0.86 underneath, with media3 unchanged at 1.9.0.

### Fixed

- Casting to an ordinary UPnP renderer no longer stops after a few tracks with the screen locked: the queue and the move to the next track now live in the native module, which keeps running while Android suspends the app's JavaScript, and the next track is handed to the renderer in advance where it supports it.
- Listens saved while offline reach the server on reconnect: the upload read the outbox as it was before the file on disk was opened, so a queue restored on a cold start went up empty.
- ALAC files play on devices whose own decoder cannot handle them, several Samsung phones among them, through a bundled decoder that only steps in when the system refuses the format (#134).
- Casting to Sonos survives editing the queue: moving the song that is playing, or any row around it, is now mirrored on the speaker instead of leaving the connection unable to play, pause or seek for the rest of the session.
- Sonos turns off shuffle in one piece: the whole queue goes back to album order, not just the part after the song playing.
- Skipping to another song already in the Sonos queue is immediate, because the queue is no longer torn down and sent again song by song.
- Crossfade set in Resonus is passed on to Sonos, both on connecting and when the setting is changed while casting.
- The last song in the queue no longer sits under the navigation bar: the screen clears whatever height that bar actually has instead of guessing a fixed gap, which fell short with three-button navigation.

## [0.7.4] - 2026-08-19

### Added

- **Editing the whole queue:** the song playing and the ones behind it are dragged and removed like any other row, so a queue can be trimmed into shape without jumping elsewhere first (#157).
- **Favorites from the add-to-playlist sheet:** picking songs and choosing to add them offers Favorites above the playlists, and the row is gone when they are all favorites already.
- **Sorting a discography:** the full lists an artist's shelves open into have a sort button beside the view one, with year or name in either direction, and the choice is remembered.

### Changed

- **Cold start:** the saved track goes into the player as the app opens again, so Play answers the first press; what waits is the handful of requests behind it, which is what the opening was actually spending its second on.

### Fixed

- **The player assembling itself on open:** it remembers what it measured last time, so the artwork is there with everything else instead of turning up a fifth of a second later (#155).
- **Headers that stuttered while music played:** the artist photo, the album cover fading out and the bar coming in follow the scroll from the native side now, so they no longer wait behind whatever the app is doing twice a second (#154).
- **A song that will not play:** the player now hears the failure instead of sitting on it, so a stream cut off by a bad connection or a download that is no longer readable is answered with the other copy of the song, then with a second go, and only then with a message.
- **A stream that stops arriving:** fifteen seconds of a song that is not coming in, with the album downloaded on the phone, and the file takes over from where it stopped.
- **Downloads that are not there:** one whose file has gone stops being offered by the catalog the moment the player finds out, instead of being promised by its badge for good.
- **Artists offline:** their picture is downloaded along with their music and what kind of record each release is no longer gets lost on the way into the catalog, so the artist page is the same one after closing the app.
- **The artist's two names:** an artist opened by the id the other mode uses — a recent search made online, a downloaded album offline — lands on their page instead of on an empty one.

## [0.7.3] - 2026-08-17

### Added

- **Light theme:** experimental, in Settings › Appearance › Theme, with dark still the default.

### Changed

- **Local profile:** it no longer wears a phone icon in Home's header.
- **All releases in the artist menu:** it is offered whatever their records are tagged as.

### Fixed

- **Bold text:** Android's setting no longer cuts words off, at the price of the app's text no longer following it.
- **Player navigation:** the app no longer freezes after opening an artist or an album from the full player and then tapping the mini player.
- **Deleted playlists:** one removed on the server stops showing in Home's quick grid and in the car's Recents (#152).
- **Update checks:** "Check for updates automatically" asks again at most every six hours, instead of once per app process.
- **Tapping a search result:** it opens with one tap while the keyboard is up, in Search and in the lists with a filter box.
- **Cold start:** the app opens without waiting on the server.
- **Restored track:** it goes back into the player once the app is up, at the position it was left at.
- **Large libraries:** the download catalog is read in pages, so opening with tens of thousands of songs is no longer one long freeze.
- **Seeking from the car:** it no longer kills the sound a few seconds later, which was the app giving up the audio focus every time the player stopped to buffer.
- **Dragging the car's progress bar:** it no longer springs back to where the song was before.
- **Saved queue:** press play and it starts where it was left, instead of from the beginning.

## [0.7.2] - 2026-08-15

### Added

- Playback speed, from half to double, and the song keeps its pitch (#151). Its button sits under the player controls and starts off, in Settings › Player.
- The chips on Home can go without their icons and be their name alone, in Settings › Explore chips.

### Fixed

- The app no longer freezes on the way back out of album → artist → album → the same artist. Going to a screen already open stopped moving it up the history, which is what left the screen painted but dead to the touch.

## [0.7.1] - 2026-08-15

### Added

- Casting the music on the phone. The local profile could not cast at all; it serves its own files now, seeking included.
- The cover of a local album reaches the speaker's screen.
- The sleep timer follows the music onto a Sonos speaker, and repeat travels in both directions. Thanks to @garrit-schroeder (#149).
- The E next to a title, for anything tagged with a parental advisory. Turns off in Settings › Appearance › Song lists.
- An artist's ⋯ menu offers All releases, the discography as one list again.
- A FAQ, reachable from Settings › About.

### Changed

- The icons in the ⋯ menus are all outlined. The heart still fills when the song is a favourite.
- The local profile stops offering what it can never use: streaming quality, autoplay, downloads, export, rating, mixes, the Genres and Radio chips, and folder browsing.
- Favorites opens on Recently added, which is what that order is.
- The orders that are the server's idea of recently played say so.
- The devices button is never disabled. Downloads cast from the phone now.
- An artist whose records are all of one kind gets that kind as the heading.

### Fixed

- Albums in Android Auto opened onto nothing. Plugging in a car now fetches what the tree is missing, and starred albums are fetched first.
- Songs on the phone whose cover every other player finds and Resonus did not. The tag reader was too strict for what real files contain. Reported by @kshbeat28-ui (#141).
- A queue cast to Sonos and then changed drifted away from the app's. Thanks to @garrit-schroeder (#149).
- Jellyfin was told it was talking to version 1.0 of something on a device called Android. Thanks to @garrit-schroeder (#150).
- Two quick taps on the bar at the bottom opened two players. Opening something already open brings it forward.
- The Home grid mixed the profiles, and leaving one through the login screen carried its recents into the next.
- One downloaded song in the queue was enough to leave a Sonos playing none of it.
- A file on the phone was announced to the renderer as MP3 whatever it really was.
- Going offline while casting left the cast on with no way to end it.
- The Playlists source of the quick grid was greyed out as though there were none without a server.
- Favorites in the local profile came back alphabetical instead of by when each one was marked.

## [0.7.0] - 2026-08-13

What to try first is the car. Android Auto was taken apart and rebuilt from the
root down: three tabs instead of two, covers instead of lists of words, and
every row that leads somewhere carrying an icon. Home is a shuffle button that
plays on the tap and two shelves of records underneath. Recents is what you
listened to last, whatever kind of thing it was. What needs a real car to
confirm is the pausing and the resuming, so try those before anything else.

Sonos works too, and it never had. The reason was not a bug so much as a wrong
assumption: a speaker that is not the coordinator of its group refuses to be
told what to play, and Resonus was telling whichever one you tapped. The whole
UPnP layer was rebuilt around that — finding devices, talking to them and
reading a Sonos system's own idea of which rooms are grouped with which — by
@garrit-schroeder, who also brought Jellyfin's session reporting. Rooms can now
be joined to what is playing and taken out again from the output sheet itself.

Playlists and starred albums were reaching the car empty. A library kept
offline has every cover stored as a local file, and those cannot be read from
outside the app, so each one travels inside the item that carries it; twenty
of them at full size is more than a single transaction can hold, and the
system drops the whole answer rather than part of it. They go at tile size
now, within a budget, so a long list arrives even if the last covers in it do
not.

Pausing from the car stopped nothing but the screen. The pause is what waits
on the end of the volume fade, and a fade is a timer, and timers stop running
once the phone puts the app to sleep in your pocket. So the head unit said
paused while the speakers kept going, and pressing play afterwards started the
song at volume zero, with the progress bar moving and nothing coming out.

Two more things had been quietly broken. Scanning the whole phone in the local
profile found nothing at all, on every phone, since the move to Expo SDK 56:
the media library kept the old function names as stubs that warn and then
throw, so nothing stopped compiling and the scan simply came back empty.
Changing the cover of a playlist or a radio station failed the same way, from
the same kind of change — the multipart upload was built with React Native's
own file part, which the new networking layer does not accept, and the failure
looked exactly like the server being unreachable.

Resonus also tells you when there is a new version, and installs it for you.
The artist screen holds every song by an artist in one list. And a discography
sorts into every kind of record MusicBrainz defines rather than six, with empty
shelves never drawn, so an artist with one demo and one remix album gets those
two rows and no others.

### Added

- Android Auto: a Home tab that starts music without choosing anything, a
  Recents tab of what was played last, and a Library of playlists and starred
  albums as grids of covers.
- Shuffle and repeat on the car's playback screen, lit to match what the
  player is actually doing.
- Casting to Sonos, and grouping: a room can be added to whatever is playing or
  taken out of the group, from the output sheet (#121).
- Jellyfin reports what is playing to the server, so Resonus shows up in its
  dashboard, and plays are counted against the app's own listen threshold.
- Resonus checks for new versions and installs them from inside the app. The
  prompt links to what changed. Under Settings › About, and it can be turned
  off.
- Every song by an artist in one list, and their records split into shelves:
  albums, EPs and singles, and every other release type MusicBrainz defines —
  soundtracks, remixes, DJ-mixes, mixtapes, demos, broadcasts, spoken word,
  interviews, audiobooks, audio dramas and field recordings.
- Rate an artist from its ⋯ menu, and reach the artist from an album's.
- Keep playback paused when skipping tracks, off by default, in Settings ›
  Player.
- Order the albums of a genre the way playlists are ordered, direction and
  all, on Navidrome and on Jellyfin. Most played is among the options here and
  in Albums, Songs and Artists.
- Home shelves say Show all and land on the list they came from. Most played
  songs and Random artists lead somewhere too, and holding a song opens its
  menu.
- Diagnostics says how the cover of what is playing was arrived at, and what
  the player was doing while the app was minimized.
- Russian, German and Catalan are complete for this release.

### Changed

- The car's browse tree is three tabs rather than a menu of four words, and
  what a driver taps is covers rather than the names of folders.
- Playlists and starred albums are ordered by what was played last, and the
  songs fetched ahead of time follow that same order.
- Playing something from the car is written down as recently played, which it
  never was, so it shows up in Recents, in the Library's order and in the
  phone's grid.
- The output picker looks like the rest of the app: outputs are a list with the
  one playing marked, and the search line only claims to be searching while it
  is.
- A playlist's sort says Default and Recently added, which is what those two
  orders are called everywhere else. Default is honest about smart playlists
  too, where the order is the server's and not yours.
- Restoring the default settings is drawn in red, like the other actions that
  cannot be taken back.
- The update prompt hands the version number over bare, so a language can put
  its own word for "version" in front of it.

### Fixed

- Playlists, starred albums and search results opened onto nothing in the car
  when the covers were stored offline (#140).
- Pausing from the car left the speakers playing, and resuming from it played
  silently with the progress bar moving (#140).
- Every track reached the car, the watch and the Bluetooth stack under the
  same empty name, so a head unit that decides whether to fetch the cover
  again by that name never fetched a second one (#139).
- Warming the next track hung up at four seconds, which on some servers
  undid the warm entirely and left the track to be fetched from scratch
  (#137).
- Scanning the whole phone in the local profile found no music at all, on any
  phone, since 0.6.5.
- The cover of a playlist or a radio station could not be changed, on any
  server.
- The heart and the ⋯ menu disappeared from the player, and stayed gone until
  the queue was replaced.
- The blurred background jumped back to the cover you started from when
  skipping through a queue, and the player could show the cover of the track
  that had just finished after a spell away from the app.
- The server's own speakers had no row in the output sheet, so jukebox mode
  could not be reached.
- A renderer that rejects FLAC gets offered MP3 instead of being given up on
  (#70).
- A tag read that came back short left the cover out of a scanned file.
- Reading whether a Jellyfin server is there is one request again, not two.
- One untagged record no longer undoes the whole split of an artist's
  releases.
- The multi-select bar and the toast sit above the mini player instead of
  under it, and the bar no longer hangs in the air when nothing is playing.
- The play button follows the chosen accent again, and so does the select-all
  tick on a genre.
- The search box gives up focus when you leave the tab, and pressing Search
  while already there puts the cursor back in it.
- Most played agrees with what it is counting.

## [0.6.5] - 2026-08-10

Underneath everything else, this release moves the whole app onto Expo SDK 56
and React Native 0.85. Everything native was rebuilt on top of that, including
the five modules Resonus has of its own and the patched audio engine.

The rest is mostly what the app was telling the notification, the lock screen
and the car, which for a while was nothing at all whenever the player decided
something by itself. A track the server transcodes sat at 0:00 for its whole
length, a repeat or a gapless jump left the progress bar at the end of the
song, and the cover could be the one from the track that had just finished.
Android Auto can be searched now, and Shuffle went back to meaning shuffle.

### Added

- Search in Android Auto, including "play <something>" by voice, answered
  natively from the browse tree so it works with the screen off and with no
  connection. Reported by @dayofr (#103).
- Playlists in the car's Library, with the songs inside each one, so they can
  be browsed and not only played whole.
- A Home shelf for the songs played most, as songs rather than as the records
  they came from. Off until you turn it on, in Settings › Home sections. Asked
  for by a user.
- Seeking from the notification, the car and the lock screen on a stream the
  server transcodes on the fly. Such a stream has no seek table, so those
  controls drew a bar nobody could drag; the app gets there by asking the
  server for the stream starting at that second.
- Genres can be saved, ordered and counted. A genre page says how many albums
  and songs it holds, has the same actions row as an album or a playlist, and
  can be downloaded whole after counting what it really weighs.
- Ordering a genre's songs and albums, where the server can do it, which today
  means Navidrome through its own API. Elsewhere the control is simply absent:
  an order that only sorts the page you happen to have loaded is not one.
- A "While minimized" section in Diagnostics, measuring the player's own
  heartbeat and how stale it was the moment you came back. Needs "Measure
  performance" turned on.
- A switch under Diagnostics for the repair that follows a server renumbering
  its ids (Navidrome 0.64). Off until it has met a server that really migrated.

### Changed

- Expo SDK 56, React Native 0.85, React 19.2.3, and media3 1.9.0 underneath
  the audio.
- Shuffle on an album, playlist, artist or from a long press deals the queue
  instead of turning on shuffle mode, which is remembered between sessions and
  left the next thing you played shuffled too. The mode stays in the player.
- The lyrics card under the player controls starts off. It shows up when you
  turn it on.
- The warning about adding songs already in a playlist says the numbers, and
  "Add anyway" moved over the confirm. Raised by @ztx-lyghters (#132).
- The quality badge names the codec a stream is being turned into, and shows
  up when a codec is forced on a file that was already under the bitrate
  limit, which is a transcode it used to keep quiet about.

### Fixed

- The progress bar in the notification, the lock screen and anything else
  reading the media session, for a track the server transcodes on the fly.
  Seeking one no longer leaves it counting from zero either. Reported by
  @Trip7274 (#135).
- The notification, the lock screen and the car no longer show the cover,
  title and album of the track that has just ended when the player moves on to
  the one queued behind it by itself.
- The progress bar no longer sits at the end of a song that is repeating, or
  of one the player joined the next track to.
- Repeating one song over a transcoded stream no longer replays only its last
  few seconds forever, and no longer skips "stop at end of song".
- The play button, on a phone that is not on normal ringer. The ringer switch
  is about being interrupted, not about the album you just pressed play on.
- Requests made while the app is in the background no longer hang forever,
  which is why a lyrics lookup could stop coming back with the screen off.
- A song put next, or added to the queue, is warmed up in advance like the
  rest. Preloading only ever went out on a track change, so the song somebody
  had just asked for was the one nobody had requested ahead. Reported by a
  user (#137).
- Tapping a song no longer shows one and plays another, which happened when a
  queue was rewritten while the track was loading.
- Songs that are not on the phone no longer look playable in offline mode, in
  any list, and playing a list that cannot load no longer leaves the app
  showing one song while the speakers are still on the last one. Both reported
  by @ztx-lyghters.
- The cover comes back when the app does, and no longer disappears from the
  player after coming back from the queue or the lyrics, taking the swipe
  between tracks with it. Reported by @ztx-lyghters.
- The Library's search bar and the new-playlist dialog open with the keyboard
  up.
- The quick grid on Home shows what you played even when the server has not
  caught up with it.
- The player no longer settles into place a moment after opening.
- The shuffle button of an album or a playlist lights up when what is playing
  is that list, shuffled.
- Emptying the queue no longer forgets shuffle and repeat after a restart.
- Android Auto is told how to draw the top level of the browse tree. The hints
  were being set where the car never reads them.
- The icon and the launcher show the same drawing at the same size.
- Two questions the app asks a server on the first track are no longer asked
  twice each.

## [0.6.4] - 2026-08-08

This one is mostly about listens, and about the app not deciding things on
your behalf.

What counts as a listen is yours to set now, on a screen of its own under
Quality & playback, and the reporting around it has been taken apart and put
back together. A listen the network refuses is kept instead of dropped, which
matters most on a profile with nothing downloaded, since that one never enters
offline mode at all and every song played away from the network used to
disappear. The outbox no longer loses what it was handed in the seconds before
it had finished loading. And the server hears the pause, so a song stops
standing in the Now Playing panel long after you stopped it.

Shuffle stays on. Two separate things were turning it off by themselves,
emptying the queue and tapping any album, so a setting that survives closing
the app was lost to the most ordinary thing there is.

The rest is a lot of small ground. Playlists tell one copy of a song from
another, so removing one row removes that row, and adding a list that overlaps
offers to add only what is missing. Every grid gets a menu instead of a
two-state toggle, rows or cards two, three or four across, and each screen
keeps its own choice. The language can be changed from the sign-in screen,
before there is a profile to change it in. German is complete, Simplified
Chinese has arrived, and the player no longer tells you which of your files is
the good one.

### Added

- Adding songs to a playlist that already has some of them offers to add only
  the ones that are not in it yet. The warning had one way forward, putting
  every one of them in a second time, so the only way to add the rest without
  duplicating anything was to work out which were which by hand. It is a third
  button rather than a switch inside the warning: a switch is state to read and
  understand before pressing a button that no longer does what it says. Asked
  for by @ztx-lyghters (#132).

- When a song counts as played is now yours to set, on a screen of its own in
  Settings › Quality & playback › Scrobbling. Two rules, a share of the song and
  a plain time, either of which can be turned off, and the earlier one is what
  fires. The defaults are what the app has always done, half the song or four
  minutes, and there is a button to put them back. With both off nothing is
  reported at all, not even to your own server, which is also a thing somebody
  may want. Asked for by @ztx-lyghters (#126).

- How a grid is laid out is a menu now, on a genre's albums, on the three chips
  off Home and on an artist's discography. The button in the header used to
  flip between the only two things it could say, and on a wide screen, or for
  anybody who would rather see more at once, two across was simply the wrong
  number. It opens rows, or cards two, three or four across, with a tick on the
  one you are looking at, and choosing a density while the rows are showing
  brings the cards back, so it stays one gesture. Each screen keeps its own
  choice, and every one of them starts where it already was, so nothing moves
  for anybody until they ask. The icon shows where you are rather than what one
  more tap would give you, which is how a button that opens a menu reads. What
  it costs is the flip between rows and cards, which was one tap and is two.
  Library still has the old toggle. Asked for by @ztx-lyghters (#109).

- Simplified Chinese. Thanks to @xcdmrCHP (#133).

### Changed

- The language can be changed from the first screen, before signing in. It was
  only in Settings, which is behind a profile, so somebody who could not read
  the sign-in screen had to get past it in a language they do not speak in
  order to change the language of it. The button sits in the corner and says
  the current language in its own name, and the list gives each one in its own
  too.

- The player's header names the queue while a song you added by hand plays.
  "Playing from" described how the queue was built rather than what is playing,
  so queueing one song left it announcing an album that song is not in. It says
  "Queue" for as long as that song lasts and goes back to the source, with its
  link, on the next one that is not yours; tapping it opens the queue, since
  that is where the header now says the song comes from. The mark goes on the
  song rather than on the queue, so it undoes itself and survives a restart,
  and a song added inside a mix no longer passes for the seed the mix was grown
  from. Not the "Custom queue" that was proposed: naming the source that is
  playing and then letting it go keeps the way back to the album for the rest
  of the queue. Asked for by @ztx-lyghters (#65).

- Restoring every setting has moved to the bottom of Settings › About. It was a
  row in the Settings index, styled like the categories above it, which made it
  look like one more place to go into rather than something that happens when
  you touch it, and it sat directly over the pill that puts the app in offline
  mode, which is the one people press on their way out of the house. About is
  where it belongs anyway: it reaches every setting instead of any one
  category, and the screen is already the app talking about itself. The
  confirmation it always had comes with it.

- German is complete, and reads better than it did: the strings that were still
  in English are translated, and a good number of the ones that were not have
  been reworded to say the same thing in plainer German, with the technical
  words swapped for the ones people use. Thanks to @CraftoHohenvels.

- The player no longer labels a song "Lossless" or "Hi-Res". The line under the
  cover still says the format, the bitrate and the sample rate, which is the
  same information without the verdict on top of it. The argument, made by
  @ztx-lyghters and @CraftoHohenvels on Discord, is that the badge tells whoever
  already reads sample rates nothing they cannot see, and tells everybody else
  that one file is simply better than another, which is how a person ends up
  filling a phone with copies they cannot hear the difference in. Contributed by
  @CraftoHohenvels (#125).

### Fixed

- Removing one copy of a song that is in a playlist twice removes that one,
  not both. Selecting was done by song, not by row, so with the same track in
  the list more than once every one of its rows was the same row: ticking one
  ticked them all, and the remove that followed took all of them, leaving none
  where there should have been one. Rows are told apart by which time the song
  appears now, which is what the queue screen already did. Reported by
  @ztx-lyghters (#132).

- The server hears the pause too, not only the first note. The classic API can
  only say that a track has started, so Navidrome gave that entry the rest of
  the track to live and never heard another word: pausing, emptying the queue
  or closing the app all left the song running in its Now Playing panel until
  it would have ended. Servers that announce the OpenSubsonic `playbackReport`
  extension now get the state and the position instead, and the states are read
  from the player itself rather than hooked onto each action, so the six ways
  of pausing that the app already has are all covered. A server without the
  extension keeps the announcement, which is all the classic API can say, and
  Jellyfin reports sessions its own way and is unaffected. Reported by
  CuteDragon on Discord.

- "Report a bug" in About opens the bug form, with the version already in it.
  It landed on the page that asks which kind of issue this is, which is the one
  question the button had already answered, and then asked for the version,
  which is the form's one required field and the one thing the app knows for
  certain. A report that arrives with a guess at it costs a round trip to find
  out it was fixed two releases ago.

- Listens are kept again when the connection drops mid-song. The previous
  release had them go to the outbox instead of being dropped, and that never
  ran: the network error it was waiting for was being swallowed one layer down,
  in the call itself, so the listen looked as though it had gone up and nothing
  was ever queued. The call reports what happened now, and the "now playing"
  announcement, which really is disposable, says so where it is made.

- The share button stops disappearing for the rest of the session. Whether the
  server lets an account share is asked once and then remembered, since the
  answer does not change while the app is open, and a lookup that failed to
  reach the server was being remembered as "this account cannot share". One bad
  moment, and there is a window for exactly that between a server going away
  and the app noticing, took the button off every song menu until the app was
  reopened, in online mode with everything else working. A server that answers
  and says no is still a no; a connection that never got there is now a failure
  that is tried again.

- Lyrics opened part way through a song scroll to the line that is playing
  straight away, instead of sitting at the top until the song moves on a line
  and only then travelling. The scroll waits to be told where that line is, and
  the lines report it into a place that re-renders nothing, so when the answer
  arrived nobody was listening any more and the next line change was the first
  thing to run it again. The measurement now says so itself, and the journey is
  the same animated one as any other. Reported by @juananzzz.

- The player stops jumping when it opens with the star rating on. The row of
  stars is measured on the first pass and its height is taken off the cover, so
  until it had been measured the cover was drawn a row too tall and then shrank,
  taking the stars with it. The cover was already held back until its slot was
  settled; the stars were not, and they were shown from the first frame, which
  is why they were the part that visibly moved. Both now wait for the same
  thing, and there is one place that decides when that is. Reported by
  @juananzzz.

- Starting a mix stops saying it found nothing while the mix plays. Loading the
  song sends one round of the search off on its own, and "start mix" then asked
  again so it could tell you whether anything turned up: the second ask saw the
  first had already claimed that song and came back empty, which is what the
  message was reporting, a moment before the first round arrived and filled the
  queue. It now waits for the round already in the air, so the answer is the
  real one. Reported by @juananzzz.

- Shuffle stays on. Two things were turning it off by themselves: emptying the
  queue, through a rule written for changing account, where the modes belong
  with the profile that is leaving and its own saved queue; and starting any
  album or playlist, which played it in order however the button was set. So a
  setting that survives closing the app was lost to the most ordinary thing
  there is, which is tapping an album. A list started with shuffle on is now
  dealt: the song you tapped plays first and the rest follow in a new order,
  the same as the button does, and turning shuffle off puts the album back in
  its own order. Reported by @ztx-lyghters (#102).

- A song played away from the network reaches the server when it comes back,
  even if the app never noticed it had lost it. Listens were only put in the
  outbox while offline mode was on, and that mode is a guess: it takes two
  failed probes to change its mind, and it will not change it at all on a
  profile with nothing downloaded to fall back to. Every listen in that gap
  went to a request nobody was waiting on and disappeared the moment it failed,
  which is a whole trip's music on a profile without downloads. A listen the
  network refuses now goes into the same outbox an offline one goes into, with
  the time it happened. Reported by @CraftoHohenvels and confirmed by
  @ztx-lyghters (#126).

- The outbox stops losing what it was given before it had finished loading.
  It is read off disk a few seconds after launch, and until then it wrote
  nothing and then replaced whatever had piled up in memory with the file that
  did not know about it. A queue restored mid-song can cross the halfway mark
  in those seconds, so it was a real listen each time.

- On Jellyfin, a favourited artist no longer says it has no albums. Jellyfin
  does not put counts on an item unless they are asked for, and nothing asked,
  so every artist arrived without one and every row read "0 albums": in
  favourites, in the library, in a search and under similar artists. The four
  requests that fetch artists now ask for the count, and the artist's own screen
  takes it from the albums it has just fetched, so that one is right whatever
  the server fills in. Reported by @jaredm4 (#129).

- Turning the Wi-Fi back on brings the app back online. It went offline by
  itself when the connection dropped, which was the half that worked, and then
  stayed there: a rule added to stop the mode flapping made it hold still for a
  minute after every change, and the moment the server answered again fell
  inside that minute. The switch was refused, nothing asked a second time, and
  the app sat in offline mode with the Wi-Fi visibly back on until it was
  reopened. Coming back is no longer held back at all, and the rule still does
  its job, since a return only ever follows a fall and the fall is still gated.
  A fall that does get held back is now retried instead of dropped. Found from a
  diagnostics report by @juananzzz on 0.6.3 (#122).

## [0.6.3] - 2026-08-05

This one is mostly about what the app does when the server is not there.

Nothing disappears from Settings any more. Streaming quality and its codec,
everything about downloading, autoplay, folder browsing, the chips on Home:
all of it used to vanish without a connection, so looking for a setting meant
walking through every screen that could plausibly hold it before working out
that it had never been there. It all stays in its place now, dimmed and not
answering. Server addresses go one better and still work, because a wrong
address is exactly the kind of thing that puts the app offline, and that screen
was hidden behind the problem it exists to fix.

Falling to offline mode notices more, too. It used to look only when the app
started and when the phone's network changed, and a VPN going down while you
were away is neither, so coming back left the app asking a server that was not
there. And a downloaded song can be dragged through: a download made at a
bitrate is a transcode with no index in it, and the player was answering every
seek by starting the track over, in the car as well as in the app.

The rest is tidying. Streaming settings are two named sets, Wi-Fi and mobile
data, instead of four rows you told apart by reading to the end of each label;
Appearance is a screenful shorter; the lyrics screen comes with the blurred
artwork behind it, like the player it opens from; and "Playing from" stops
naming an album once the queue has grown past it into a mix. Casting to a Sonos
that is grouped, or is one half of a stereo pair, should work, fixed without a
Sonos to try it on.

### Added

- A way to support Resonus, at the bottom of Settings › About. The app asks for
  nothing to work and that is not changing; this is one row, out of the way of
  everything else, for whoever wants to.

### Fixed

- Dragging the slider on a downloaded song no longer starts it again from the
  beginning. A server transcoding on the fly writes into a pipe, so what comes
  out is a bare run of frames with no index in it: Navidrome's AAC is raw ADTS,
  and an MP3 made that way carries a header it never got to go back and fill
  in. Downloading at a bitrate saves exactly that on the phone, and the player
  will not seek a file it cannot index. It answered every seek by starting the
  track over, in the app and in the car alike. Those files are now seeked by
  working out where a second lives from the length of the file and the bitrate,
  which is only consulted when the file itself offers nothing better, so
  anything with a seek table of its own keeps using it. Downloads made without
  a bitrate limit are the server's own file and were never affected. Reported
  by @CraftoHohenvels (#123).

- Automatic offline mode also looks when the app is opened again. What makes a
  server unreachable usually happens while nobody is watching —a VPN dropped, a
  tunnel expired, a server rebooted— and none of that changes the phone's
  network, so the watcher that probes on a network change never heard about it,
  and the only other probe runs when the app starts. An app whose process
  outlived the trip was left asking a server that was not there: the spinner,
  and then the message saying it could not be reached, with the downloads
  sitting right there. It now probes when the app comes to the foreground too,
  a probe asked for while another one is running is no longer dropped but run
  after it, which is exactly when a screen asks for one, and one asked for
  before the session has been read off disk waits for it instead of being
  thrown away. Reported by @CraftoHohenvels (#122).

- Casting to a Sonos speaker that is grouped, or is one half of a stereo pair,
  should work. Those speakers are driven through one of them, and the others
  are perfectly happy to be discovered, to appear in the list and to answer for
  their volume, and then refuse to be handed a track: casting to whichever one
  was not in charge failed every time with nothing to say about why. Which one
  it is comes from the group topology, which is now asked for, and only after a
  refusal, so a speaker that took the track never pays for the question. A
  renderer that turns down the track description is also offered the track
  without it, since the description is what tells it the track is audio and not
  a video, and it is better to lose it than the song. Reported by @hui1848
  (#121), fixed without a Sonos to try it on.

- The battery optimization warning stops coming back after leaving a profile and
  going back in. It is meant to ask once per launch, and answering it, or
  turning it off in Settings › Playback, is meant to be the end of it. But it is
  only on screen with a profile open, so it was built again on the way back in,
  and at that moment the settings on hand are still the ones of the profile that
  left, or the factory ones: it asked again, against an answer it could not see.
  It now counts the launch rather than the screen, and the settings say plainly
  that they are not the new profile's yet until they have been read.

- The player stays at the same height from one song to the next. The room for
  the lyrics card peeking below was only kept for songs that actually had
  lyrics, so skipping through a queue where some do and some don't resized the
  cover and slid the title, the slider and the controls up and down on every
  track. The room is now kept for every song that could have lyrics, and what
  is under a song without them is a strip of empty background, which is quieter
  than the whole screen moving.

### Changed

- Streaming settings come in two named sets, Wi-Fi and mobile data, instead of
  four rows in a row that you told apart by reading to the end of each label.
  The labels keep saying which network they are about, since a row read on its
  own still has to. What decides whether a downloaded song streams at all, and
  the preloading, now come first: they are not about either network, and under
  a heading they would have looked like they were.

- Settings › Appearance is shorter. What a song shows in a list, seven switches
  with a line of explanation each, was a screenful sitting in the middle of it,
  between the language and the navigation bar, so everything below was a scroll
  away for anyone who had not come looking for exactly that. It is now a row
  that opens its own screen, "Song lists", like the quick grid and the home
  sections already were.

- The lyrics screen comes with the blurred artwork behind it, the same as the
  player it opens from, instead of the flat tint. Only for a profile that has
  never said otherwise: anyone who picked a background keeps the one they
  picked, in Settings › Player.

- "Measure performance" comes switched off, and no longer explains itself. It
  is turned on when somebody is being walked through a slowdown, and until then
  it was measuring for a report nobody was going to send. Same rule as above:
  a profile that already has it on keeps it on until it is turned off.

- "Playing from" says the mix once the queue has become one. When an album or a
  playlist runs out, autoplay keeps it going with similar songs, and from the
  moment one of those starts the header was still naming the album: songs that
  are not in it, under a heading that was also a link, so tapping it walked to
  a place that had nothing to do with what was sounding. It now reads "Mix of
  «song»", after the song the mix was grown from, and stops leading anywhere
  until the queue goes back into the album. The queue screen separates the two
  the same way, with the mix under its own heading. Skipping back into the
  album puts the album's name back, and a queue extended with more albums by
  the artist you were listening to keeps naming the artist, because that is
  still where it comes from. Asked for by @ztx-lyghters (#65).

- Settings keep every setting where it is without a connection, greyed out
  instead of taken away. Streaming quality and its codec, everything about
  downloading, autoplay, the devices button, folder browsing, the playlists of
  the quick grid, the chips on Home, "Start mix" and "Rate" in the song menu:
  all of them vanished offline, so looking for one meant walking through every
  screen that could plausibly hold it before working out that it had never been
  there. They now stay in their place, dimmed and not answering, and that is
  all the explaining it takes: a line at the top of each section saying they
  apply once there is a connection said the same thing a second time, so it is
  gone (@ztx-lyghters). The values are still shown, since what they say will
  happen is still what will happen. "Library" goes the same way, dimmed and quiet: everything it holds is
  the server's, and what can be done about downloads with no connection already
  lives in the section above it. Asked for by @jaredm4.
- Server addresses can be reached without a connection, which is the one place
  where being shown is not enough. A wrong address, or a server that moved, is
  exactly what puts the app offline, and Settings › Network was hidden there:
  the way out was to delete the profile and sign in again, or to walk to the
  network the old address works on. It is now a normal screen in offline mode,
  and it works, because checking an address is a ping and that is one of the
  two requests offline mode lets through. Reported by @jaredm4.

## [0.6.2] - 2026-08-04

Offline mode now means it. The rule that the app asks nobody anything without a
connection was repeated at every place that talks to the server, and several of
them had forgotten it: the queue went up every twenty seconds, the addresses
were probed on every network change, the lyrics were looked up, and the covers
of albums you had not downloaded were fetched one by one. On a metered
connection that is somebody's money. The rule now lives underneath, in the one
place that makes requests, where there is nothing left to forget. Browsing
without a connection is only worth as much as the pictures that come with it,
so those covers are now kept on the phone on purpose instead of borrowed from
a cache that throws them out.

The app also stops getting slower the longer you use it. A screen you had left
kept re-rendering behind the one you were on, which is what made the half
second between screens grow as you went, and a tab you had opened once kept
redrawing for the rest of the session.

Jellyfin catches up on three things it could not do: taking songs out of a
playlist, moving around inside a track that is being transcoded, and saying how
far into that track you are on the lock screen.

And what you listen to away from the network reaches the server when it comes
back, carrying the time it happened, so an evening's music lands where it
belongs in the history instead of arriving all at once the minute the phone
finds a signal.

### Added

- When a downloaded song plays from the file is now yours to decide, in
  Settings › Quality & playback. It always played from the file, which is what
  a download is for and what nearly everyone wants, but a library downloaded
  small to save room is a worse copy than the one on the server, and whether
  that matters depends on what the connection costs. So: always, on mobile data
  only, only when the download is the original file rather than a transcode, or
  never. Without a connection the file is used whatever it says, since it is
  the only thing there is. The quality badge under the player follows the same
  answer, so it never claims a smaller copy while playing the good one. Asked
  for by @CraftoHohenvels and @ztx-lyghters.
- A way out of a deep pile of screens. An artist, one of its albums, another
  artist off a track, a genre from there: getting back was four taps, and there
  was no shorter way. Holding the back arrow now drops the whole pile at once,
  and leaves you where you came in: screens opened from the Library end at the
  Library, screens opened from a search end at Search. Not the tab the app
  happens to open on, so nobody lands in a list of albums they never asked for.
  Nothing announces a long press, so for whoever wants the way out in plain
  sight there is "Always show the navigation bar" in Settings › Appearance ›
  Navigation, off by default, which keeps Home, Search and Library at the
  bottom of every screen and clears the stack on the way there too. Raised by
  @ztx-lyghters, and by justtrife in the Discord.
- Shuffle and repeat are still on when you come back. Both were forgotten on a
  cold start, so whoever listens shuffled had to say so again every morning,
  which is not a setting anyone means to give twice. They travel with the queue
  that is already saved for each profile, so they come back with it and with
  the song it was left on. What is not kept is the order the list had before
  being shuffled: it would double what a queue weighs on disk, and turning
  shuffle off after a restart simply keeps the order that is playing instead of
  going back to the album's. Asked for by @ztx-lyghters, on behalf of another
  user.
- What you listen to offline reaches the server anyway. Away from the network
  the play could only be counted on the phone, for its own "Most played", and
  as far as the server was concerned a whole trip's music had never been
  played: nothing in the history, nothing in the counters, nothing scrobbled on
  to Last.fm or ListenBrainz. Each listen now waits in the same outbox that
  already held favourites, ratings and playlist edits, and goes up on
  reconnection carrying the time it happened, so an evening's music lands in
  the right place in the history instead of arriving all at once the minute the
  phone finds a signal. The rule for what counts as a listen has not changed:
  half the song or four minutes, whichever comes first, so skipping through an
  album still inflates nothing. Asked for by @CraftoHohenvels.
- A playlist shows its description, between the name and the line that counts
  the songs and in the same quiet type: what it says about itself belongs with
  the rest of what it says. Whole, however long it runs, because a description
  cut short with the rest hidden behind a tap nothing announces is barely
  better than one not shown at all; whoever prefers the header bare turns it
  off in Settings › Appearance › Song lists. The app could already write that
  field and never showed it. Jellyfin's, which allows markup, arrives as plain
  text. Asked for by @ztx-lyghters.
- Volume normalization has a pre-amp, right under it in Settings › Quality &
  playback and only there while normalization is on. ReplayGain aims at -18
  LUFS and the apps everyone else on the phone uses aim at -14, so turning
  normalization on left the music noticeably quieter than everything around it,
  and the fix was riding the system volume up and down between apps. The slider
  moves the level the whole library normalizes to, from -10 to +10 dB in half
  dB steps, and takes effect on the song already playing; tapping the value
  opens a small pad with arrows that move it a tenth at a time, which is the
  precision a finger on a slider can't reach. A song already close
  to its peak takes less of the boost than asked, because the rest would be
  distortion rather than volume. Asked for by @jaredm4.
- A server address can be edited, in Settings › Network. There was a pencil's
  worth of work missing there: a domain that changes, a server that moves to
  another port, and the only way through it was adding the new address and
  deleting the old one. That worked for every address except the first, which
  could not be deleted at all, and the first is the one an account is most
  likely to have only. It could not be deleted because it was what the profile
  was filed under: its settings, its downloads, its queue and its history all
  hang off that address, so changing it would have hidden the lot. What a
  profile is called is now written down once and kept, whatever happens to the
  addresses afterwards, which is what lets any of them be edited or removed as
  long as one is left. A new address still has to answer with your account
  before it is accepted, same as when adding one. Asked for by @jaredm4.

### Changed

- Counting songs is inflected properly in every language. "{n} songs" was a
  template with the noun written into each translation, so a language whose
  plural is not a simple two-way split could only pick one form and be wrong
  the rest of the time: in Russian a playlist of two read as "2 композиций",
  the form for five and up. It now goes through the same plural forms the rest
  of the app already used, which Russian fills in with three. On a playlist
  card, in the queue's header, under a playlist in search and while a local
  library is being scanned. Reported by @ztx-lyghters.
- "Song information" opens the cover, browses the genre, and lets itself be
  read. The art in its header is the song's own, which on a live album or a
  compilation need not be the album's, and there was no way to see it without
  playing the track: tapping it opens it full screen like every other cover.
  The genre is now the same chips the album header has, so it is somewhere to
  go and not a line of text. And with the list long enough to scroll, pulling
  down to get back to the top was closing the sheet instead: the drag only
  belongs to the sheet at the top of the list now, and the header still closes
  it from anywhere, the way the song menu already worked. Raised by
  @ztx-lyghters.
- Taking a favourite off a song in a list can be undone. The toast that says so
  carries "Undo", and until it goes nothing has been asked of the server, so
  undoing is not a second request but the first one never leaving. In a list
  the heart is small and sits where a finger scrolls, and a tap given by
  accident had to be put right through the song's menu. The swipe gesture goes
  the same way. Elsewhere the heart is on a screen about that one song, artist
  or album, where it is not hit by accident, and it still answers at once, as
  does marking a favourite anywhere. Raised by @ztx-lyghters.
- The app no longer asks for the microphone, the camera or drawing over other
  apps. It never used any of the three: the recording permission came in with
  the audio library, the camera with the image picker (both places that pick an
  image go to the gallery), and the overlay one with the project template,
  where it belongs to React Native's development tools. None of them was a
  hole, since Android asks before granting any of them and the app never asked.
  They were a reason to distrust a music player, which is worse: whoever reads
  the permission list before installing deserves one that only holds what the
  app does. Debug builds keep the overlay so the developer tools still work.

### Fixed

- Offline, an album shows its artist's photo, and its tracks show a cover. The
  covers kept for browsing without a connection were filed under the name each
  thing calls its own picture, and the screens ask for them under other names:
  an album asks for its artist's photo by the artist's id, and a track row asks
  by whatever cover id the server gave that one song, which on some servers is
  a different one per track. Both are answered now, one from the artist's photo
  saved under both its names and the other from the album's cover, which is the
  same picture in all but the rarest case and is one file instead of one per
  song.
- The player leaves no gap under a song that has no lyrics. Room for the
  lyrics card was kept for every song, whether or not there were any to put in
  it, so a song without them sat pushed up with an empty strip below, and
  turning the card off in Settings was the only way to get that space back. It
  is now kept only once there are lyrics in hand: without them, and while they
  are still being looked for, the player looks exactly as it does with the card
  turned off, and the cover uses the room. Lyrics arriving while you are
  looking at the player settle the cover a touch smaller, which is the price of
  not leaving the gap the rest of the time; they are usually found before the
  player is even opened.
- Online lyrics search works again. Every lookup on Android was being turned
  away by LRCLIB with an error, so a song the server had no lyrics for simply
  showed none, whatever the setting said. The app was not saying who it was:
  React Native sends the name of the HTTP library it is built on, and that is
  what was refused. It now introduces itself, which is what their API asks for
  anyway. Nothing about the setting changed; it had never been the setting.
- Lyrics are looked up again when the app has fallen back to offline on its
  own. Making offline mode offline took LRCLIB with it, which is right when
  somebody chose that mode and wrong when the app chose it for them: falling
  back means one server stopped answering, not that the phone lost its
  connection, and the lyrics are somewhere else entirely. Whoever never noticed
  the mode had changed just saw lyrics stop working. An offline you asked for
  still asks nobody anything.
- Tapping a song in the history that is not downloaded, offline, no longer
  leaves the player telling a lie. It could not play, which is right, but the
  queue had already been replaced: the mini player showed that song, and
  pressing play resumed whichever downloaded track had been loaded before it.
  The history now dims what it cannot reach and says so when tapped, like every
  other list, and a queue with nothing playable in it is refused outright
  rather than shown, so whatever was playing keeps playing.
- The history is there offline, and it is the same history. It is written on
  this phone as each song plays and needs nobody to read it back, yet it was
  hidden from Home without a connection, so a screen that worked could not be
  reached. It was also filed by mode rather than by account: everything played
  offline, by any profile, went into one shared list, which is the mixing that
  keeping them apart was for. An account's listening is its own now, connection
  or not. Nothing has been deleted, but plays made offline before this will
  stay where they were, which is the list a local profile shows.
- Search no longer offers what it cannot open offline. "Browse all" laid out
  its genres, or rather the grey shapes of them, and radio stations were
  searched for too: both are the server's to answer, and offline the answer was
  a request that failed, leaving the loading shapes behind. A genre in
  particular has nowhere to go there, since the app keeps no index of them
  without a server. They are simply not offered until there is a connection.
- The covers of what you can browse offline are kept on the phone. They were
  only ever an address on the server, so without a connection they came out of
  the image loader's cache or not at all, and that cache is not the app's: it
  has a size and it throws out the oldest, so on a library of any size the
  shelves were mostly grey squares. Now, while online, whatever is written to
  the offline copy has its cover saved once, small, right next to it. Nothing
  is crawled ahead of time: it follows what you were already looking at, which
  is the same rule the offline copy itself follows, and it goes when that
  profile's data goes. Albums, playlists and artists, which is what the shelves
  are made of.
- Offline mode makes no network requests at all. It was built as a rule
  repeated at every place that asks the server something: each one checked the
  mode and went to the copy on the phone instead. That holds for as long as
  nobody forgets, and several things had: the queue was pushed to the server
  every twenty seconds and every time the app went to the background, the
  server's addresses were probed on every network change and at every cold
  start, lyrics were looked up on LRCLIB, and the covers of albums that were
  not downloaded were fetched one by one, which is what made album art appear
  slowly on a screen that should not have been loading anything. On a metered
  connection that is somebody's money.
  The rule now lives underneath, in the one place that makes requests: with
  offline mode on, a request fails before it reaches the network, and it starts
  that way at launch until the saved mode has been read, so a cold start cannot
  leak either. Forgetting a check somewhere is now a bug that shows itself
  rather than one that quietly uses data. Two things still go out, and both are
  asked for: checking whether the server is back, which is the only way out of
  an automatic offline, and the "test" button in Settings › Network.
  What changes on screen: nothing, in the end. The covers of what you can
  browse offline are now saved on purpose rather than fetched when you look at
  them, so the shelves fill the same way they did (see below).
  Found by @ztx-lyghters with a packet capture, after @aona noticed the album
  art loading.
- A song whose file says nothing about its album no longer files it under
  "Álbum desconocido", in Spanish, whatever language the app is in. The same
  went for an artist. Those two names are how the local library groups what
  arrives untagged, and they doubled as the album's and the artist's id, which
  is why they were never translated: the id is written into the catalog on the
  phone and into the name of every cover saved with it, so changing it would
  have orphaned all of it and forced a rescan. They stay as they are underneath
  and are translated on the way to the screen, so a library already scanned
  reads correctly without being scanned again. Downloads on a server account
  did the same thing and are fixed with it.
- The list of devices to play to no longer offers things that cannot play. A
  search for speakers has to go out to the whole network, so everything on it
  answers, and almost nothing in a house plays music: the router is the usual
  one, since it speaks UPnP to open ports, and for anyone without a DLNA
  speaker it was the only thing on the list. A device is now asked whether it
  can be played to at all, and the ones that answer that they cannot are left
  out. The ones that answer nothing still show: not having been able to ask is
  not a no, and a speaker missing from the list is worse than a router on it.
- Resonus no longer asks the system for the audio the way an interruption
  asks for it. Playing anything requested the audio "for a moment", which is
  what a navigation prompt, a notification or a call asks for, and the request
  never said what it was for. A car reads exactly that to decide which of its
  channels an app belongs on, and the one for something short and unnamed is
  the one calls come out of: the volume shows a phone rather than a speaker,
  and the music arrives with the bandwidth of a phone call. It now asks the way
  a music player does, for as long as the music lasts, and says it is music.
  This is the second half of what 0.6.1 fixed on the same report: the first
  stopped the app from taking over the phone's call route, and the symptom
  stayed. What it changes elsewhere: an app paused to let Resonus play is no
  longer told to expect the audio back, so it will not resume on its own when
  the music stops, which is how every other music player behaves. Reported by
  @CraftoHohenvels and @Anakin-bb8, still to be confirmed from a car.
- Going back a song no longer turns shuffle off by itself. The back button
  restores where you were along with everything that came with it, shuffle
  included, so pressing it after shuffling a list undid the shuffle: the list
  had been reordered underneath, and the position it went back to belonged to
  the order from before. Changing the shuffle of a list now forgets those
  positions, for the same reason starting the list again does.
- Shuffling a list twice left the first shuffle within reach of the back
  button. Pressing "Shuffle play" again builds a new queue, but the old one
  stayed in the history that ⏮️ walks, so going back from the first song
  dropped you into the queue that had just been thrown away, and from there
  the songs that followed were the old ones, not the ones the queue on screen
  showed. Starting a list that is already playing now forgets where you were
  in it, since there is nowhere to go back to: it is the same list. Going back
  to a different album or playlist, the one you were listening to before this
  one, works as it did. Reported by @CraftoHohenvels, and seen on artists too
  by @ztx-lyghters.
- An album's genre chips show every genre it is tagged with. The row stopped at
  six, which is a number a well tagged record reaches without trying, and the
  rest were simply not there: nothing said so, so the album looked like it
  carried fewer tags than it does. There is still a ceiling, at fifty, but only
  so a library with a tag per track can't fill the header with a thousand
  chips; the row scrolls sideways, so however many there are nothing below it
  moves. Two genres on the same track were also being read as one, since only
  the first was taken from each: on Jellyfin the others were dropped as the
  song was read, which left "Song information" showing a single tag as well.
  Reported by @ztx-lyghters.
- The player screen could be scrolled a little with the lyrics card turned off,
  which made it look like something was hanging past the bottom edge. Nothing
  was: the card is the one thing that reaches below the first page, and the
  room left for it at the bottom of the scroll was being kept whether or not
  there was a card to put there. Without one the player is exactly one screen
  tall again and stays put. Reported by @ztx-lyghters.
- "Nothing here is downloaded" greeted a cold start in offline mode. The saved
  queue is restored as soon as the session is, which is before the list of
  downloaded files has been read out of the database, so every song in it
  looked like it was only on the server. The queue now waits for that list,
  and the message is only given when playing was actually asked for, not when
  the app is putting itself back together on its own.
- Songs can be taken out of a playlist on Jellyfin. The track went, the way it
  should, and came back a moment later with "Couldn't complete the action",
  and the server had no record of having been asked anything. It hadn't been:
  removing a song is done by handing the server the playlist as it should end
  up, which is one call in Subsonic and no call at all in Jellyfin, and that
  one request was going out in Subsonic's words to a server that doesn't speak
  them. Jellyfin gets it in three steps instead, over the entries a playlist is
  actually made of. Which also means playlists can be reordered there now, by
  holding a track and dragging it, an option that was hidden on Jellyfin for
  the same reason. Reported by @jaredm4.
- The notification and the lock screen show how far into the song you are while
  streaming transcoded. They showed the times and the progress bar for a file
  arriving untouched and nothing at all for one being converted on the way,
  which is the same song and looks like the controls half broke. A server
  transcoding on the fly can't say how long the result will be before making
  it, so it sends no length, and the player had no duration to hand over. It
  does not need to guess: the app knows the song's length from the library, and
  now passes it along with the title and the cover. Only as a fallback, so a
  file, or anything that does know its own length, still answers for itself.
  Reported by @jaredm4.
- Moving around inside a track works on Jellyfin while streaming transcoded.
  Touching the bar started the song over, every time. A transcode is made as it
  is sent, so there is nothing behind or ahead to jump to: the only way through
  it is asking the server to start the stream at that second instead, which the
  app already did for the Subsonic servers that offer it. Jellyfin has it in
  its streaming endpoint and was never asked, so it kept sending the track from
  the top. Downloads and untranscoded streams were never affected, since those
  can be moved around like any file. Reported by @jaredm4.
- The cover in the player belongs to the song that is playing, however fast you
  swipe. Two or three quick swipes and it settled one track ahead: the cover of
  the song after, with the right title under it and the right music playing,
  and it stayed that way for every song after that. The strip of covers and the
  queue count the same swipes, but not at the same instant: a swipe reaches the
  screen one render later, and one that landed before that render measured its
  travel from a count one behind, leaving the strip parked a cover away from
  where the music was. It now counts them where they happen. A swipe toward an
  end of the queue that has nowhere to go gives the travel back instead of
  counting it. Reported by @ztx-lyghters.
- The app no longer gets slower for the rest of the session the first time you
  open Search. Tabs are never closed once visited, only hidden, so they are
  meant to stop working while you are elsewhere, and they were not: asking for
  a fade between tabs turned that off, quietly and completely, the day it was
  added. Every visited tab kept redrawing on every screen change, and Search
  lays out the whole genre list of the library at once, with nothing recycling
  it, so from the first visit on it was rebuilt on every navigation, on a
  library with hundreds of genres. Both halves are fixed: a tab you are not on
  stops, and the genre grid is built once. The tabs no longer crossfade, which
  is what the fade cost. Reported by @ztx-lyghters.

## [0.6.1] - 2026-08-01

Songs get a place of their own: a chip on Home opens the library's songs with a
search box, rows or covers, and the same orders browsing albums and artists
already had. Which of those the server can actually do varies, so on Navidrome
they are asked of its own API, which is the only way an alphabetical listing of
a large library is possible at all.

Sharing now says when a link should stop working, and on Navidrome whether it
can be downloaded from and not only listened to.

And Resonus no longer takes over the phone's call audio while it plays, which is
what could make music arrive in the car sounding like a phone call.

### Added

- A "Songs" chip on Home, next to Albums and Artists, opening the library's
  songs the way those two open theirs: a search box, rows or a grid of covers,
  the same orders on pills, and infinite scroll. Holding one starts selecting,
  so a playlist can be built out of loose tracks in one go. Sorting them is the
  server's business and not every one can: Navidrome is asked through its own
  API, which sorts and pages a six-figure library a page at a time, and Jellyfin
  and a local library sort by everything too. A plain Subsonic server cannot
  sort songs at all, so there recent, recently added and most played are arrived
  at through the albums it does sort, A-Z is not offered, and its own order
  stands in that place. The chip can be hidden or moved like every other one, in
  Settings › Appearance › Explore chips. Asked for by @rdnamil.
- Sharing asks how long the link should last: never, an hour, a day, a week, a
  month, or a date off the calendar. Choosing is what creates it, so it is one
  tap more than before, and the last answer comes back marked for the next time.
  On Navidrome the sheet also decides whether the link can be downloaded from,
  not only listened to, which is not something the Subsonic API can say and has
  to be asked of Navidrome itself. Asked for by @ztx-lyghters.
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

- "Song information" in a song's ⋯ menu: what the server knows about the track,
  and where there is no server, what its own tags say. Album, year, track,
  genre, format and sample rate, size on disk, plays, rating, and the comment
  tag, which people use for notes about a recording and which nothing in the
  app showed until now. The format reads exactly as it does on the player,
  arrow and all, so a downloaded transcode says the same thing in both places.
  Only the fields the song actually has are listed. It can be hidden like every
  other action, in Settings › Appearance › Song menu. Asked for by
  @ztx-lyghters.

### Changed

- An artist's album rows hold fifty covers instead of ten, and "Appears on"
  got the same "Show all" the discography already had, with its own screen for
  the whole list. Asked for by @ztx-lyghters.
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
- Home's greeting changes over at the hours the language actually uses. The four
  greetings were translated but the clock behind them was Spanish for everybody,
  so English, German, Italian and Russian were told good afternoon at eight in
  the evening. They now switch at midday and at six, which is what those
  languages are closer to, and Spanish and Catalan keep the later hours they had.
  The greeting also changes while the screen is open, which it did not before.
  Translators can ask for their own hours, see TRANSLATING.md.
- "Original" streaming quality says what it actually does. It read as "uses the
  highest quality", which describes a result rather than what happens, and left
  room to read it as the highest the codec can manage or the highest available
  for that track. What it means is that the file arrives exactly as it sits on
  the server, untouched, which is the whole reason to pick it. The warning that
  the other options can cost quality you hear was missing too. Raised by
  @ztx-lyghters.
- Two strings that could not be translated properly. The row that creates a
  local profile said "Local", an adjective with no noun behind it, and now says
  "Local profile", the name that profile carries on every other screen; and
  "Original", the quality option, was written into the app in English and never
  reached the translators. Reported by @ztx-lyghters.

### Fixed

- Resonus no longer claims the phone's call audio for itself. Starting
  playback took over the route calls use, which the app has no reason to touch,
  and it kept it for as long as it was open. On a car that is the kind of thing
  that gets music treated as a phone call, which is what it sounds like: narrow,
  crackly, nothing like the file. It also now says what it plays is music, which
  is what lets Android send it down the low power path instead of mixing it on
  the CPU. Raised by @CraftoHohenvels and @Anakin-bb8.
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
- The lyrics card on the player stopped short of the bottom of the screen,
  leaving a strip of background under it. It now runs to the edge, and the
  controls above it keep their distance from the navigation bar on their own.
  Found and fixed by @Anakin-bb8.
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
