/** Render untrusted mail with no network access, navigation, forms or active content. */
export function safePreviewDocument(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script,iframe,frame,frameset,object,embed,base,meta,link,form,input,button,textarea,select,svg,math').forEach(node => node.remove());
  for (const node of document.querySelectorAll('*')) {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      // Links are visual-only in previews; remote resources and tracking pixels stay blocked.
      if (name.startsWith('on') || ['href', 'srcset', 'action', 'formaction', 'srcdoc', 'target', 'download', 'ping', 'background'].includes(name)) node.removeAttribute(attribute.name);
      if (name === 'src' && !(node.tagName === 'IMG' && /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(attribute.value))) node.removeAttribute(attribute.name);
    }
  }
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src \'none\'; connect-src \'none\'; form-action \'none\'; base-uri \'none\'"></head><body>'
    + document.head.innerHTML + document.body.innerHTML + '</body></html>';
}
