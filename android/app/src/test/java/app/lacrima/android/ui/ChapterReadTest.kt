package app.lacrima.android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChapterReadTest {
    @Test fun `reopened older chapter stays read and active frontier stays bright`() {
        assertTrue(isChapterRead(2, 2, 5))
        assertTrue(isChapterRead(1, 2, 5))
        assertFalse(isChapterRead(4, 4, 5))
        assertFalse(isChapterRead(5, 2, 5))
    }

    @Test fun `chapter lists open at the last read chapter`() {
        assertEquals(3, lastReadChapterIndex(8, 4, 5))
        assertEquals(7, lastReadChapterIndex(8, 4, 5, completed = true))
        assertEquals(null, lastReadChapterIndex(8, -1, 0))
    }
}
