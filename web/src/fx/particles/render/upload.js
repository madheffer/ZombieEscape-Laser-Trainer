// Mark only the first n values of a dynamic buffer attribute for upload. Renderers keep buffers at up to twice the live
// count (capacity doubling); needsUpdate alone re-uploads the whole array every frame.
export function uploadRange(attr, n) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n);
  attr.needsUpdate = true;
}
