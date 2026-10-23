import com.sun.jdi.Bootstrap;
import com.sun.jdi.Location;
import com.sun.jdi.ObjectReference;
import com.sun.jdi.ReferenceType;
import com.sun.jdi.StackFrame;
import com.sun.jdi.VirtualMachine;
import com.sun.jdi.connect.AttachingConnector;
import com.sun.jdi.event.BreakpointEvent;
import com.sun.jdi.event.Event;
import com.sun.jdi.event.EventSet;
import com.sun.jdi.request.BreakpointRequest;
import com.sun.jdi.request.EventRequest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** One caller stack, from an explicitly leased public Modal test. This briefly suspends only
 * the breakpoint's event thread. No VM-wide suspension, target invocation, field write or local
 * variable/argument/authentication inspection. Never run without the device owner's interval. */
public final class TraceModalDismiss {
  private static final String TYPE = "com.facebook.react.views.modal.ReactModalHostView";
  private static String quoted(String value) {
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\"";
  }
  public static void main(String[] args) throws Exception {
    if (args.length != 4) throw new IllegalArgumentException("PORT INSTANCE_ID_OR_single TIMEOUT_MS OUTPUT_JSON");
    int port = Integer.parseInt(args[0]), timeout = Integer.parseInt(args[2]);
    if (port < 1024 || port > 65535 || timeout < 1000 || timeout > 30000) throw new IllegalArgumentException("Invalid bounded attach");
    AttachingConnector connector = Bootstrap.virtualMachineManager().attachingConnectors().stream()
        .filter(value -> value.name().equals("com.sun.jdi.SocketAttach")).findFirst().orElseThrow();
    var options = connector.defaultArguments();
    options.get("hostname").setValue("127.0.0.1"); options.get("port").setValue(args[0]); options.get("timeout").setValue("10000");
    VirtualMachine vm = connector.attach(options);
    BreakpointRequest request = null;
    try {
      if (!vm.canGetInstanceInfo() || !vm.canUseInstanceFilters()) throw new IllegalStateException("Target lacks bounded instance inspection/filtering");
      List<ReferenceType> types = vm.classesByName(TYPE);
      if (types.size() != 1) throw new IllegalStateException("Modal class is not uniquely loaded");
      ReferenceType type = types.get(0);
      List<ObjectReference> instances = type.instances(128);
      ObjectReference target;
      if (args[1].equals("single")) {
        if (instances.size() != 1) throw new IllegalStateException("Select the exact current modal instance");
        target = instances.get(0);
      } else {
        long id = Long.parseLong(args[1]);
        target = instances.stream().filter(value -> value.uniqueID() == id).findFirst().orElseThrow();
      }
      var methods = type.methodsByName("dismiss", "()V");
      if (methods.size() != 1) throw new IllegalStateException("Unexpected modal dismiss signature");
      Location location = methods.get(0).location();
      if (location == null) throw new IllegalStateException("No executable dismiss location");
      request = vm.eventRequestManager().createBreakpointRequest(location);
      request.addInstanceFilter(target);
      request.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
      request.enable();
      System.out.println("READY instance=" + target.uniqueID() + " timeoutMs=" + timeout);
      System.out.flush();
      long deadline = System.nanoTime() + timeout * 1_000_000L;
      boolean matched = false;
      while (!matched && System.nanoTime() < deadline) {
        long remaining = Math.max(1, (deadline - System.nanoTime()) / 1_000_000L);
        EventSet events = vm.eventQueue().remove(remaining);
        if (events == null) break;
        long started = System.nanoTime();
        List<String> frames = new ArrayList<>();
        try {
          for (Event event : events) if (event instanceof BreakpointEvent breakpoint && breakpoint.request() == request) {
            matched = true; request.disable();
            for (StackFrame frame : breakpoint.thread().frames(0, Math.min(64, breakpoint.thread().frameCount()))) {
              Location at = frame.location();
              frames.add("{\"type\":" + quoted(at.declaringType().name()) + ",\"method\":" + quoted(at.method().name())
                  + ",\"signature\":" + quoted(at.method().signature()) + ",\"line\":" + at.lineNumber() + "}");
            }
          }
        } finally { events.resume(); }
        if (matched) {
          String json = "{\"instanceId\":" + target.uniqueID() + ",\"eventThreadSuspensions\":1,\"vmSuspendCalls\":0,\"targetInvocations\":0,\"fieldWrites\":0,\"localsRead\":0,\"debuggerHandlingNanos\":"
              + (System.nanoTime() - started) + ",\"frames\":[" + String.join(",", frames) + "]}\n";
          Files.writeString(Path.of(args[3]), json);
          System.out.println("CAPTURED one modal dismiss caller; event thread resumed");
        }
      }
      if (!matched) throw new IllegalStateException("No matching dismiss during the bounded interval");
    } finally {
      try { if (request != null) vm.eventRequestManager().deleteEventRequest(request); }
      finally { vm.dispose(); }
    }
  }
}
