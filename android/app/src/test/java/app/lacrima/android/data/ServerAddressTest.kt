package app.lacrima.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerAddressTest {
    @Test fun `accepts HTTPS origins`() {
        assertEquals("https://lacrima.example.ts.net", ServerAddress.normalize("https://lacrima.example.ts.net/"))
    }

    @Test fun `accepts HTTP only for private LAN IPv4 addresses`() {
        assertEquals("http://192.168.1.224:7345", ServerAddress.normalize("http://192.168.1.224:7345"))
        assertEquals("http://10.0.0.8", ServerAddress.normalize("http://10.0.0.8"))
        assertNull(ServerAddress.normalize("http://lacrima.example.com"))
        assertNull(ServerAddress.normalize("http://8.8.8.8"))
    }
}
