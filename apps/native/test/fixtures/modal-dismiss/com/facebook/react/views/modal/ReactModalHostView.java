package com.facebook.react.views.modal;

public final class ReactModalHostView {
  private static ReactModalHostView retained;
  private void dismiss() { System.out.println("DISMISSED"); }
  private void onDetachedFromWindow() { dismiss(); }
  public static void main(String[] args) throws Exception {
    retained = new ReactModalHostView();
    System.out.println("FIXTURE_READY");
    System.out.flush();
    if (System.in.read() < 0) throw new IllegalStateException("No trigger");
    retained.onDetachedFromWindow();
    // Keep the VM alive until the observer has completed its read/resume/disconnect.
    System.in.read();
  }
}
