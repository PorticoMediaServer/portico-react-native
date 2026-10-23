The vendored source is Media3 1.10.1 at the commit and archive digest in
sources.lock.json. The local patch routes Media3's AC-4 and DTS Express MIME
types to FFmpeg's ac4 and dca decoders. supportsFormat still requires that the
loaded JNI library actually contains the named decoder. DTS-UHD/X is not mapped
to the generic DCA decoder.

The lock retains the upstream file digest, the replayable patch digest and the
resulting checked-in source digest. The upstream archive digest is unchanged.
