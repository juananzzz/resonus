// Adaptado de wavio (github.com/Joel-Mercier/wavio, MIT) para Resonus.
package expo.modules.carauto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class BrowseNode(
  val id: String,
  val title: String,
  val subtitle: String?,
  val artworkUrl: String?,
  val playable: Boolean,
  val contentStyle: String?, // "list" | "grid" | null
)

object BrowseTreeCache {
  private const val SNAPSHOT_FILE = "carauto_tree.json"
  const val ROOT_ID = "root"

  @Volatile private var nodes: Map<String, List<BrowseNode>> = emptyMap()
  @Volatile private var loaded: Boolean = false
  // Recuerda el último padre navegable que el usuario abrió en Android Auto. Lo
  // usamos al reenviar un evento de play para que JS pueda encolar toda la
  // colección (álbum / lista / sección de inicio) y no solo la pista tocada.
  @Volatile private var lastBrowsedParent: String? = null

  fun setFromJson(context: Context, json: String) {
    val parsed = parse(json) ?: return
    nodes = parsed
    runCatching {
      File(context.filesDir, SNAPSHOT_FILE).writeText(json)
    }
    loaded = true
  }

  // Lo usa el servicio cuando JS aún no ha empujado un árbol en este proceso
  // (p. ej. Android Auto arrancó el servicio por su cuenta).
  fun loadFromDiskIfNeeded(context: Context) {
    if (loaded) return
    loaded = true
    runCatching {
      val file = File(context.filesDir, SNAPSHOT_FILE)
      if (file.exists()) parse(file.readText())?.let { nodes = it }
    }
  }

  fun getChildren(parentId: String): List<BrowseNode> {
    val children = nodes[parentId] ?: emptyList()
    // Recuerda el padre más profundo que realmente contiene hojas reproducibles;
    // esa es la colección que AA estaba navegando cuando el usuario tocó una pista.
    if (children.any { it.playable }) lastBrowsedParent = parentId
    return children
  }

  fun lastBrowsedParent(): String? = lastBrowsedParent

  // Mejor esfuerzo: si la pista tocada vive en un padre conocido, devuelve el id
  // de ese padre. Cae al último padre navegado cuando la pista no se resuelve
  // desde la caché (raro — durante el calentamiento). El lado JS es ahora
  // autoritativo (los mediaIds de pista llevan su padre embebido), así que esto
  // es solo un respaldo para ids antiguos sin padre embebido.
  fun findParentOf(childId: String): String? {
    for ((pid, list) in nodes) {
      if (list.any { it.id == childId }) return pid
    }
    return lastBrowsedParent
  }

  fun debugSummary(): String {
    val root = nodes[ROOT_ID]?.size ?: 0
    return "root=$root totalParents=${nodes.size}"
  }

  private fun parse(json: String): Map<String, List<BrowseNode>>? = try {
    val root = JSONObject(json)
    val nodesObj = root.optJSONObject("nodes") ?: return null
    val map = HashMap<String, List<BrowseNode>>(nodesObj.length())
    val keys = nodesObj.keys()
    while (keys.hasNext()) {
      val k = keys.next()
      val arr = nodesObj.optJSONArray(k) ?: continue
      map[k] = parseList(arr)
    }
    map
  } catch (_: Throwable) {
    null
  }

  private fun parseList(arr: JSONArray): List<BrowseNode> {
    val out = ArrayList<BrowseNode>(arr.length())
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      out.add(
        BrowseNode(
          id = o.optString("id"),
          title = o.optString("title"),
          subtitle = o.optString("subtitle").takeIf { it.isNotEmpty() },
          artworkUrl = o.optString("artworkUrl").takeIf { it.isNotEmpty() },
          playable = o.optBoolean("playable", false),
          contentStyle = o.optString("contentStyle").takeIf { it.isNotEmpty() },
        )
      )
    }
    return out
  }
}
