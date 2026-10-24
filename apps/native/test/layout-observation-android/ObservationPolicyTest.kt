package tv.getportico.portico.native

/** Production pure policy/math only. Native attachment/span/paint require an actual collector. */
fun main() {
  val uri = "portico://native-layout?specimen=signed-out-welcome"
  val action = "android.intent.action.VIEW"
  var checks = 0
  fun verify(ok: Boolean) { check(ok); checks++ }
  verify(LayoutObservationPolicy.admitted(true, action, uri, 1.0, 2.0, listOf(1.0, 2.0, 3.0)))
  verify(LayoutObservationPolicy.admitted(true, action, uri, 1.0, 2.0, emptyList()))
  verify(LayoutObservationPolicy.admitted(true, action, uri, 1.0, 2.0, (1..2000).map(Int::toDouble)))
  verify(!LayoutObservationPolicy.admitted(true, action, uri, 1.0, 2.0, (1..2001).map(Int::toDouble)))
  verify(!LayoutObservationPolicy.admitted(false, action, uri, 1.0, 2.0, listOf(3.0)))
  for (badAction in listOf(null, "android.intent.action.MAIN", "android.intent.action.SEND"))
    verify(!LayoutObservationPolicy.publicIntent(true, badAction, uri))
  for (bad in listOf(null, "$uri&", "$uri#", "$uri&server=https://fixture.invalid", "$uri&specimen=other",
      uri.replace("signed-out-welcome", "unknown"), uri.replace("portico:", "PORTICO:"), " $uri", "$uri ",
      uri.replace("?", "/?"), uri.replace("specimen", "%73pecimen")))
    verify(!LayoutObservationPolicy.publicIntent(true, action, bad))
  for (bad in listOf(Double.NaN, Double.POSITIVE_INFINITY, -1.0, 0.0, 1.5, 2147483648.0)) {
    verify(!LayoutObservationPolicy.admitted(true, action, uri, bad, 2.0, listOf(3.0)))
    verify(!LayoutObservationPolicy.admitted(true, action, uri, 1.0, bad, listOf(3.0)))
    verify(!LayoutObservationPolicy.admitted(true, action, uri, 1.0, 2.0, listOf(bad)))
  }
  verify(!LayoutObservationPolicy.admitted(true, action, uri, 1.0, 1.0, emptyList()))
  verify(!LayoutObservationPolicy.admitted(true, action, uri, 1.0, 2.0, listOf(3.0, 3.0)))
  data class Node(val tag: Int, val children: List<Node> = emptyList())
  val fixture = Node(2, listOf(Node(3)))
  val root = Node(1, listOf(fixture, Node(4)))
  fun collect(node: Node, wanted: Set<Int>) = LayoutObservationPolicy.collect(node, wanted, Node::tag, { it.children.size }, { n, i -> n.children[i] })
  val found = collect(root, setOf(1, 2, 3, 8))!!
  verify(found.keys == setOf(1, 2, 3)); verify(found[2] === fixture); verify(collect(fixture, setOf(1, 4))!!.isEmpty())
  verify(collect(Node(1, listOf(Node(2), Node(2))), setOf(2)) == null)
  verify(collect(Node(1, List(20000) { Node(it + 2) }), emptySet()) == null)
  // The boundary cannot allocate/read even the first child of an oversized root.
  verify(LayoutObservationPolicy.collect(1, emptySet(), { it }, { Int.MAX_VALUE }, { _, _ -> error("unbounded child lookup") }) == null)
  verify(LayoutObservationPolicy.opacity(listOf(0.5, 0.4, 1.0)) == 0.2)
  verify(LayoutObservationPolicy.opacity(listOf(1.0, 0.0, 0.5)) == 0.0)
  for (bad in listOf(-0.1, 1.1, Double.NaN, Double.POSITIVE_INFINITY)) verify(LayoutObservationPolicy.opacity(listOf(1.0, bad)) == null)
  verify(LayoutObservationPolicy.opacity(emptyList()) == null)
  verify(LayoutObservationPolicy.fontFamily("sans-serif"))
  for (bad in listOf(null, "", " ", "sans\nserif", "asset/font.ttf", "https://example.invalid", "A".repeat(129))) verify(!LayoutObservationPolicy.fontFamily(bad))
  verify(LayoutObservationPolicy.rgba(0xffff0000.toInt()) == "rgba(255, 0, 0, 1)")
  verify(LayoutObservationPolicy.rgba(0) == "rgba(0, 0, 0, 0)")
  verify(LayoutObservationPolicy.rgba(0x8000ff00.toInt()) == "rgba(0, 255, 0, 0.50196078)")
  fun background(alpha: List<Double>) = LayoutObservationPolicy.rgba(LayoutObservationPolicy.background(listOf(0xffff0000.toInt(), 0xff0000ff.toInt()), alpha))
  verify(background(listOf(0.5, 1.0)) == "rgba(127.5, 0, 127.5, 1)")
  verify(background(listOf(0.0, 1.0)) == "rgba(0, 0, 255, 1)")
  verify(background(listOf(1.0, 0.0)) == "rgba(0, 0, 0, 0)")
  verify(background(listOf(1.0, 0.5)) == "rgba(255, 0, 0, 0.5)")
  println("Layout observation policy/math: $checks checks PASS (no native paint/device assertion)")
}
