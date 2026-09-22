package app.lacrima.android.feature.reader

import org.junit.Assert.assertEquals
import org.junit.Test

class ReaderModelsTest {
    @Test fun `tap zones match the web reader`() {
        assertEquals("top", tapZone(10f, 10f, 100f, 100f))
        assertEquals("left", tapZone(10f, 50f, 100f, 100f))
        assertEquals("right", tapZone(90f, 50f, 100f, 100f))
        assertEquals("mid", tapZone(50f, 50f, 100f, 100f))
    }

    @Test fun `short page stubs glue onto the previous page`() {
        assertEquals(
            listOf(listOf(0), listOf(1, 2), listOf(3)),
            stitchPageGroups(listOf(2000, 1800, 400, 1900)),
        )
        assertEquals(
            listOf(listOf(0), listOf(1), listOf(2)),
            stitchPageGroups(listOf(2000, 1900, 1800)),
        )
        assertEquals(listOf(listOf(0, 1)), stitchPageGroups(listOf(2000, 300)))
    }

    @Test fun `page step walks stitched groups`() {
        val groups = stitchPageGroups(listOf(2000, 1800, 400, 1900))
        assertEquals(1, groupIndexForPage(groups, 2))
        assertEquals(3, pageStepGroups(1, 1, groups, "single"))
        assertEquals(1, pageStepGroups(3, -1, groups, "single"))
    }

    @Test fun `RTL seekbar maps its right edge to the first page`() {
        assertEquals(9, seekbarPage(0, 10, rtl = true))
        assertEquals(0, seekbarPage(9, 10, rtl = true))
        assertEquals(3, seekbarPage(3, 10, rtl = false))
    }
}
