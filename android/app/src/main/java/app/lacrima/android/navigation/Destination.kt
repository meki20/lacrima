package app.lacrima.android.navigation

import app.lacrima.android.model.Media
import app.lacrima.android.model.MediaKind

sealed interface Destination {
    data object Home : Destination
    data class Browse(val kind: MediaKind, val genre: String? = null, val page: Int = 1) : Destination
    data object Yours : Destination
    data class Search(val query: String = "") : Destination
    data class Title(val media: Media) : Destination
    data object Settings : Destination
    data object Profiles : Destination
    data object Sources : Destination
    data object Stickers : Destination
    data class Player(val media: Media, val chapterId: String) : Destination
    data class Reader(val media: Media, val chapterId: String, val startAtEnd: Boolean = false) : Destination
}
