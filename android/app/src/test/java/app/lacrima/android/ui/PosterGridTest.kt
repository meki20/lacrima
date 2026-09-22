package app.lacrima.android.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PosterGridTest {
    @Test fun `portrait grids are always three columns`() {
        assertEquals(3, posterColumns(360f))
        assertEquals(3, posterColumns(412f))
        assertEquals(3, posterColumns(599f))
    }

    @Test fun `wide layouts add columns instead of stretching cards`() {
        assertEquals(3, posterColumns(600f))
        assertEquals(5, posterColumns(800f))
    }
}
