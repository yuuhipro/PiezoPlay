// Keep the actual filename intact; shorten only its on-screen label.
export function displayFileName(name = '', max = 60) {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const extChars = Array.from(ext);
  if (extChars.length > 12) return chars.slice(0, max - 1).join('') + '…';
  return chars.slice(0, max - extChars.length - 1).join('') + '…' + ext;
}
