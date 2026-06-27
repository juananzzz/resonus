// Adaptado de wavio (github.com/Joel-Mercier/wavio, MIT) para Resonus.
package expo.modules.carauto

import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Player de Media3 cuyo estado lo alimenta JS (pista actual + estado de
 * reproducción) y cuyos comandos de transporte se reenvían a JS vía eventos
 * `transport` de CarAutoModule. Respalda la MediaLibrarySession con la que habla
 * Android Auto, de modo que el mini-player y la pantalla "Now Playing" del coche
 * reflejan la reproducción real (expo-audio) sin un segundo motor de audio.
 */
@OptIn(UnstableApi::class)
class JsProxyPlayer : SimpleBasePlayer(Looper.getMainLooper()) {

  data class NowPlaying(
    val id: String,
    val title: String?,
    val artist: String?,
    val album: String?,
    val artworkUrl: String?,
    val durationMs: Long,
  )

  @Volatile private var nowPlaying: NowPlaying? = null
  // Cola + índice actual reflejados desde JS. Cuando no está vacía, el player la
  // expone como su playlist para que la vista de cola de AA muestre toda la
  // colección. nowPlaying sigue siendo la fuente de verdad de los metadatos
  // (puede traer una versión más refinada de queue[index]).
  @Volatile private var queue: List<NowPlaying> = emptyList()
  @Volatile private var currentIndex: Int = 0
  @Volatile private var playing: Boolean = false
  @Volatile private var positionMs: Long = 0L
  @Volatile private var positionUpdatedAt: Long = System.currentTimeMillis()
  @Volatile private var shuffle: Boolean = false
  @Volatile private var repeatMode: Int = Player.REPEAT_MODE_OFF

  private val mainHandler = Handler(Looper.getMainLooper())

  // SimpleBasePlayer exige su hilo de aplicación (main). Las llamadas de JS caen
  // en el hilo JS, así que saltamos al looper main antes de mutar + invalidar.
  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
  }

  fun applyNowPlaying(np: NowPlaying?) = runOnMain {
    nowPlaying = np
    if (np == null) {
      playing = false
      positionMs = 0L
    }
    positionUpdatedAt = System.currentTimeMillis()
    invalidateState()
  }

  // Placeholder optimista que se aplica en cuanto el usuario toca una hoja
  // navegable en Android Auto, antes de que JS termine de resolver + arrancar la
  // reproducción. Cambia el spinner "buscando" de AA por los metadatos de la
  // pista tocada; el now-playing real desde JS refinará duración/artista luego.
  fun applyTappedItem(node: BrowseNode) = runOnMain {
    nowPlaying = NowPlaying(
      id = node.id,
      title = node.title,
      artist = node.subtitle,
      album = null,
      artworkUrl = node.artworkUrl,
      durationMs = 0L,
    )
    playing = true
    positionMs = 0L
    positionUpdatedAt = System.currentTimeMillis()
    invalidateState()
  }

  fun applyQueue(items: List<NowPlaying>, index: Int) = runOnMain {
    queue = items
    currentIndex = index.coerceIn(0, (items.size - 1).coerceAtLeast(0))
    if (items.isNotEmpty()) {
      val cur = items.getOrNull(currentIndex)
      if (cur != null) nowPlaying = cur
    }
    invalidateState()
  }

  // Movimiento barato de cursor dentro de la cola ya reflejada, para que un
  // salto de pista no necesite reenviar toda la lista desde JS.
  fun applyQueueIndex(index: Int) = runOnMain {
    if (queue.isEmpty()) return@runOnMain
    currentIndex = index.coerceIn(0, queue.size - 1)
    queue.getOrNull(currentIndex)?.let { nowPlaying = it }
    invalidateState()
  }

  fun applyPlaybackState(isPlaying: Boolean, posMs: Long, shuf: Boolean, repeat: Int) = runOnMain {
    playing = isPlaying
    positionMs = posMs.coerceAtLeast(0L)
    positionUpdatedAt = System.currentTimeMillis()
    shuffle = shuf
    repeatMode = repeat
    invalidateState()
  }

  override fun getState(): State {
    val np = nowPlaying
    val q = queue
    // Prioriza la cola empujada por JS. Cae a la playlist optimista de un solo
    // ítem mientras la cola no se ha reflejado aún (p. ej. justo tras un tap).
    val source: List<NowPlaying> = when {
      q.isNotEmpty() -> q
      np != null -> listOf(np)
      else -> emptyList()
    }
    val activeIndex = if (q.isNotEmpty()) currentIndex.coerceIn(0, q.size - 1) else 0

    // Embebe la carátula local como bytes para que el "Now Playing" / cola / card
    // de inicio de AA pueda dibujar carátulas file:// que su proceso no puede
    // leer. Toda la cola viaja en una transacción de estado del player, así que
    // limitamos cuánta carátula embebemos: el ítem actual siempre la lleva (la
    // grande del Now Playing) y el resto se embeben en orden hasta agotar un
    // presupuesto de bytes, tras lo cual caen a la uri (no legible para local,
    // pero pequeña). Mantiene la timeline bajo el límite de transacción binder.
    val builder = ImmutableList.builder<MediaItemData>()
    var artBudget = ART_BUDGET_BYTES
    for ((i, item) in source.withIndex()) {
      val isCurrent = i == activeIndex
      val embed = isCurrent || artBudget > 0
      val used = item.toMediaItemDataInto(builder, embed)
      if (!isCurrent) artBudget -= used
    }
    val items = builder.build()

    val extrapolated = if (playing) {
      positionMs + (System.currentTimeMillis() - positionUpdatedAt)
    } else {
      positionMs
    }

    val commands = Player.Commands.Builder()
      .add(Player.COMMAND_PLAY_PAUSE)
      .add(Player.COMMAND_PREPARE)
      .add(Player.COMMAND_SET_MEDIA_ITEM)
      .add(Player.COMMAND_CHANGE_MEDIA_ITEMS)
      .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
      .add(Player.COMMAND_SEEK_TO_MEDIA_ITEM)
      .add(Player.COMMAND_SEEK_TO_NEXT)
      .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
      .add(Player.COMMAND_SEEK_TO_PREVIOUS)
      .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
      .add(Player.COMMAND_SET_SHUFFLE_MODE)
      .add(Player.COMMAND_SET_REPEAT_MODE)
      .add(Player.COMMAND_GET_CURRENT_MEDIA_ITEM)
      .add(Player.COMMAND_GET_METADATA)
      .add(Player.COMMAND_GET_TIMELINE)
      .build()

    return State.Builder()
      .setAvailableCommands(commands)
      .setPlayWhenReady(playing, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
      .setPlaybackState(if (np != null) Player.STATE_READY else Player.STATE_IDLE)
      .setPlaylist(items)
      .setCurrentMediaItemIndex(if (items.isEmpty()) 0 else activeIndex)
      .setContentPositionMs(extrapolated.coerceAtLeast(0L))
      .setShuffleModeEnabled(shuffle)
      .setRepeatMode(repeatMode)
      .build()
  }

  // Construye el ítem de timeline y lo añade a [out]. Devuelve el nº de bytes de
  // carátula embebidos para que quien llama presupueste la transacción binder
  // del estado del player; cuando [embed] es false la carátula cae a su uri.
  private fun NowPlaying.toMediaItemDataInto(
    out: ImmutableList.Builder<MediaItemData>,
    embed: Boolean,
  ): Int {
    val metadata = MediaMetadata.Builder()
      .setTitle(title)
      .setArtist(artist)
      .setAlbumTitle(album)
      .setIsBrowsable(false)
      .setIsPlayable(true)
      .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
    val used = CarArtwork.apply(metadata, artworkUrl, embed)
    val mi = MediaItem.Builder()
      .setMediaId(id)
      .setMediaMetadata(metadata.build())
      .build()
    out.add(
      MediaItemData.Builder(id)
        .setMediaItem(mi)
        .setDurationUs(if (durationMs > 0) durationMs * 1000 else C.TIME_UNSET)
        .build()
    )
    return used
  }

  private companion object {
    // Tope de carátula de cola embebida por push de estado (~768KB), dejando
    // margen bajo el límite de transacción binder (~1MB) para el resto de la
    // timeline (títulos, ids, duraciones).
    const val ART_BUDGET_BYTES = 768 * 1024
  }

  override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
    CarAutoModule.instance?.emitTransport(
      if (playWhenReady) "play" else "pause",
      null,
    )
    return Futures.immediateVoidFuture()
  }

  override fun handlePrepare(): ListenableFuture<*> = Futures.immediateVoidFuture()

  override fun handleSetMediaItems(
    mediaItems: List<MediaItem>,
    startIndex: Int,
    startPositionMs: Long,
  ): ListenableFuture<*> = Futures.immediateVoidFuture()

  override fun handleAddMediaItems(
    index: Int,
    mediaItems: List<MediaItem>,
  ): ListenableFuture<*> = Futures.immediateVoidFuture()

  override fun handleSeek(
    mediaItemIndex: Int,
    positionMs: Long,
    seekCommand: Int,
  ): ListenableFuture<*> {
    when (seekCommand) {
      Player.COMMAND_SEEK_TO_NEXT,
      Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM ->
        CarAutoModule.instance?.emitTransport("next", null)
      Player.COMMAND_SEEK_TO_PREVIOUS,
      Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM ->
        CarAutoModule.instance?.emitTransport("previous", null)
      Player.COMMAND_SEEK_TO_MEDIA_ITEM ->
        CarAutoModule.instance?.emitTransport("seekToIndex", mediaItemIndex.toDouble())
      else ->
        CarAutoModule.instance?.emitTransport("seek", positionMs.toDouble())
    }
    return Futures.immediateVoidFuture()
  }

  override fun handleSetShuffleModeEnabled(shuffleModeEnabled: Boolean): ListenableFuture<*> {
    CarAutoModule.instance?.emitTransport(
      "shuffle",
      if (shuffleModeEnabled) 1.0 else 0.0,
    )
    return Futures.immediateVoidFuture()
  }

  override fun handleSetRepeatMode(repeatMode: Int): ListenableFuture<*> {
    val v = when (repeatMode) {
      Player.REPEAT_MODE_ONE -> "one"
      Player.REPEAT_MODE_ALL -> "all"
      else -> "off"
    }
    CarAutoModule.instance?.emitTransportString("repeat", v)
    return Futures.immediateVoidFuture()
  }
}
