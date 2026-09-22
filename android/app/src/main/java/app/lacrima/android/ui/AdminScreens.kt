package app.lacrima.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import app.lacrima.android.LoadState
import app.lacrima.android.model.ApiResult
import app.lacrima.android.model.MediaKind
import app.lacrima.android.model.Profile
import app.lacrima.android.model.SourceAdminData
import app.lacrima.android.model.SourceExtension
import app.lacrima.android.model.SourceInfo
import app.lacrima.android.model.StickerSlot
import app.lacrima.android.model.StickerPlacement
import app.lacrima.android.model.StickersData
import app.lacrima.android.ui.theme.Canvas
import app.lacrima.android.ui.theme.Danger
import app.lacrima.android.ui.theme.Surface1
import app.lacrima.android.ui.theme.Surface2
import app.lacrima.android.ui.theme.Text2
import app.lacrima.android.ui.theme.accent
import coil3.compose.AsyncImage

@Composable
fun ProfileManagementScreen(
    profiles: List<Profile>,
    current: Profile?,
    error: ApiResult.Failure?,
    select: (Profile) -> Unit,
    create: (String, String) -> Unit,
    update: (Profile) -> Unit,
    deleteCurrent: () -> Unit,
    dismissError: () -> Unit,
    disconnect: () -> Unit,
    done: (() -> Unit)? = null,
) {
    var createOpen by remember { mutableStateOf(false) }
    var editOpen by remember { mutableStateOf(false) }
    var deleteOpen by remember { mutableStateOf(false) }
    LazyColumn(
        Modifier.fillMaxSize().background(Canvas)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top)),
        contentPadding = PaddingValues(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Profiles", Modifier.weight(1f), style = MaterialTheme.typography.displayLarge)
                if (done != null) TextButton(done) { Text("Done") }
            }
        }
        items(profiles, key = Profile::id) { profile ->
            Surface(
                Modifier.fillMaxWidth().clickable { select(profile) },
                color = Surface1,
                shape = RoundedCornerShape(10.dp),
            ) {
                Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(40.dp).clip(CircleShape).background(accent(profile.avatarColor)), contentAlignment = Alignment.Center) {
                        Text(profile.name.take(1).uppercase())
                    }
                    Column(Modifier.weight(1f)) {
                        Text(profile.name, style = MaterialTheme.typography.titleMedium)
                        Text(if (profile.id == current?.id) "Current profile" else "Switch profile", style = MaterialTheme.typography.bodySmall)
                    }
                    if (profile.id == current?.id) TextButton({ editOpen = true }) { Text("Edit") }
                }
            }
        }
        item { Button({ createOpen = true }, Modifier.fillMaxWidth()) { Text("Create profile") } }
        item { OutlinedButton(disconnect, Modifier.fillMaxWidth()) { Text("Use another server") } }
    }
    if (createOpen) ProfileEditor(null, { createOpen = false }, null) { name, color, _, _ -> create(name, color); createOpen = false }
    if (editOpen && current != null) ProfileEditor(current, { editOpen = false }, {
        editOpen = false
        deleteOpen = true
    }) { name, color, avatar, wallpaper ->
        update(current.copy(name = name, accent = color, avatarColor = avatar, wallpaper = wallpaper))
        editOpen = false
    }
    if (deleteOpen && current != null) AlertDialog(
        onDismissRequest = { deleteOpen = false },
        title = { Text("Delete ${current.name}?") },
        text = { Text("This removes this profile’s library, progress, settings and stickers from the server.") },
        confirmButton = { Button({ deleteCurrent(); deleteOpen = false }) { Text("Delete") } },
        dismissButton = { TextButton({ deleteOpen = false }) { Text("Cancel") } },
    )
    error?.let { ActionErrorDialog(it, dismissError) }
}

@Composable
private fun ProfileEditor(
    profile: Profile?,
    close: () -> Unit,
    delete: (() -> Unit)?,
    save: (String, String, String, String?) -> Unit,
) {
    var name by remember(profile?.id) { mutableStateOf(profile?.name.orEmpty()) }
    var color by remember(profile?.id) { mutableStateOf(profile?.accent ?: "#c44532") }
    var avatar by remember(profile?.id) { mutableStateOf(profile?.avatarColor ?: color) }
    var wallpaper by remember(profile?.id) { mutableStateOf(profile?.wallpaper.orEmpty()) }
    AlertDialog(
        onDismissRequest = close,
        title = { Text(if (profile == null) "Create profile" else "Edit profile") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Name") }, singleLine = true)
                OutlinedTextField(color, { color = it }, Modifier.fillMaxWidth(), label = { Text("Accent hex") }, singleLine = true)
                if (profile != null) {
                    OutlinedTextField(avatar, { avatar = it }, Modifier.fillMaxWidth(), label = { Text("Avatar colour") }, singleLine = true)
                    OutlinedTextField(wallpaper, { wallpaper = it }, Modifier.fillMaxWidth(), label = { Text("Wallpaper URL or colour") }, singleLine = true)
                    OutlinedButton({ delete?.invoke() }, Modifier.fillMaxWidth()) { Text("Delete profile", color = Danger) }
                }
            }
        },
        confirmButton = { Button({ save(name, color, avatar, wallpaper.trim().ifEmpty { null }) }, enabled = name.isNotBlank()) { Text("Save") } },
        dismissButton = { TextButton(close) { Text("Cancel") } },
    )
}

@Composable
fun SourceAdminScreen(
    state: LoadState<SourceAdminData>,
    selectedKind: MediaKind,
    retry: () -> Unit,
    chooseKind: (MediaKind) -> Unit,
    search: (String) -> Unit,
    toggleSource: (SourceInfo, Boolean) -> Unit,
    toggleExtension: (SourceExtension, Boolean) -> Unit,
    addRepo: (String) -> Unit,
    removeRepo: (String) -> Unit,
    refresh: () -> Unit,
    error: ApiResult.Failure? = null,
    dismissError: () -> Unit = {},
) {
    var query by remember(selectedKind) { mutableStateOf("") }
    var repoUrl by remember(selectedKind) { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Sources", Modifier.padding(horizontal = 20.dp), style = MaterialTheme.typography.displayLarge)
        Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MediaKind.entries.forEach { kind ->
                QuietChip(kind.wire.replaceFirstChar(Char::uppercase), selectedKind == kind) { chooseKind(kind) }
            }
        }
        Text(
            when (selectedKind) {
                MediaKind.MANGA -> "Tachiyomi/Mihon index. Add a repository, refresh, then search extensions by name."
                MediaKind.ANIME -> "Stremio addon or catalog (manifest.json). Keiyoushi indexes will not run here."
                MediaKind.NOVEL -> "LNReader plugin manifest (plugins.min.json)."
            },
            Modifier.padding(horizontal = 20.dp),
            style = MaterialTheme.typography.bodySmall,
        )
        Loadable(state, retry) { data ->
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                item { SectionLabel("Installed sources") }
                if (data.sources.isEmpty()) item { EmptyState("No sources enabled", "Add a repository, refresh, then install an extension.") }
                items(data.sources, key = SourceInfo::id) { source ->
                    AdminToggle(source.name, "${source.lang} · ${if (source.isLocal) "local" else source.kind.wire}", source.enabled) {
                        toggleSource(source, it)
                    }
                }
                item { SectionLabel("Repositories") }
                items(data.repos, key = { it.indexUrl }) { repo ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(repo.name ?: repo.indexUrl, style = MaterialTheme.typography.titleSmall)
                            Text("${repo.extensionCount} extensions", style = MaterialTheme.typography.bodySmall)
                        }
                        TextButton({ removeRepo(repo.indexUrl) }) { Text("Remove", color = Danger) }
                    }
                    HorizontalDivider(color = Surface2)
                }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            repoUrl,
                            { repoUrl = it },
                            Modifier.fillMaxWidth(),
                            label = { Text("Repository index URL") },
                            placeholder = {
                                Text(
                                    when (selectedKind) {
                                        MediaKind.MANGA -> "index.pb or index.min.json"
                                        MediaKind.ANIME -> "manifest.json"
                                        MediaKind.NOVEL -> "plugins.min.json"
                                    },
                                )
                            },
                            singleLine = true,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button({ addRepo(repoUrl); repoUrl = "" }, enabled = repoUrl.isNotBlank()) { Text("Add and refresh") }
                            OutlinedButton(refresh) { Text("Refresh indexes") }
                        }
                    }
                }
                item { SectionLabel("Extensions") }
                item {
                    OutlinedTextField(
                        query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search extensions") }, singleLine = true,
                        trailingIcon = { TextButton({ search(query) }) { Text("Search") } },
                    )
                }
                if (selectedKind == MediaKind.MANGA && data.extensions.isEmpty()) item {
                    Text("Manga extensions are listed when you search by name.", color = Text2)
                }
                items(data.extensions, key = SourceExtension::pkgName) { extension ->
                    AdminToggle(
                        extension.name,
                        "${extension.lang} · ${extension.version}${if (extension.hasUpdate) " · update" else ""}",
                        extension.isInstalled,
                    ) { toggleExtension(extension, it) }
                }
                if (data.truncated) item { Text("Showing ${data.extensions.size} of ${data.total} extensions. Narrow the search to see more.", color = Text2) }
                item { Spacer(Modifier.height(20.dp)) }
            }
        }
    }
    error?.let { ActionErrorDialog(it, dismissError) }
}

@Composable
private fun SectionLabel(text: String) = Text(text, style = MaterialTheme.typography.titleMedium)

@Composable
private fun AdminToggle(title: String, detail: String, checked: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) { Text(title); Text(detail, style = MaterialTheme.typography.bodySmall) }
        Switch(checked, change)
    }
}

@Composable
fun StickersScreen(
    state: LoadState<StickersData>,
    placements: LoadState<List<StickerPlacement>>,
    retry: () -> Unit,
    toggle: (String) -> Unit,
    place: (String) -> Unit,
    move: (StickerPlacement, Double, Double, Double, Double) -> Unit,
    removePlacement: (StickerPlacement) -> Unit,
    back: () -> Unit,
    error: ApiResult.Failure? = null,
    dismissError: () -> Unit = {},
) {
    Loadable(state, retry) { data ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text("Stickers", style = MaterialTheme.typography.displayLarge); Text("${data.earnedCount} earned", color = Text2) }
                    TextButton(back) { Text("Done") }
                }
            }
            val placed = (placements as? LoadState.Ready)?.value.orEmpty()
            if (placed.isNotEmpty()) item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Placed on Yours", style = MaterialTheme.typography.titleMedium)
                    placed.forEach { placement ->
                        Surface(color = Surface1, shape = RoundedCornerShape(8.dp)) {
                            Column(Modifier.fillMaxWidth().padding(10.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    AsyncImage(placement.src, placement.name, Modifier.size(42.dp), contentScale = ContentScale.Fit)
                                    Text(placement.name, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                                    TextButton({ removePlacement(placement) }) { Text("Remove", color = Danger) }
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                    TextButton({ move(placement, placement.x - .05, placement.y, placement.scale, placement.rot) }) { Text("←") }
                                    TextButton({ move(placement, placement.x + .05, placement.y, placement.scale, placement.rot) }) { Text("→") }
                                    TextButton({ move(placement, placement.x, placement.y - .05, placement.scale, placement.rot) }) { Text("↑") }
                                    TextButton({ move(placement, placement.x, placement.y + .05, placement.scale, placement.rot) }) { Text("↓") }
                                    TextButton({ move(placement, placement.x, placement.y, placement.scale + .1, placement.rot) }) { Text("+") }
                                    TextButton({ move(placement, placement.x, placement.y, placement.scale - .1, placement.rot) }) { Text("−") }
                                }
                            }
                        }
                    }
                }
            }
            if (data.collection.isEmpty()) item { EmptyState("No sticker sets yet", "Read or watch titles in Yours to unlock their collection.") }
            items(data.collection, key = { "${it.via}:${it.id}" }) { title ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(title.title, style = MaterialTheme.typography.titleMedium)
                    Text("${title.earned} of ${title.slots.size}", style = MaterialTheme.typography.bodySmall)
                    title.slots.chunked(4).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            row.forEach { sticker -> StickerCell(sticker, { place(sticker.id) }, { toggle(sticker.id) }, Modifier.weight(1f)) }
                            repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
    }
    error?.let { ActionErrorDialog(it, dismissError) }
}

@Composable
private fun StickerCell(sticker: StickerSlot, place: () -> Unit, toggle: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.clickable(enabled = sticker.earned && sticker.src != null, onClick = place), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Surface(Modifier.fillMaxWidth().height(92.dp), color = Surface1, shape = RoundedCornerShape(9.dp)) {
            if (sticker.src != null) AsyncImage(sticker.src, sticker.name, Modifier.fillMaxSize().padding(6.dp), contentScale = ContentScale.Fit)
            else Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("?", color = Text2) }
        }
        Text(if (sticker.secret && !sticker.earned) "Secret" else sticker.name, style = MaterialTheme.typography.bodySmall, maxLines = 1)
        if (sticker.earned) TextButton(toggle, contentPadding = PaddingValues(2.dp)) { Text("Hide") }
    }
}

@Composable
fun ActionErrorDialog(error: ApiResult.Failure, dismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = dismiss,
        title = { Text("Couldn’t save that") },
        text = { Text(error.message) },
        confirmButton = { TextButton(dismiss) { Text("OK") } },
    )
}
