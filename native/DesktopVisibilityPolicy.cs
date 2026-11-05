// Window visibility is independent of WebView document.hidden on Windows.
// Keep the message edge-triggered; only a newly ready document needs a repeat.
internal sealed class DesktopVisibilityPolicy {
 bool? previous;
 internal bool Change(bool visible,bool minimized,bool force,out bool current){
  current=visible&&!minimized;
  if(!force&&previous.HasValue&&previous.Value==current)return false;
  previous=current;return true;
 }
}
