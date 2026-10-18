// Verify every payload entry with Java's JAR verifier and the approved upload certificate.
import java.io.InputStream;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;
import java.util.jar.JarFile;

class VerifyGoogleBundle {
    static boolean signature(String name) {
        String n = name.toUpperCase(Locale.ROOT);
        if (!n.startsWith("META-INF/")) return false;
        String leaf = n.substring(9);
        return !leaf.contains("/") && (leaf.equals("MANIFEST.MF") || leaf.endsWith(".SF")
            || leaf.endsWith(".RSA") || leaf.endsWith(".DSA") || leaf.endsWith(".EC")
            || leaf.startsWith("SIG-"));
    }

    public static void main(String[] args) throws Exception {
        int count = 0;
        try (JarFile jar = new JarFile(Path.of(args[0]).toFile(), true)) {
            var entries = jar.entries();
            while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                if (entry.isDirectory()) continue;
                try (InputStream stream = jar.getInputStream(entry)) {
                    stream.transferTo(java.io.OutputStream.nullOutputStream());
                }
                if (signature(entry.getName())) continue;
                var signers = entry.getCodeSigners();
                if (signers == null || signers.length != 1)
                    throw new SecurityException("Payload must have exactly one verified signer");
                var cert = signers[0].getSignerCertPath().getCertificates().get(0);
                String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(cert.getEncoded()));
                if (!digest.equals(args[1])) throw new SecurityException("Unexpected upload certificate");
                count++;
            }
        }
        if (count == 0) throw new SecurityException("Empty bundle");
        System.out.println("Verified upload certificate and signature on " + count + " payload entries");
    }
}
