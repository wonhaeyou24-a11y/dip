export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 파일명에 쓸 수 없는 문자 제거 */
export function safeFilename(name: string): string {
  return (name || 'file').replace(/[\\/:*?"<>|]/g, '_').trim();
}
